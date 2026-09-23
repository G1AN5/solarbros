-- ============================================================================
-- 0010 · REFERENCE DATA & DEMONSTRATION SEED
-- ----------------------------------------------------------------------------
-- Two different kinds of data live in this file, and they have different
-- lifetimes:
--
--   REFERENCE DATA (suppliers, stock catalogue, packages, blog posts)
--   Legitimately belongs in a migration. It is configuration the application
--   needs in order to function at all, and every environment wants it.
--
--   DEMONSTRATION DATA (the seven demo accounts and the sample project)
--   Exists so the four portals have something to render and so the whole
--   process flow can be walked through end to end. It is clearly separated
--   below and every row is easy to find and delete.
--
-- ============================================================================
-- BEFORE ANY REAL DEPLOYMENT
-- ----------------------------------------------------------------------------
-- The demo accounts at the bottom of this file have known passwords. They are
-- appropriate for a development project and a graded demonstration; they are
-- not appropriate for a production system holding real customer data.
--
-- Remove them with:
--     delete from auth.users where email like '%@demo.solarbros.ph';
--
-- Profiles, and everything hanging off them, cascade automatically.
-- ============================================================================


-- ============================================================================
-- SUPPLIERS
-- ============================================================================

insert into public.suppliers (id, name, contact_person, email, phone, lead_time_days) values
  ('a1111111-1111-4111-8111-111111111111', 'Solaris Distribution PH', 'Sales Desk', 'orders@solarisph.example', '+63 2 8555 0101', 21),
  ('a2222222-2222-4222-8222-222222222222', 'Pacific Inverter Supply', 'Technical Sales', 'sales@pacificinverter.example', '+63 2 8555 0202', 14),
  ('a3333333-3333-4333-8333-333333333333', 'Metro Racking & Hardware', 'Warehouse', 'orders@metrorack.example', '+63 2 8555 0303', 7);


-- ============================================================================
-- STOCK CATALOGUE
-- Quantities are set so the inventory screens show all three states at once:
-- healthy, below reorder point, and effectively oversold once reserved.
-- ============================================================================

insert into public.stock_items
  (id, sku, name, category, brand, supplier_id, on_hand, reserved, reorder_point, unit_cost, is_serialised) values
  ('b1111111-1111-4111-8111-111111111111', 'PNL-CS-620', 'Canadian Solar 620W Monocrystalline', 'panel', 'Canadian Solar', 'a1111111-1111-4111-8111-111111111111', 180, 0, 60, 8200, true),
  ('b2222222-2222-4222-8222-222222222222', 'PNL-JA-580', 'JA Solar 580W Monocrystalline', 'panel', 'JA Solar', 'a1111111-1111-4111-8111-111111111111', 42, 0, 60, 7600, true),
  ('b3333333-3333-4333-8333-333333333333', 'INV-DEYE-6K', 'Deye 6kW Hybrid Inverter', 'inverter', 'Deye', 'a2222222-2222-4222-8222-222222222222', 14, 0, 6, 78000, true),
  ('b4444444-4444-4444-8444-444444444444', 'INV-HW-5K', 'Huawei 5kW Grid-Tie Inverter', 'inverter', 'Huawei', 'a2222222-2222-4222-8222-222222222222', 9, 0, 5, 62000, true),
  ('b5555555-5555-4555-8555-555555555555', 'BAT-PYL-5K', 'Pylontech US5000 4.8kWh', 'battery', 'Pylontech', 'a2222222-2222-4222-8222-222222222222', 11, 0, 8, 92000, true),
  ('b6666666-6666-4666-8666-666666666666', 'RCK-RAIL-42', 'Aluminium Mounting Rail 4.2m', 'racking', 'Metro', 'a3333333-3333-4333-8333-333333333333', 260, 0, 100, 1450, false),
  ('b7777777-7777-4777-8777-777777777777', 'CTL-MPPT-60', 'MPPT Charge Controller 60A', 'charge_controller', 'Growatt', 'a2222222-2222-4222-8222-222222222222', 4, 0, 6, 18500, true),
  ('b8888888-8888-4888-8888-888888888888', 'ACC-MC4-PR', 'MC4 Connector Pair', 'accessory', 'Generic', 'a3333333-3333-4333-8333-333333333333', 480, 0, 200, 320, false);


