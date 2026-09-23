-- ============================================================================
-- 0057  ONE ROW 0056 COULD NOT REACH
-- ----------------------------------------------------------------------------
-- 0056 published the pricing settings so the anonymous estimator could read
-- them, and inserted the ones that did not exist yet with `on conflict do
-- nothing`. `pricing.cost_per_battery` DID already exist, from migration 0018 —
-- so the insert skipped it and it kept `is_public = false`.
--
-- The value is the same either way today, which is exactly what makes this the
-- sort of thing that goes unnoticed: nothing looks wrong until the day somebody
-- raises the battery price, sees the figure change on the admin screen, and
-- does not notice that the public estimator is still quoting the old one.
--
-- WHAT STAYS PRIVATE
-- `pricing.labour_overhead_pct` and `pricing.default_margin_pct` are not
-- touched. Those are margin, not price — they say what the business keeps, not
-- what the customer pays, and nothing a visitor can see is computed from them.
-- ============================================================================

update public.settings
set is_public = true,
    label = 'Price per extra battery module',
    description = 'Charged for each module beyond those already covered by the base price.'
where key = 'pricing.cost_per_battery';


-- ----------------------------------------------------------------------------
-- A STANDING CHECK, NOT A ONE-OFF FIX
-- ----------------------------------------------------------------------------
-- The underlying fault was not this row. It was that nothing anywhere said
-- which settings the public estimator depends on, so a row could be added
-- private and quietly break the link between the admin screen and the public
-- page — twice now, in the same week.
--
-- This function names them. `npm run verify:rls` calls it, so the next time
-- somebody adds a pricing setting and forgets, a test says so instead of a
-- customer.

create or replace function public.estimator_settings_readable()
returns table (key text, is_public boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.is_public
  from public.settings s
  where s.key in (
    -- Prices the estimator quotes from
    'pricing.base_cost_on_grid',
    'pricing.base_cost_hybrid',
    'pricing.base_cost_off_grid',
    'pricing.cost_per_kw_on_grid',
    'pricing.cost_per_kw_hybrid',
    'pricing.cost_per_kw_off_grid',
    'pricing.cost_per_battery',
    'pricing.batteries_included',
    -- Hardware assumptions the sizing maths depends on
    'pricing.panel_watts',
    'pricing.battery_kwh',
    'pricing.performance_ratio',
    'pricing.inverter_headroom',
    'pricing.sqm_per_kw',
    'pricing.system_lifetime_years'
  )
  order by s.key;
$$;

revoke all on function public.estimator_settings_readable() from public, anon;
grant execute on function public.estimator_settings_readable() to authenticated;

comment on function public.estimator_settings_readable() is
  'The settings the public estimator reads. Every one must be is_public, or the anonymous page silently falls back to the built-in defaults and ignores what the owner set.';
