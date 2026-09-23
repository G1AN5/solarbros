/* ============================================================================
   SUPABASE CLIENT
   ----------------------------------------------------------------------------
   The single typed connection to the backend. Every data hook goes through
   here rather than constructing its own client, so session handling and typing
   are consistent across all four portals.

   FULLY TYPED AGAINST THE LIVE SCHEMA
   The `Database` generic comes from src/types/database.ts, which is GENERATED —
   never hand-edited. Regenerate it after any migration:

       npm run db:types

   With the generic in place, a typo in a column name is a compile error rather
   than an empty result at runtime, and `select()` results are typed all the way
   into the component.

   WITHOUT CREDENTIALS
   The client is null when .env.local is absent, so `npm run dev` and the CI
   build still work with no secrets. Screens then show a clear "not connected"
   message rather than fabricated data — see NOT_CONNECTED below.

   SECURITY: the anon key is public by design and belongs in the browser bundle.
   Access is controlled by Row Level Security policies in Postgres — never by
   hiding this key. Run `npm run verify:rls` to prove those policies hold.
   The `service_role` key must NEVER appear anywhere under src/.
   ========================================================================== */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Shown when a screen asks for data and no backend is configured.
 *
 * The application used to fall back to fixtures here. That was right during the
 * UI phase and is wrong now: an unconfigured app rendering convincing fake
 * invoices is worse than one that says it is not connected, because nobody
 * looking at the screen can tell the difference.
 */
export const NOT_CONNECTED =
  'Not connected to the database. Copy .env.example to .env.local and add your Supabase URL and key.'

/** True once .env.local is filled in. */
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.info(
    '[SolarBros] Supabase is not configured. Copy .env.example to .env.local and ' +
      'add your keys — screens will show a "not connected" message until you do.',
  )
}

/** Typed client, or null when no credentials are present. */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(url, anonKey, {
      auth: {
        // Keep the session in localStorage and refresh it in the background, so
        // a technician who closes the tab mid-job is not signed out.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

/**
 * Use inside data hooks that genuinely require a live backend. Throws a clear,
 * actionable error instead of a confusing "cannot read property of null".
 */
export function requireSupabase(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and add ' +
        'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }
  return supabase
}

/* --- Convenience row aliases -------------------------------------------------
   Saves every hook writing Database['public']['Tables']['projects']['Row'].
   Add to these as new tables are queried. */

type Tables = Database['public']['Tables']

export type ProfileRow = Tables['profiles']['Row']
export type LeadRow = Tables['leads']['Row']
export type EstimateRow = Tables['estimates']['Row']
export type QuotationRow = Tables['quotations']['Row']
export type ContractRow = Tables['contracts']['Row']
export type ProjectRow = Tables['projects']['Row']
export type MilestoneRow = Tables['project_milestones']['Row']
export type PermitRow = Tables['permits']['Row']
export type AppointmentRow = Tables['appointments']['Row']
export type StockItemRow = Tables['stock_items']['Row']
export type SerialisedAssetRow = Tables['serialised_assets']['Row']
export type InvoiceRow = Tables['invoices']['Row']
export type PaymentRow = Tables['payments']['Row']
export type TicketRow = Tables['tickets']['Row']
export type WarrantyRequestRow = Tables['warranty_requests']['Row']
export type DocumentRow = Tables['documents']['Row']
export type NotificationRow = Tables['notifications']['Row']
export type AuditRow = Tables['audit_log']['Row']
export type PackageRow = Tables['packages']['Row']
export type ReviewRow = Tables['reviews']['Row']
export type PortfolioRow = Tables['portfolio_items']['Row']
export type BlogPostRow = Tables['blog_posts']['Row']