-- ============================================================================
-- PACKAGES
-- ============================================================================

insert into public.packages (name, system_type, size_kw, price_from, segment, featured, ideal_for, inclusions, sort_order) values
  ('Starter Home', 'on_grid', 3, 165000, 'residential', false,
   'Bills around PHP 3,000 to PHP 5,000 a month',
   array['5 x 620W monocrystalline panels','3kW grid-tie inverter','Aluminium racking and mounting','Net-metering application assistance','25-year panel performance warranty'], 1),
  ('Family Hybrid', 'hybrid', 6, 510000, 'residential', true,
   'Bills around PHP 8,000 to PHP 14,000 a month',
   array['10 x 620W monocrystalline panels','6kW hybrid inverter','10kWh lithium battery bank','Automatic backup during outages','Mobile monitoring app','25-year panel performance warranty'], 2),
  ('Off-Grid Independence', 'off_grid', 8, 880000, 'residential', false,
   'Remote sites with no reliable grid connection',
   array['14 x 620W monocrystalline panels','8kW off-grid inverter','20kWh lithium battery bank','MPPT charge controllers','Generator auto-changeover','25-year panel performance warranty'], 3),
  ('Commercial Rooftop', 'on_grid', 30, 1650000, 'commercial', false,
   'Warehouses, retail and light manufacturing',
   array['49 x 620W monocrystalline panels','30kW three-phase inverter','Structural engineering assessment','Net-metering and permitting handled end to end','Quarterly preventive maintenance in year one'], 4);


-- ============================================================================
-- BLOG / RESOURCES
-- ============================================================================

insert into public.blog_posts (slug, title, excerpt, category, read_minutes, published, published_at) values
  ('net-metering-explained', 'Net metering in the Philippines, explained simply',
   'What happens to the electricity your roof makes but your house does not use, and how the credit actually appears on your bill.',
   'Guides', 6, true, now() - interval '20 days'),
  ('on-grid-vs-hybrid', 'On-grid or hybrid? A straight answer',
   'Batteries roughly double the price of a system. Here is how to decide whether yours actually needs them.',
   'Guides', 8, true, now() - interval '35 days'),
  ('reading-your-electricity-bill', 'How to read your electricity bill before buying solar',
   'The only two numbers on the bill that matter for sizing, and where to find them.',
   'Guides', 5, true, now() - interval '50 days'),
  ('rainy-season-output', 'What happens to solar output during the rainy season',
   'Honest figures on wet-season production, and why systems are sized on annual averages rather than sunny days.',
   'Technical', 7, true, now() - interval '65 days');


-- ============================================================================
-- ============================================================================
-- DEMONSTRATION DATA BELOW THIS LINE
-- Everything above is reference data. Everything below exists so the portals
-- have something to show, and can be deleted without breaking the schema.
-- ============================================================================
-- ============================================================================


-- ============================================================================
-- DEMO ACCOUNTS · one per role
-- ----------------------------------------------------------------------------
-- Inserted straight into auth.users with a bcrypt hash, which is what Supabase
-- Auth expects. The handle_new_user() trigger from 0001 creates the matching
-- profile automatically; the role is then set below.
--
-- All seven share the password: SolarBros2026!
-- ============================================================================

