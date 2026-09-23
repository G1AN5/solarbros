-- ============================================================================
-- 0056  A PRICE MODEL THE OWNER CAN ACTUALLY CHANGE, AND THE PUBLISHED RANGE
-- ----------------------------------------------------------------------------
-- TWO PROBLEMS, ONE CAUSE.
--
-- 1. The public estimator priced systems from CONSTANTS compiled into
--    src/lib/solar-estimator.ts. The `pricing.*` settings existed, the settings
--    screen offered them, an administrator could edit them and press Save — and
--    the estimator never read one of them. A control that silently does nothing
--    is worse than no control at all, because the owner believes the price
--    changed.
--
-- 2. A flat rate per kW is the wrong shape. The inverter, mounting, switchgear,
--    permits and a day of labour cost much the same whatever size the array is.
--    Against a published Philippine hybrid price list, one rate is out by more
--    than 20% on a 5 kW system while matching a 15 kW one — and the small
--    system is the one a homeowner is most likely to be comparing.
--
-- Base + rate per kWp reproduces that list to within 2% across 5-18 kW:
--
--     4.96 kWp   quoted 337,000   model 331,569   -1.6%
--     6.20 kWp   quoted 378,000   model 379,629   +0.4%
--     9.92 kWp   quoted 533,000   model 523,806   -1.7%
--    12.40 kWp   quoted 614,000   model 619,925   +1.0%
--    18.60 kWp   quoted 866,000   model 860,221   -0.7%
--
-- Every figure below is a SETTING, editable by the administrator and the
-- accountant. The market moves, the peso moves, and a price list that needs a
-- developer is a price list that goes stale.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The fixed half of the price
-- ----------------------------------------------------------------------------

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('pricing.base_cost_on_grid', '95000', 'pricing',
   'Base price (on-grid)',
   'What a job costs before any panels: inverter, mounting, switchgear, permits and labour. Added to the per-kWp rate below.',
   'currency', 'PHP', 0, 2000000, array['admin', 'accountant']::public.user_role[], true, 20),

  ('pricing.base_cost_hybrid', '139000', 'pricing',
   'Base price (hybrid)',
   'As above, and includes the standard battery pack. Fitted so the estimator matches the published hybrid range.',
   'currency', 'PHP', 0, 2000000, array['admin', 'accountant']::public.user_role[], true, 21),

  ('pricing.base_cost_off_grid', '180000', 'pricing',
   'Base price (off-grid)',
   'As above. Higher because an off-grid system needs charge control and more storage before it powers anything at all.',
   'currency', 'PHP', 0, 2000000, array['admin', 'accountant']::public.user_role[], true, 22),

  ('pricing.batteries_included', '3', 'pricing',
   'Battery modules in the base price',
   'How many modules the base price already covers. Only modules beyond this are charged separately — otherwise the pack is paid for twice.',
   'number', 'modules', 0, 20, array['admin', 'accountant']::public.user_role[], true, 23),

  ('pricing.cost_per_battery', '95000', 'pricing',
   'Price per extra battery module',
   'Charged for each module beyond those already covered by the base price.',
   'currency', 'PHP', 0, 500000, array['admin', 'accountant']::public.user_role[], true, 24)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. The per-kWp half, recalibrated
-- ----------------------------------------------------------------------------
-- These were WHOLE-SYSTEM rates (72,000/kW hybrid). They are now MARGINAL rates
-- — the price of one more kWp of panels once the base is paid — so they are
-- necessarily smaller numbers. Relabelled so nobody reads the new figure as a
-- price cut and helpfully puts it back.

update public.settings
set value = '32000',
    label = 'Price per kWp (on-grid)',
    description = 'The price of each additional kWp of panels, on top of the base price. This is not the whole system price.',
    is_public = true
where key = 'pricing.cost_per_kw_on_grid';

update public.settings
set value = '38800',
    label = 'Price per kWp (hybrid)',
    description = 'The price of each additional kWp of panels, on top of the base price. This is not the whole system price.',
    is_public = true
where key = 'pricing.cost_per_kw_hybrid';

