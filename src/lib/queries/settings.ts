import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PRICING,
  type PricingConfig,
  type SystemAssumptions,
} from '@/lib/solar-estimator'
import { throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   BUSINESS SETTINGS
   ----------------------------------------------------------------------------
   Reads and writes the `settings` table from migration 0018.

   WHY THE UI READS THESE RATHER THAN IMPORTING CONSTANTS
   The database triggers already read them, so a hardcoded copy in the frontend
   would drift the moment somebody changed a value. A quotation showing 18%
   labour while the invoice trigger applied 22% is the kind of discrepancy that
   surfaces in front of a customer.

   A FALLBACK IS ALWAYS SUPPLIED
   `settingNum(settings, key, fallback)` never returns undefined. A missing row,
   a failed fetch or an unconfigured environment degrades to the previous
   hardcoded value rather than rendering NaN into a price.
   ========================================================================== */

export interface Setting {
  key: string
  value: unknown
  category: string
  label: string
  description: string | null
  valueType: 'number' | 'percent' | 'currency' | 'text' | 'boolean'
  unit: string | null
  minValue: number | null
  maxValue: number | null
  editableBy: UserRole[]
  isPublic: boolean
  sortOrder: number
  updatedAt: string
}

export const settingsKeys = {
  all: ['settings'] as const,
}

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    // Settings change rarely, and every screen reads them. Cache generously.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Setting[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .order('category')
        .order('sort_order')

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        key: row.key,
        value: row.value,
        category: row.category,
        label: row.label,
        description: row.description,
        valueType: row.value_type,
        unit: row.unit,
        minValue: row.min_value !== null ? Number(row.min_value) : null,
        maxValue: row.max_value !== null ? Number(row.max_value) : null,
        editableBy: row.editable_by,
        isPublic: row.is_public,
        sortOrder: row.sort_order,
        updatedAt: row.updated_at,
      }))
    },
  })
}

/* --- Lookup helpers ------------------------------------------------------
   Take the list rather than the key alone, so a component makes one query and
   reads many values from it. */

export function settingNum(settings: Setting[] | undefined, key: string, fallback: number): number {
  const found = settings?.find((s) => s.key === key)
  if (found === undefined || found.value === null) return fallback
  const n = Number(found.value)
  return Number.isFinite(n) ? n : fallback
}

export function settingText(
  settings: Setting[] | undefined,
  key: string,
  fallback: string,
): string {
  const found = settings?.find((s) => s.key === key)
  if (found === undefined || found.value === null) return fallback
  return String(found.value)
}

/**
 * Save one setting.
 *
 * Authorisation is NOT decided here. The `settings_update` RLS policy checks
 * the caller's role against the row's `editable_by` array, so an accountant
 * changing a scoring weight is refused by the database even if the UI somehow
 * offered the field. The `editableBy` check in the page is only there so people
 * are not shown inputs that will reject them.
 */
export function useUpdateSetting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { key: string; value: unknown; userId: string }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const { data, error } = await supabase
        .from('settings')
        .update({ value: input.value as never, updated_by: input.userId })
        .eq('key', input.key)
        .select()

      if (error) throwReadable(error)

      // RLS refuses by returning zero rows rather than raising, so an empty
      // result means "not permitted" — not "saved successfully".
      if (!data || data.length === 0) {
        throw new Error('You do not have permission to change this setting.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all })
      // Prices, scoring and due dates feed almost every other screen.
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['fin'] })
    },
  })
}

/* ============================================================================
   PER-ITEM INVENTORY THRESHOLDS
   ----------------------------------------------------------------------------
   The reorder point lives on each stock item, not in settings — a panel and a
   connector need very different thresholds. The SETTING supplies the default
   for a new item; this mutation lets the inventory manager tune an individual
   one, which is what they actually spend their time doing.
   ========================================================================== */

export function useUpdateStockThresholds() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; reorderPoint: number; unitCost?: number }) => {
      if (!supabase) throw new Error('Not connected to the backend.')
      if (input.reorderPoint < 0) throw new Error('A reorder point cannot be negative.')

      const { data, error } = await supabase
        .from('stock_items')
        .update({
          reorder_point: input.reorderPoint,
          ...(input.unitCost !== undefined ? { unit_cost: input.unitCost } : {}),
        })
        .eq('id', input.id)
        .select('id')

      if (error) throwReadable(error)
      if ((data?.length ?? 0) === 0) {
        throw new Error('That was refused — the catalogue is kept by the inventory manager.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
    },
  })
}

/* ============================================================================
   HOW TO PAY US
   ----------------------------------------------------------------------------
   Bank details belong in settings and not in the markup. They were previously
   a paragraph of hardcoded help text on the billing page, which meant changing
   bank would have required a developer — on the one piece of information a
   customer absolutely must get right, and the one most likely to change while
   nobody is thinking about the software.

   `configured` is false until somebody fills them in, and the page hides the
   panel entirely rather than showing a customer an empty account number and
   inviting them to guess.
   ========================================================================== */