do $$
declare
  v_users constant text[][] := array[
    ['11111111-0000-4000-8000-000000000001', 'admin@demo.solarbros.ph',      'Alex Reyes',       'admin'],
    ['11111111-0000-4000-8000-000000000002', 'sales@demo.solarbros.ph',      'Sam Cruz',         'sales'],
    ['11111111-0000-4000-8000-000000000003', 'engineer@demo.solarbros.ph',   'Engr. Pat Santos', 'project_engineer'],
    ['11111111-0000-4000-8000-000000000004', 'inventory@demo.solarbros.ph',  'Nina Torres',      'inventory_manager'],
    ['11111111-0000-4000-8000-000000000005', 'accounts@demo.solarbros.ph',   'Bea Lim',          'accountant'],
    ['11111111-0000-4000-8000-000000000006', 'technician@demo.solarbros.ph', 'Rob Dela Cruz',    'technician'],
    ['11111111-0000-4000-8000-000000000007', 'client@demo.solarbros.ph',     'Grace Mendoza',    'client']
  ];
  i integer;
  v_id uuid;
begin
  for i in 1 .. array_length(v_users, 1) loop
    v_id := v_users[i][1]::uuid;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      -- These MUST be empty strings, never NULL. GoTrue scans them into plain
      -- Go `string` fields rather than nullable ones, so a NULL fails at the
      -- row-scan step and every sign-in dies with the misleading error
      -- "Database error querying schema". See 0014 for the full write-up.
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      v_users[i][2],
      -- pgcrypto is installed in the `extensions` schema on Supabase and is
      -- not on the migration runner's search_path, so qualify it explicitly.
      extensions.crypt('SolarBros2026!', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_users[i][3]),
      '', '', '', '', '', '', '', ''
    )
    on conflict (id) do nothing;

    -- Without an identity row, email/password sign-in fails even though the
    -- user exists. This is the step most hand-written seeds forget.
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    )
    values (
      gen_random_uuid(),
      v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_users[i][2], 'email_verified', true),
      'email',
      v_id::text,
      now(), now(), now()
    )
    on conflict (provider, provider_id) do nothing;

    -- handle_new_user() has created the profile; set the role it cannot know.
    update public.profiles
    set role = v_users[i][4]::public.user_role,
        full_name = v_users[i][3]
    where id = v_id;
  end loop;
end $$;

-- Contact details for the demo client, so the portal shows a complete profile.
update public.profiles
set phone = '+63 917 555 0142',
    address = '18 Sampaguita St, Greenpark Village, Cainta, Rizal'
where email = 'client@demo.solarbros.ph';


-- ============================================================================
-- DEMO PIPELINE · leads at several stages, so the CRM board is not empty
-- ============================================================================

insert into public.leads (id, name, email, phone, location, address, monthly_bill, estimated_kw, stage, source, assigned_to, in_service_area, owns_property, is_decision_maker) values
  ('c1111111-1111-4111-8111-111111111111', 'M. Villanueva', 'lead1@example.com', '+63 917 221 8890', 'Antipolo, Rizal', '14 Hilltop Drive, Antipolo, Rizal', 8400, 6, 'new', 'estimator', '11111111-0000-4000-8000-000000000002', true, true, true),
  ('c2222222-2222-4222-8222-222222222222', 'Bright Path Academy', 'lead2@example.com', '+63 2 8544 1120', 'Marikina City', '88 Katipunan Ext, Marikina City', 52000, 35, 'quoted', 'quote_request', '11111111-0000-4000-8000-000000000002', true, true, true),
  ('c3333333-3333-4333-8333-333333333333', 'D. Ocampo', 'lead3@example.com', '+63 998 776 5511', 'Taytay, Rizal', '5 Rizal Ave, Taytay, Rizal', 6100, 4.5, 'site_visit', 'facebook', '11111111-0000-4000-8000-000000000002', true, true, false),
  ('c4444444-4444-4444-8444-444444444444', 'Northgate Logistics', 'lead4@example.com', '+63 2 8877 0033', 'Valenzuela City', 'Lot 3 Industrial Park, Valenzuela City', 118000, 80, 'quoted', 'walk_in', '11111111-0000-4000-8000-000000000002', true, true, true),
  ('c5555555-5555-4555-8555-555555555555', 'R. Santos', 'lead5@example.com', '+63 927 118 4477', 'Pasig City', '22 Shaw Blvd, Pasig City', 4300, 3, 'new', 'estimator', '11111111-0000-4000-8000-000000000002', true, false, true),
  -- The demo client's own lead, which their signed contract came from.
  ('c6666666-6666-4666-8666-666666666666', 'Grace Mendoza', 'client@demo.solarbros.ph', '+63 917 555 0142', 'Cainta, Rizal', '18 Sampaguita St, Greenpark Village, Cainta, Rizal', 11200, 8, 'contract', 'referral', '11111111-0000-4000-8000-000000000002', true, true, true);