update public.settings
set value = '46000',
    label = 'Price per kWp (off-grid)',
    description = 'The price of each additional kWp of panels, on top of the base price. This is not the whole system price.',
    is_public = true
where key = 'pricing.cost_per_kw_off_grid';

-- WHY THESE ARE NOW READABLE WITHOUT SIGNING IN
-- `is_public` decides whether the anonymous estimator can read a row, and every
-- pricing row was false — so a visitor's estimate quietly fell back to the
-- built-in defaults and ignored whatever the owner had set. That is the first
-- bug wearing a different hat, and it would have survived the fix above.
--
-- Publishing them discloses nothing that was not already public: the estimator
-- prints a price for any size a visitor asks for, and two prices determine a
-- straight line, so anyone wanting the base and the rate could read them off in
-- half a minute. These are SELLING PRICES, which competitors publish on their
-- own websites. Supplier costs, margins, discount authority and lead scoring
-- stay internal, where they belong.


-- ----------------------------------------------------------------------------
-- 3. The published range
-- ----------------------------------------------------------------------------
-- Seven hybrid systems at market prices. These are DATA, not code: the
-- administrator edits them under Website Content, and the public packages page
-- reads these rows directly.
--
-- `size_kw` is the REAL array size (panel count x 620 W), not the marketing
-- name. A "5kW system" is 8 x 620 W = 4.96 kWp, and if the estimator sizes
-- against the rounded name instead, every saving and payback figure downstream
-- is overstated — which is the direction that ends in a complaint.
--
-- Seeded only into an empty table, so re-running this can never duplicate a
-- range the owner has since edited by hand.

insert into public.packages
  (name, system_type, size_kw, price_from, segment, featured, ideal_for, inclusions, sort_order)
select v.name,
       v.system_type::public.system_type,
       v.size_kw,
       v.price_from,
       v.segment::public.segment,
       v.featured,
       v.ideal_for,
       v.inclusions,
       v.sort_order
from (values
  ('5kW Hybrid', 'hybrid', 4.96, 337000, 'residential', false,
   'Entry-level hybrid for smaller homes.',
   array['8 x 620W bifacial panels', '16 kWh battery storage', 'Expandable to 14 panels', 'Design, permits and installation'], 1),

  ('6kW Hybrid', 'hybrid', 6.20, 378000, 'residential', true,
   'The most common choice for a Filipino family home.',
   array['10 x 620W bifacial panels', '16 kWh battery storage', 'Expandable to 14 panels', 'Design, permits and installation'], 2),

  ('8kW Hybrid', 'hybrid', 8.68, 467000, 'residential', false,
   'Medium homes running air conditioning most of the day.',
   array['14 x 620W bifacial panels', '16 kWh battery storage', 'Expandable to 24 panels', 'Design, permits and installation'], 3),

  ('10kW Hybrid', 'hybrid', 9.92, 533000, 'residential', false,
   'Larger homes with several aircon units.',
   array['16 x 620W bifacial panels', '16 kWh battery storage', 'Expandable to 30 panels', 'Design, permits and installation'], 4),

  ('12kW Hybrid', 'hybrid', 12.40, 614000, 'residential', false,
   'Large households, or a home with a small business attached.',
   array['20 x 620W bifacial panels', '16 kWh battery storage', 'Expandable to 36 panels', 'Design, permits and installation'], 5),

  ('16kW Hybrid', 'hybrid', 16.12, 760000, 'commercial', false,
   'Commercial premises with a heavy daytime load.',
   array['26 x 620W bifacial panels', '16 kWh battery storage', 'Expandable to 42 panels', 'Design, permits and installation'], 6),

  ('18kW Hybrid', 'hybrid', 18.60, 866000, 'commercial', false,
   'The largest system in the standard range.',
   array['30 x 620W bifacial panels', '16 kWh battery storage', 'Expandable to 42 panels', 'Design, permits and installation'], 7)
) as v(name, system_type, size_kw, price_from, segment, featured, ideal_for, inclusions, sort_order)
where not exists (select 1 from public.packages);

comment on table public.packages is
  'The published system range. Edited under Website Content; read directly by the public packages page and quoted against by sales.';
