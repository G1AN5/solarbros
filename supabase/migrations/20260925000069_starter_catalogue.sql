-- ============================================================================
-- 0069  A CATALOGUE, SO THE QUOTE FLOW CAN PRODUCE A NUMBER
-- ----------------------------------------------------------------------------
-- WHAT WENT WRONG, TRACED BACKWARDS
-- A rep accepted a quotation and got:
--
--   new row for relation "contracts" violates check constraint
--   "contracts_contract_value_check"
--
-- The constraint is right: a contract must be worth something. The quotation
-- was for ₱0 — and it was ₱0 because the quote builder prices its bill of
-- materials from `stock_items`, and that table was empty. Every line came out
-- at zero, so material cost, labour (a percentage of it) and the total were all
-- zero. The quotation saved without complaint, displayed as ₱0, was accepted,
-- and only failed two steps later against a constraint that named none of this.
--
-- Guards now refuse a ₱0 quotation and a ₱0 contract with a sentence that names
-- the empty catalogue. But a guard only turns a confusing failure into a clear
-- one; the business still cannot quote. This is the other half.
--
-- WHAT THESE FIGURES ARE
-- Trade prices for equipment the company already lists as the brands it
-- installs, at levels consistent with the published package prices that
-- migration 0056 fitted. They are a STARTING POINT that makes the system
-- work end to end on day one — the inventory manager corrects them against
-- real supplier invoices, which is a screen that already exists.
--
-- `on_hand` is deliberately 0. Stock arrives by receiving a purchase order, and
-- inventing stock the company does not hold would put a number on the warehouse
-- screen that nobody can go and count.
-- ============================================================================

insert into public.suppliers (name, contact_person, email, phone, lead_time_days)
select v.name, v.contact_person, v.email, v.phone, v.lead_time_days
from (values
  ('Solar Supply PH',        'Accounts', 'sales@example-supplier.ph',   '02-8000-0000', 14),
  ('Inverter Distributors',  'Accounts', 'orders@example-supplier.ph',  '02-8000-0001', 21),
  ('Battery Imports Manila', 'Accounts', 'support@example-supplier.ph', '02-8000-0002', 30)
) as v(name, contact_person, email, phone, lead_time_days)
where not exists (select 1 from public.suppliers);


insert into public.stock_items
  (sku, name, category, brand, unit, unit_cost, reorder_point, is_serialised, supplier_id)
select
  v.sku, v.name, v.category::public.stock_category, v.brand, v.unit,
  v.unit_cost, v.reorder_point, v.is_serialised,
  (select id from public.suppliers where name = v.supplier)
from (values
  -- PANELS. Serialised: each one is warranty-registered to a customer.
  ('PNL-CS-620', 'Canadian Solar 620W Bifacial', 'panel', 'Canadian Solar', 'pc', 9800,  20, true,  'Solar Supply PH'),
  ('PNL-JA-620', 'JA Solar 620W Bifacial',       'panel', 'JA Solar',       'pc', 9500,  20, true,  'Solar Supply PH'),

  -- INVERTERS. Also serialised, and the single most claimed-against item.
  ('INV-DEYE-6',  'Deye 6kW Hybrid Inverter',  'inverter', 'Deye',  'pc', 62000,  3, true, 'Inverter Distributors'),
  ('INV-DEYE-8',  'Deye 8kW Hybrid Inverter',  'inverter', 'Deye',  'pc', 78000,  3, true, 'Inverter Distributors'),
  ('INV-DEYE-12', 'Deye 12kW Hybrid Inverter', 'inverter', 'Deye',  'pc', 104000, 2, true, 'Inverter Distributors'),
  ('INV-SOLIS-5', 'Solis 5kW On-Grid Inverter','inverter', 'Solis', 'pc', 42000,  3, true, 'Inverter Distributors'),

  -- BATTERIES.
  ('BAT-51V-314', '51.2V 314Ah LiFePO4 Battery (16 kWh)', 'battery', 'Ginza', 'pc', 148000, 2, true, 'Battery Imports Manila'),
  ('BAT-51V-100', '51.2V 100Ah LiFePO4 Battery (5.12 kWh)', 'battery', 'Ginza', 'pc', 52000, 4, true, 'Battery Imports Manila'),

  -- RACKING AND BALANCE OF SYSTEM. Not serialised — nobody warranties a rail
  -- by number, and asking a technician to scan forty clamps is how scanning
  -- stops happening at all.
  ('RCK-RAIL-42', 'Aluminium Mounting Rail 4.2m',    'racking',   null, 'pc',  1450, 40, false, 'Solar Supply PH'),
  ('RCK-CLAMP-M', 'Mid Clamp 35mm',                  'racking',   null, 'pc',    85, 200, false, 'Solar Supply PH'),
  ('RCK-CLAMP-E', 'End Clamp 35mm',                  'racking',   null, 'pc',    95, 100, false, 'Solar Supply PH'),
  ('RCK-FOOT-L',  'L-Foot Roof Mount',               'racking',   null, 'pc',   140, 120, false, 'Solar Supply PH'),

  ('ACC-DC-6',   'Solar DC Cable 6mm² (per metre)',  'accessory', null, 'm',     95, 300, false, 'Solar Supply PH'),
  ('ACC-AC-14',  'AC Cable 14mm² (per metre)',       'accessory', null, 'm',    180, 200, false, 'Solar Supply PH'),
  ('ACC-MC4',    'MC4 Connector Pair',               'accessory', null, 'pair',  160,  60, false, 'Solar Supply PH'),
  ('ACC-DCBOX',  'DC Combiner Box with SPD',         'accessory', null, 'pc',   4800,   6, false, 'Solar Supply PH'),
  ('ACC-ACBOX',  'AC Distribution Box with Breaker', 'accessory', null, 'pc',   3900,   6, false, 'Solar Supply PH'),
  ('ACC-EARTH',  'Earthing Rod and Clamp Set',       'accessory', null, 'set',  1250,  10, false, 'Solar Supply PH'),

  ('CHG-MPPT-60', 'MPPT Charge Controller 60A', 'charge_controller', 'SRNE', 'pc', 18500, 2, false, 'Inverter Distributors')
) as v(sku, name, category, brand, unit, unit_cost, reorder_point, is_serialised, supplier)
where not exists (select 1 from public.stock_items);