update public.leads
set converted_client_id = '11111111-0000-4000-8000-000000000007'
where id = 'c6666666-6666-4666-8666-666666666666';


-- ============================================================================
-- DEMO QUOTATION + CONTRACT
-- ----------------------------------------------------------------------------
-- Executing the contract below is what fires on_contract_executed() from 0008,
-- which creates the project, lays out the seven milestones, reserves the stock
-- and raises the down-payment invoice. Nothing here creates those by hand: they
-- are produced by the same trigger that will run in the live application, which
-- is what makes this seed a genuine test of the automation.
-- ============================================================================

insert into public.quotations (
  id, reference, lead_id, version, system_kw, system_type, panel_count, battery_count,
  material_cost, labour_cost, margin_pct, total_price, status, prepared_by, valid_until, sent_at, responded_at
) values (
  'd1111111-1111-4111-8111-111111111111',
  'QTN-2026-1001',
  'c6666666-6666-4666-8666-666666666666',
  1, 8, 'hybrid', 13, 2,
  402000, 72000, 35, 680000,
  'accepted',
  '11111111-0000-4000-8000-000000000002',
  current_date + 30,
  now() - interval '30 days',
  now() - interval '28 days'
);

insert into public.quotation_lines (quotation_id, stock_item_id, description, quantity, unit_price, sort_order) values
  ('d1111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111', 'Canadian Solar 620W Monocrystalline', 13, 8200, 1),
  ('d1111111-1111-4111-8111-111111111111', 'b3333333-3333-4333-8333-333333333333', 'Deye 6kW Hybrid Inverter', 1, 78000, 2),
  ('d1111111-1111-4111-8111-111111111111', 'b5555555-5555-4555-8555-555555555555', 'Pylontech US5000 4.8kWh', 2, 92000, 3),
  ('d1111111-1111-4111-8111-111111111111', 'b6666666-6666-4666-8666-666666666666', 'Aluminium Mounting Rail 4.2m', 22, 1450, 4),
  ('d1111111-1111-4111-8111-111111111111', 'b8888888-8888-4888-8888-888888888888', 'MC4 Connector Pair', 28, 320, 5);

-- Created as draft, then executed in a second statement so the trigger sees a
-- genuine status transition rather than an insert.
insert into public.contracts (
  id, reference, quotation_id, lead_id, client_id, contract_value, status
) values (
  'e1111111-1111-4111-8111-111111111111',
  'CON-2026-1001',
  'd1111111-1111-4111-8111-111111111111',
  'c6666666-6666-4666-8666-666666666666',
  '11111111-0000-4000-8000-000000000007',
  680000,
  'draft'
);

update public.contracts
set status = 'executed',
    client_signed_at = now() - interval '26 days',
    client_signature_name = 'Grace Mendoza',
    company_signed_at = now() - interval '25 days',
    company_signed_by = '11111111-0000-4000-8000-000000000001'
where id = 'e1111111-1111-4111-8111-111111111111';


-- ============================================================================
-- ADVANCE THE DEMO PROJECT
-- ----------------------------------------------------------------------------
-- Walk the project partway through installation, again by driving the same
-- triggers the application will drive. Completing ac_wiring raises the delivery
-- invoice automatically, so the billing screens have something real to show.
-- ============================================================================

do $$
declare
  v_project uuid;
