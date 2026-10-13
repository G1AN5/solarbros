import { useQuery } from '@tanstack/react-query'

import { useSettings, settingNum, settingText, type Setting } from './settings'
import { throwReadable } from '@/lib/db-error'
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
  /* A hybrid system is most of what this company sells and the battery had no
     warranty figure at all — only panels, inverter and workmanship. */
  warrantyBatteryYears: number
  /** The staged payment split every contract is invoiced by. */
  downPaymentPct: number
  deliveryPct: number
  commissioningPct: number
  /** The two sentences at the top of the home page. */
  heroHeadline: string
  heroSubhead: string
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
    /* No placeholder contact details. These used to fall back to an invented
       number and address, which is what a visitor saw for the first moment of
       every page load — and dialled, if they were quick. Empty is hidden. */
    email: settingText(settings, 'company.email', ''),
    phone: settingText(settings, 'company.phone', ''),
    address: settingText(
      settings,
      'company.address',
      'Warehouse Unit D ACSIE #12 Main Road, Km. 16 West Service Road, South Superhighway, Paranaque, Metro Manila 1700',
    ),
    hours: settingText(settings, 'company.hours', 'Mon-Sat, 8:00 AM - 6:00 PM'),
    facebook: settingText(settings, 'company.facebook', ''),
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
    warrantyBatteryYears: settingNum(settings, 'warranty.battery_years', 8),
    downPaymentPct: settingNum(settings, 'finance.down_payment_pct', 50),
    deliveryPct: settingNum(settings, 'finance.delivery_pct', 35),
    commissioningPct: settingNum(settings, 'finance.commissioning_pct', 15),

    /* The most important sentence on the site was compiled into the bundle, so
       changing it needed a developer and a deploy. The fallbacks are the words
       that used to be hardcoded, which keeps the page sensible if settings are
       slow or unreachable. */
    heroHeadline: settingText(
      settings,
      'home.hero_headline',
      'Cut your electricity bill by up to 70%.',
    ),
    heroSubhead: settingText(
      settings,
      'home.hero_subhead',
      'Design, permits, installation and lifetime after-sales support — handled end to end by one team.',
    ),
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
      if (error) throwReadable(error)

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
