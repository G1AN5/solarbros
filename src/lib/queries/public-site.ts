import { useQuery } from '@tanstack/react-query'

import { useSettings, settingNum, settingText, type Setting } from './settings'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   PUBLIC SITE CONTENT
   ----------------------------------------------------------------------------
   The company profile and FAQs behind the marketing pages.

   WHY THE COMPANY PROFILE COMES FROM SETTINGS
   Address, phone, service areas and the trust figures in the hero all change
   more often than any code in this repository. A new service area opens, a
   brand is dropped, the homes-powered counter passes a round number worth
   advertising. Marketing should not need a developer for any of that.

   These reads run for logged-out visitors, so only the settings marked
   `is_public` are exposed — costs, margins and discount authority are not among
   them. The RLS policy enforces that; this module simply asks.
   ========================================================================== */

/* --- Company profile ------------------------------------------------------ */

export interface CompanyProfile {
  name: string
  tagline: string
  email: string
  phone: string
  address: string
  hours: string
  facebook: string
  serviceAreas: string[]
  brands: string[]
  homesPowered: number
  businessesPowered: number
  installDays: number
  warrantyPanelYears: number
  warrantyInverterYears: number
  warrantyWorkmanshipYears: number
}

/**
 * A setting stored as a JSON array.
 *
 * Tolerates a plain newline-separated string too, because that is what somebody
 * editing the field by hand will naturally type — and losing the service-area
 * list to a formatting slip would be a poor trade for strictness.
 */
function settingList(settings: Setting[] | undefined, key: string, fallback: string[]): string[] {
  const found = settings?.find((s) => s.key === key)
  if (!found?.value) return fallback
  if (Array.isArray(found.value)) return found.value.map(String)
  if (typeof found.value === 'string') {
    return found.value
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return fallback
}

/**
 * The company profile, assembled from public settings.
 *
 * Every field has a fallback, so the marketing site renders sensibly during the
 * first paint and on a completely unconfigured clone. These are the ONLY
 * hardcoded strings left on the public site, and they exist so a visitor never
 * sees an empty page or the word "undefined" in a heading.
 */
export function useCompany(): CompanyProfile {
  const { data: settings } = useSettings()

  return {
    name: settingText(settings, 'company.name', 'SolarBros'),
    tagline: settingText(settings, 'company.tagline', 'Power your home or business with the sun.'),
    email: settingText(settings, 'company.email', 'hello@solarbros.ph'),
    phone: settingText(settings, 'company.phone', '+63 917 555 0142'),
    address: settingText(
      settings,
      'company.address',
      'Warehouse Unit D ACSIE #12 Main Road, Km. 16 West Service Road, South Superhighway, Paranaque, Metro Manila 1700',
    ),
    hours: settingText(settings, 'company.hours', 'Mon-Sat, 8:00 AM - 6:00 PM'),
    facebook: settingText(settings, 'company.facebook', 'facebook.com/solarbrosph'),
    serviceAreas: settingList(settings, 'company.service_areas', [
      'Paranaque',
      'Metro Manila',
      'Cavite',
      'Laguna',
      'Rizal',
    ]),
    brands: settingList(settings, 'company.brands', [
      'Canadian Solar',
      'JA Solar',
      'Deye',
      'Huawei',
      'Growatt',
      'Pylontech',
    ]),
    homesPowered: settingNum(settings, 'company.homes_powered', 1240),
    businessesPowered: settingNum(settings, 'company.businesses_powered', 86),
    installDays: settingNum(settings, 'company.install_days', 3),
    warrantyPanelYears: settingNum(settings, 'warranty.panel_years', 25),
    warrantyInverterYears: settingNum(settings, 'warranty.inverter_years', 10),
    warrantyWorkmanshipYears: settingNum(settings, 'warranty.workmanship_years', 2),
  }
}

/* --- FAQs ----------------------------------------------------------------- */

export interface Faq {
  id: string
  question: string
  answer: string
  category: string
  sortOrder: number
  published: boolean
}

export function useFaqs(publishedOnly = true) {
  return useQuery({
    queryKey: ['content', 'faqs', publishedOnly],
    // Answers to the same six questions do not change hourly.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Faq[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase.from('faqs').select('*').order('sort_order')
      if (publishedOnly) query = query.eq('published', true)

      const { data, error } = await query
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        question: row.question,
        answer: row.answer,
        category: row.category,
        sortOrder: row.sort_order,
        published: row.published,
      }))
    },
  })
}