begin
  select id into v_project from public.projects
  where contract_id = 'e1111111-1111-4111-8111-111111111111';

  if v_project is null then
    raise notice 'Demo project was not created; contract trigger did not fire.';
    return;
  end if;

  -- Crew assignment. The technician's /field Today list reads this.
  insert into public.project_crew (project_id, user_id, crew_role) values
    (v_project, '11111111-0000-4000-8000-000000000006', 'lead_technician'),
    (v_project, '11111111-0000-4000-8000-000000000003', 'project_engineer')
  on conflict do nothing;

  update public.projects
  set assigned_engineer = '11111111-0000-4000-8000-000000000003',
      status = 'in_progress',
      start_date = current_date - 20,
      target_turnover = current_date + 7
  where id = v_project;

  -- Permits: one approved, one still under review, so the permitting track and
  -- the external-party proxy pattern are both visible.
  insert into public.permits (project_id, permit_type, authority, status, submitted_at, decided_at, external_reference, recorded_by, fee_amount) values
    (v_project, 'lgu_building', 'Paranaque City Hall', 'approved', now() - interval '18 days', now() - interval '12 days', 'BP-2026-04417', '11111111-0000-4000-8000-000000000003', 8500),
    (v_project, 'net_metering', 'Meralco', 'under_review', now() - interval '10 days', null, 'NM-2026-88214', null, 3200);

  -- Milestones. Updated one at a time so on_milestone_completed() fires for
  -- each, queueing the client notifications exactly as it will in production.
  update public.project_milestones
  set status = 'done', completed_at = now() - interval '18 days',
      completed_by = '11111111-0000-4000-8000-000000000003'
  where project_id = v_project and key = 'engineering_survey';

  update public.project_milestones
  set status = 'done', completed_at = now() - interval '11 days',
      completed_by = '11111111-0000-4000-8000-000000000003'
  where project_id = v_project and key = 'permitting';

  update public.project_milestones
  set status = 'done', completed_at = now() - interval '4 days',
      completed_by = '11111111-0000-4000-8000-000000000006'
  where project_id = v_project and key = 'structural_mounting';

  update public.project_milestones
  set status = 'in_progress',
      note = 'String 2 pending: awaiting MC4 connectors from the warehouse.'
  where project_id = v_project and key = 'dc_wiring';

  -- Serialised assets from the technician's scans.
  insert into public.serialised_assets
    (serial_number, stock_item_id, product_name, project_id, client_id, installed_at, warranty_years, scanned_by) values
    ('CS620-2026-118842', 'b1111111-1111-4111-8111-111111111111', 'Canadian Solar 620W Monocrystalline', v_project, '11111111-0000-4000-8000-000000000007', current_date - 4, 25, '11111111-0000-4000-8000-000000000006'),
    ('CS620-2026-118843', 'b1111111-1111-4111-8111-111111111111', 'Canadian Solar 620W Monocrystalline', v_project, '11111111-0000-4000-8000-000000000007', current_date - 4, 25, '11111111-0000-4000-8000-000000000006'),
    ('DEYE6K-2026-00417', 'b3333333-3333-4333-8333-333333333333', 'Deye 6kW Hybrid Inverter', v_project, '11111111-0000-4000-8000-000000000007', current_date - 4, 10, '11111111-0000-4000-8000-000000000006');

  -- Settle the down payment, which drives recalculate_invoice_totals() and
  -- rolls the amount up onto the project.
  insert into public.payments (invoice_id, amount, payment_method, reference, verified, verified_by, verified_at, recorded_by)
  select id, amount, 'bank_transfer', 'BPI-TRF-2026-77120', true,
         '11111111-0000-4000-8000-000000000005', now() - interval '24 days',
         '11111111-0000-4000-8000-000000000005'
  from public.invoices
  where project_id = v_project and stage = 'down_payment';

  -- Appointments: one dispatched for today so the field portal is not empty.
  insert into public.appointments
    (appointment_type, status, scheduled_date, time_slot, client_id, project_id, contact_name, contact_phone, address, notes)
  values
    ('installation', 'dispatched', current_date, '08:00 - 17:00',
     '11111111-0000-4000-8000-000000000007', v_project, 'Grace Mendoza', '+63 917 555 0142',
     '18 Sampaguita St, Greenpark Village, Cainta, Rizal', 'Day 3 of 3 - DC wiring continuation.');

  insert into public.appointment_assignees (appointment_id, user_id, assigned_by)
  select a.id, '11111111-0000-4000-8000-000000000006', '11111111-0000-4000-8000-000000000003'
  from public.appointments a
  where a.project_id = v_project and a.appointment_type = 'installation';

  -- An open support ticket.
  insert into public.tickets (reference, subject, description, client_id, project_id, priority, status, category)
  values ('TKT-2026-1001', 'Monitoring app not showing yesterday''s production',
          'The app showed no data for the whole of yesterday, though the inverter display looks normal.',
          '11111111-0000-4000-8000-000000000007', v_project, 'normal', 'in_progress', 'performance');