export interface PaymentDetails {
  bankName: string
  accountName: string
  accountNumber: string
  gcashNumber: string
  instructions: string
  /** True once there is enough here for a customer to actually pay. */
  configured: boolean
}

export function usePaymentDetails(): PaymentDetails {
  const { data: settings } = useSettings()

  const bankName = settingText(settings, 'finance.bank_name', '')
  const accountName = settingText(settings, 'finance.bank_account_name', '')
  const accountNumber = settingText(settings, 'finance.bank_account_number', '')
  const gcashNumber = settingText(settings, 'finance.gcash_number', '')

  return {
    bankName,
    accountName,
    accountNumber,
    gcashNumber,
    instructions: settingText(
      settings,
      'finance.payment_instructions',
      'Quote your invoice number as the transfer reference so we can match your payment against our statement.',
    ),
    // An account number with no bank, or a bank with no number, is not payable.
    configured: Boolean((bankName && accountNumber) || gcashNumber),
  }
}

/* ============================================================================
   WHAT A SYSTEM COSTS, AS THE OWNER HAS SET IT
   ----------------------------------------------------------------------------
   The estimator used to price systems from constants compiled into
   solar-estimator.ts, so the pricing fields on the settings screen changed
   nothing whatsoever. The owner could edit a figure, press Save, reload the
   public estimator and see the old price. This hook is the wire that was
   missing.

   IT WORKS SIGNED OUT. Every pricing row is now `is_public`, so an anonymous
   visitor on /estimator reads the same numbers a member of staff does —
   otherwise the public page would still be quoting the defaults, which was the
   whole complaint.

   DEFAULT_PRICING remains the fallback for the first paint and for an offline
   environment. It is not a second price list anybody is expected to maintain.
   ========================================================================== */

export function usePricingConfig(): PricingConfig {
  const { data: settings } = useSettings()

  return useMemo(
    () => ({
      baseCost: {
        on_grid: settingNum(
          settings,
          'pricing.base_cost_on_grid',
          DEFAULT_PRICING.baseCost.on_grid,
        ),
        hybrid: settingNum(settings, 'pricing.base_cost_hybrid', DEFAULT_PRICING.baseCost.hybrid),
        off_grid: settingNum(
          settings,
          'pricing.base_cost_off_grid',
          DEFAULT_PRICING.baseCost.off_grid,
        ),
      },
      costPerKwp: {
        on_grid: settingNum(
          settings,
          'pricing.cost_per_kw_on_grid',
          DEFAULT_PRICING.costPerKwp.on_grid,
        ),
        hybrid: settingNum(
          settings,
          'pricing.cost_per_kw_hybrid',
          DEFAULT_PRICING.costPerKwp.hybrid,
        ),
        off_grid: settingNum(
          settings,
          'pricing.cost_per_kw_off_grid',
          DEFAULT_PRICING.costPerKwp.off_grid,
        ),
      },
      costPerBattery: settingNum(
        settings,
        'pricing.cost_per_battery',
        DEFAULT_PRICING.costPerBattery,
      ),
      batteriesIncluded: settingNum(
        settings,
        'pricing.batteries_included',
        DEFAULT_PRICING.batteriesIncluded,
      ),
    }),
    /* A fresh object every render would be a new dependency for every
       useMemo that prices something, so the estimate would recompute on
       every keystroke anywhere on the page. */
    [settings],
  )
}
/**
 * The hardware assumptions behind every sizing figure.
 *
 * Same story as the prices: these settings existed, the screen offered them,
 * and the estimator read its own constants instead. An owner switching to a
 * different panel would have found the wattage field made no difference to the
 * panel count a customer was quoted.
 */
export function useSystemAssumptions(): SystemAssumptions {
  const { data: settings } = useSettings()

  return useMemo(
    () => ({
      panelWatts: settingNum(settings, 'pricing.panel_watts', DEFAULT_ASSUMPTIONS.panelWatts),
      batteryKwh: settingNum(settings, 'pricing.battery_kwh', DEFAULT_ASSUMPTIONS.batteryKwh),
      performanceRatio: settingNum(
        settings,
        'pricing.performance_ratio',
        DEFAULT_ASSUMPTIONS.performanceRatio,
      ),
      inverterHeadroom: settingNum(
        settings,
        'pricing.inverter_headroom',
        DEFAULT_ASSUMPTIONS.inverterHeadroom,
      ),
      sqmPerKw: settingNum(settings, 'pricing.sqm_per_kw', DEFAULT_ASSUMPTIONS.sqmPerKw),
      lifetimeYears: settingNum(
        settings,
        'pricing.system_lifetime_years',
        DEFAULT_ASSUMPTIONS.lifetimeYears,
      ),
    }),
    [settings],
  )
}
