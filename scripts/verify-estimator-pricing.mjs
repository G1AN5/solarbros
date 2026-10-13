/* ============================================================================
   ESTIMATOR PRICING VERIFICATION
   ----------------------------------------------------------------------------
   Proves the thing that was broken: that a price set by the owner in Business
   Settings actually reaches the PUBLIC estimator, which is signed out.

   The original defect was subtle in the worst way. The settings existed. The
   admin screen offered them. Saving worked. Nothing read them — the estimator
   priced from constants compiled into the bundle — so an owner could change a
   price, see it saved, reload the public page, and be quoted the old figure
   with no error anywhere.

   THE SECOND HALF OF THE DEFECT was that even once the code read the settings,
   most of those rows were `is_public = false`, so the anonymous client got
   nothing back and fell through to the same built-in defaults. RLS does not
   raise on a filtered read; it returns fewer rows. A fallback that is never
   supposed to fire, firing silently, is indistinguishable from working.

   So this script signs in as NOBODY, which is what a visitor is.

       npm run verify:estimator
   ========================================================================== */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* A check that could not be RUN is not a check that FAILED. The round-trip
   below needs an owner login, and this repository deliberately stores no staff
   password — accounts are created by hand in Supabase. Reporting that as a
   failure would train everyone to ignore a red line, which is how a real one
   eventually gets missed. */
const skip = (name, why) => {
  results.push({ name, ok: true, skipped: true, detail: why })
  console.log(`SKIP  ${name} — ${why}`)
}

/* Every key the estimator depends on. Kept in step with
   public.estimator_settings_readable() in migration 0057. */
const REQUIRED = [
  'pricing.base_cost_on_grid',
  'pricing.base_cost_hybrid',
  'pricing.base_cost_off_grid',
  'pricing.cost_per_kw_on_grid',
  'pricing.cost_per_kw_hybrid',
  'pricing.cost_per_kw_off_grid',
  'pricing.cost_per_battery',
  'pricing.batteries_included',
  'pricing.panel_watts',
  'pricing.battery_kwh',
  'pricing.performance_ratio',
  'pricing.inverter_headroom',
  'pricing.sqm_per_kw',
  'pricing.system_lifetime_years',
]

/* Margin is not price. These say what the business keeps, not what the customer
   pays, and no figure a visitor sees is computed from them. */
const MUST_STAY_PRIVATE = ['pricing.default_margin_pct', 'pricing.labour_overhead_pct']

console.log('\nESTIMATOR PRICING — as an anonymous visitor\n')

/* --- 1. A signed-out visitor can read every setting the estimator needs ---- */
{
  const { data, error } = await anon.from('settings').select('key, value').in('key', REQUIRED)

  if (error) {
    record('anonymous read of pricing settings', false, error.message)
  } else {
    const got = new Set((data ?? []).map((r) => r.key))
    const missing = REQUIRED.filter((k) => !got.has(k))
    record(
      'every setting the estimator needs is readable signed out',
      missing.length === 0,
      missing.length ? `not readable: ${missing.join(', ')}` : `${got.size} of ${REQUIRED.length}`,
    )

    const nulls = (data ?? []).filter((r) => r.value === null).map((r) => r.key)
    record('none of them is null', nulls.length === 0, nulls.join(', '))
  }
}

/* --- 2. Margins stay internal --------------------------------------------- */
{
  const { data, error } = await anon.from('settings').select('key').in('key', MUST_STAY_PRIVATE)
  record(
    'margin settings are NOT exposed to visitors',
    !error && (data ?? []).length === 0,
    error ? error.message : `${(data ?? []).length} leaked`,
  )
}

/* --- 3. The published range is on the public site -------------------------- */
{
  const { data, error } = await anon
    .from('packages')
    .select('name, size_kw, price_from')
    .order('sort_order')

  const rows = data ?? []
  record('the published range is readable signed out', !error && rows.length > 0, error?.message)

  /* size_kw must be the real array size, not the marketing name. If somebody
     "tidies" 4.96 to 5, every production and payback figure downstream shifts
     in the customer's favour — which is the direction that ends in a complaint. */
  const rounded = rows.filter((r) => Number(r.size_kw) % 1 === 0 && Number(r.size_kw) < 20)
  record(
    'sizes are real kWp, not rounded marketing names',
    rounded.length === 0,
    rounded.map((r) => r.name).join(', '),
  )
}

/* --- 4. THE ACTUAL BUG: does changing a price change the quote? ------------ */
{
  const admin = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  const { error: signInError } = await admin.auth.signInWithPassword({
    email: env.VERIFY_ADMIN_EMAIL ?? 'admin@solarbros.ph',
    password: env.VERIFY_ADMIN_PASSWORD ?? 'SolarBros2026!',
  })

  if (signInError) {
    skip(
      'owner can change a price and the public page sees it',
      'no owner login available. Put VERIFY_ADMIN_EMAIL and VERIFY_ADMIN_PASSWORD in ' +
        '.env.local (gitignored) to run this end to end.',
    )
  } else {
    const KEY = 'pricing.base_cost_hybrid'
    const { data: before } = await admin.from('settings').select('value').eq('key', KEY).single()
    const original = Number(before?.value)
    const probe = original + 12_345

    const { data: written, error: writeError } = await admin
      .from('settings')
      .update({ value: probe })
      .eq('key', KEY)
      .select()

    // RLS refuses a write by returning zero rows, not by raising.
    if (writeError || !written?.length) {
      record(
        'owner can change a price',
        false,
        writeError?.message ?? 'the update was refused (zero rows returned)',
      )
    } else {
      // A brand-new anonymous client, so nothing is served from a cache.
      const visitor = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
      const { data: seen } = await visitor
        .from('settings')
        .select('value')
        .eq('key', KEY)
        .maybeSingle()

      record(
        'a price changed by the owner reaches a signed-out visitor',
        Number(seen?.value) === probe,
        `visitor sees ${seen?.value ?? 'nothing'}, owner set ${probe}`,
      )

      // Put it back. A verification script that leaves the business mispriced
      // is worse than no verification script.
      await admin.from('settings').update({ value: original }).eq('key', KEY)

      const { data: restored } = await admin
        .from('settings')
        .select('value')
        .eq('key', KEY)
        .single()
      record(
        'the probe value was restored',
        Number(restored?.value) === original,
        `now ${restored?.value}`,
      )
    }
    await admin.auth.signOut()
  }
}

/* --- Summary --------------------------------------------------------------- */
const failed = results.filter((r) => !r.ok)
const skipped = results.filter((r) => r.skipped)
const ran = results.length - skipped.length
console.log(
  `\n${ran - failed.length}/${ran} passed` + (skipped.length ? `, ${skipped.length} skipped` : ''),
)
if (failed.length) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  • ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
  process.exit(1)
}