end $$;


-- ============================================================================
-- UNASSIGNED BOOKINGS · so the dispatch board has a queue to work through
-- ============================================================================

insert into public.appointments
  (appointment_type, status, scheduled_date, time_slot, lead_id, contact_name, contact_phone, address, notes) values
  ('site_survey', 'requested', current_date + 1, '09:00 - 11:00', 'c3333333-3333-4333-8333-333333333333', 'D. Ocampo', '+63 998 776 5511', '5 Rizal Ave, Taytay, Rizal', 'Two-storey, concrete roof deck.'),
  ('virtual_consultation', 'requested', current_date + 2, '14:00 - 14:30', 'c1111111-1111-4111-8111-111111111111', 'M. Villanueva', '+63 917 221 8890', 'Antipolo, Rizal', null);


-- ============================================================================
-- PUBLIC CONTENT · moderated reviews and portfolio entries
-- Attribution is by role and location, never by an invented personal name.
-- ============================================================================

insert into public.reviews (rating, quote, display_name, display_location, system_summary, status, published, moderated_by, moderated_at) values
  (5, 'Our bill went from PHP 7,600 to under PHP 1,200. The crew finished in three days and cleaned up everything. The portal let me watch each stage get ticked off.', 'Homeowner', 'San Mateo, Rizal', '5.5kW On-Grid', 'approved', true, '11111111-0000-4000-8000-000000000001', now() - interval '40 days'),
  (5, 'They handled the net-metering paperwork end to end, which was the part we were dreading. Payback on our numbers works out to just under five years.', 'Private school', 'Marikina City', '35kW Commercial', 'approved', true, '11111111-0000-4000-8000-000000000001', now() - interval '25 days'),
  (4, 'Honest sizing. They actually talked me down from a bigger system than I needed. Installation was clean and the monitoring app is easy for my parents to use.', 'Homeowner', 'Taytay, Rizal', '4.5kW Hybrid', 'approved', true, '11111111-0000-4000-8000-000000000001', now() - interval '10 days');

insert into public.portfolio_items (title, location, system_size, segment, year, published, sort_order) values
  ('Hillside Residence', 'Antipolo, Rizal', '10kW Hybrid', 'Residential', 2026, true, 1),
  ('Private School Rooftop', 'Marikina City', '35kW On-Grid', 'Commercial', 2026, true, 2),
  ('Coastal Resort', 'Batangas', '45kW Hybrid', 'Hospitality', 2025, true, 3),
  ('Cold Storage Facility', 'Valenzuela City', '80kW On-Grid', 'Industrial', 2025, true, 4),
  ('Poultry Farm', 'Bulacan', '25kW Off-Grid', 'Agricultural', 2025, true, 5),
  ('Townhouse Cluster', 'Cainta, Rizal', '6kW Hybrid', 'Residential', 2026, true, 6);
