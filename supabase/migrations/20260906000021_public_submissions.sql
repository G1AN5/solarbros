-- ============================================================================
-- 0021 · PUBLIC FORM SUBMISSIONS
-- ----------------------------------------------------------------------------
-- Replaces three open table-level INSERT policies with three validated
-- functions, and closes the direct anon write path entirely.
--
-- WHAT WAS WRONG WITH THE OLD ARRANGEMENT
-- Migration 0007 gave `anon` INSERT on leads, estimates and appointments with
-- `with check (true)`. That is the standard recipe for a public contact form and
-- it is not a data leak — anon still cannot SELECT any of them. But it has three
-- practical problems:
--
--   1. NO VALIDATION. `with check (true)` accepts a lead whose name is 4 MB of
--      text, an appointment booked for the year 3000, and an estimate claiming a
--      900 kW residential system. The forms validate in the browser, which stops
--      exactly nobody: the endpoint is a plain HTTPS POST with a key printed in
--      the JavaScript bundle.
--
--   2. NO THROTTLE. One loop fills the CRM with junk, and sales loses the
--      ability to tell a real enquiry from noise. That is not a data breach; it
--      is worse in practice, because it destroys the usefulness of the tool the
--      business actually runs on.
--
--   3. THE ESTIMATOR COULD NOT WORK AT ALL. Saving a lead and then attaching an
--      estimate to it needs the new lead's id, and reading an id back is a
--      SELECT — which anon is correctly refused. PostgREST reports this as
--      "new row violates row-level security policy", which reads like a policy
--      bug and is not one: the INSERT succeeded and the RETURNING clause was
--      denied. Any client-side workaround (letting the browser choose the UUID,
--      or granting anon a narrow SELECT) trades a real security property for a
--      convenience.
--
-- All three dissolve if the submission happens in one server-side call.
--
-- WHY SECURITY DEFINER IS SAFE HERE, HAVING BEEN DANGEROUS IN 0009
-- 0009 revoked anon's EXECUTE on every SECURITY DEFINER function precisely
-- because such a function ignores RLS. The rule it established was: never expose
-- one to anon unless the function itself is the authorisation boundary.
--
-- These three are written to be exactly that. They take only the fields a form
-- can legitimately supply, so `stage`, `score`, `assigned_to` and
-- `converted_client_id` cannot be set by a caller. They return void — nothing
-- flows back out, so they cannot be turned into a read primitive. And they
-- validate before writing.
--
-- WHAT THIS STILL DOES NOT DO
-- The throttle counts recent submissions per email address, which stops
-- accidental double-clicks and casual abuse, and is trivially defeated by
-- anybody willing to vary the address. Genuine protection is a CAPTCHA plus
-- edge rate limiting by IP, both of which live outside Postgres. This narrows
-- the opening; it does not close it. The pre-production checklist in
-- docs/BUILD-PLAN.md carries the CAPTCHA item.
-- ============================================================================


-- ============================================================================
-- 1 · THE THROTTLE LIMIT, AS A SETTING
-- ----------------------------------------------------------------------------
-- A number the business tunes rather than a constant a developer owns. During a
-- promotion a household may legitimately submit several enquiries in an hour;
-- during an attack the admin wants it at 1 without waiting for a deploy.
-- ============================================================================

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('security.public_form_limit_per_hour', '5', 'security',
   'Public form submissions per hour',
   'How many times one email address may submit the estimator, contact or booking form in an hour. Lower it if the website is being spammed; raise it during a campaign. Not a substitute for the CAPTCHA.',
   'number', 'submissions', 1, 100, array['admin']::public.user_role[], false, 1)
on conflict (key) do nothing;


-- ============================================================================
-- 2 · SHARED VALIDATION
-- ----------------------------------------------------------------------------
-- One place, so the three forms cannot drift apart on what counts as a valid
-- name or a plausible email.
-- ============================================================================

create or replace function public.validate_public_contact(
  p_name text,
  p_email text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Please tell us your name.' using errcode = '22023';
  end if;

  if length(p_name) > 120 then
    raise exception 'That name is too long.' using errcode = '22023';
  end if;

  -- Deliberately loose. Strict email regexes reject valid addresses far more
  -- often than they catch invalid ones, and the address is confirmed by the
  -- reply landing (or not landing) anyway.
  if p_email is null or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right.' using errcode = '22023';
  end if;

  if length(p_email) > 200 then
    raise exception 'That email address is too long.' using errcode = '22023';
  end if;
end;
$$;


/**
 * Refuse a submission when this address has been busy in the last hour.
 *
 * Counts leads rather than tracking a separate rate-limit table: the leads
 * table is already the record of every public submission, and a counter that
 * can drift out of step with the thing it counts is a bug waiting to happen.
 */
create or replace function public.check_public_form_rate(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_recent integer;
begin
  v_limit := public.setting_num('security.public_form_limit_per_hour', 5)::integer;

  select count(*) into v_recent
  from public.leads
  where lower(email) = lower(p_email)
    and created_at > now() - interval '1 hour';

  if v_recent >= v_limit then
    raise exception
      'We have already received several enquiries from this email address. Please call us instead — we would rather talk to you.'
      using errcode = '53400';
  end if;
end;
$$;


-- ============================================================================
-- 3 · CONTACT FORM  ->  a lead
-- ============================================================================

create or replace function public.submit_enquiry(
  p_name text,
  p_email text,
  p_phone text default null,
  p_address text default null,
  p_monthly_bill numeric default null,
  p_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.validate_public_contact(p_name, p_email);
  perform public.check_public_form_rate(p_email);

  insert into public.leads (
    name, email, phone, address, location, monthly_bill, source, qualification_notes
  )
  values (
    trim(p_name),
    lower(trim(p_email)),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    -- A bill above a million pesos a month is a typo, not a customer.
    case when p_monthly_bill between 0 and 1000000 then p_monthly_bill end,
    'quote_request',
    nullif(left(trim(coalesce(p_message, '')), 2000), '')
  );
end;
$$;


-- ============================================================================
-- 4 · ESTIMATOR  ->  a lead AND the appliance profile
-- ----------------------------------------------------------------------------
-- The computed figures arrive as one jsonb rather than twenty parameters, and
-- only known keys are read out of it. An unexpected key is ignored, so the
-- payload cannot reach a column the form has no business setting.
--
-- The figures are stored as the visitor was shown them. Recomputing later
-- against changed settings would quietly rewrite what the customer believes
-- they were quoted, which is the sort of thing that ends up in a complaint.
-- ============================================================================

create or replace function public.submit_estimate(
  p_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_appliances jsonb,
  p_estimate jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
  v_recommended_kw numeric;
begin
  perform public.validate_public_contact(p_name, p_email);
  perform public.check_public_form_rate(p_email);

  if p_appliances is null or jsonb_typeof(p_appliances) <> 'array' then
    raise exception 'The appliance list is missing.' using errcode = '22023';
  end if;

  -- A household does not have 200 distinct appliances. This is a size guard,
  -- not a modelling opinion.
  if jsonb_array_length(p_appliances) > 200 then
    raise exception 'That is more appliances than we can size for online. Please contact us directly.'
      using errcode = '22023';
  end if;

  if length(p_appliances::text) > 60000 then
    raise exception 'The appliance list is too large.' using errcode = '22023';
  end if;

  v_recommended_kw := (p_estimate ->> 'recommendedKw')::numeric;

  insert into public.leads (
    name, email, phone, address, location, monthly_bill, estimated_kw, source
  )
  values (
    trim(p_name),
    lower(trim(p_email)),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    case
      when (p_estimate ->> 'currentMonthlyCost')::numeric between 0 and 1000000
      then round((p_estimate ->> 'currentMonthlyCost')::numeric)
    end,
    case when v_recommended_kw between 0 and 10000 then v_recommended_kw end,
    'estimator'
  )
  returning id into v_lead_id;

  insert into public.estimates (
    lead_id, contact_email, appliances, usage_pattern, region_id,
    rate_per_kwh, roof_area_sqm, stated_monthly_bill,
    peak_load_w, daily_wh, monthly_kwh,
    recommended_kw, system_type, panel_count, inverter_kw, battery_count,
    estimated_cost, monthly_savings, payback_years
  )
  values (
    v_lead_id,
    lower(trim(p_email)),
    p_appliances,
    coalesce(nullif(left(p_estimate ->> 'usagePattern', 40), ''), 'balanced'),
    coalesce(nullif(left(p_estimate ->> 'regionId', 40), ''), 'ncr'),
    (p_estimate ->> 'ratePerKwh')::numeric,
    (p_estimate ->> 'roofAreaSqm')::numeric,
    (p_estimate ->> 'statedMonthlyBill')::numeric,
    coalesce((p_estimate ->> 'peakLoadW')::numeric, 0),
    coalesce((p_estimate ->> 'dailyWh')::numeric, 0),
    coalesce((p_estimate ->> 'monthlyKwh')::numeric, 0),
    v_recommended_kw,
    -- An unrecognised value becomes null rather than aborting the whole
    -- submission: losing the lead over a bad enum label would be a poor trade.
    case p_estimate ->> 'systemType'
      when 'on_grid' then 'on_grid'::public.system_type
      when 'hybrid'  then 'hybrid'::public.system_type
      when 'off_grid' then 'off_grid'::public.system_type
    end,
    (p_estimate ->> 'panelCount')::integer,
    (p_estimate ->> 'inverterKw')::numeric,
    coalesce((p_estimate ->> 'batteryCount')::integer, 0),
    (p_estimate ->> 'estimatedCost')::numeric,
    (p_estimate ->> 'monthlySavings')::numeric,
    (p_estimate ->> 'paybackYears')::numeric
  );
end;
$$;


-- ============================================================================
-- 5 · BOOKING  ->  a lead AND an unassigned appointment
-- ----------------------------------------------------------------------------
-- Only the two publicly bookable types are accepted. Installation and
-- maintenance visits require an active project and are scheduled from inside
-- the client portal; letting a stranger book one would put a crew on a van for
-- a job that does not exist.
-- ============================================================================

create or replace function public.request_booking(
  p_appointment_type text,
  p_scheduled_date date,
  p_time_slot text,
  p_name text,
  p_email text,
  p_phone text,
  p_address text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
  v_type public.appointment_type;
begin
  perform public.validate_public_contact(p_name, p_email);
  perform public.check_public_form_rate(p_email);

  if p_appointment_type not in ('virtual_consultation', 'site_survey') then
    raise exception 'That kind of visit cannot be booked from the website.' using errcode = '22023';
  end if;
  v_type := p_appointment_type::public.appointment_type;

  if p_scheduled_date is null or p_scheduled_date < current_date then
    raise exception 'Please choose a date that has not already passed.' using errcode = '22023';
  end if;

  if p_scheduled_date > current_date + interval '180 days' then
    raise exception 'We only take bookings six months ahead.' using errcode = '22023';
  end if;

  if p_time_slot !~ '^[0-2][0-9]:[0-5][0-9]$' then
    raise exception 'Please choose a time slot.' using errcode = '22023';
  end if;

  -- Somebody asking for a survey is a prospect whether or not they turn up, so
  -- sales gets the lead either way.
  insert into public.leads (name, email, phone, address, location, source)
  values (
    trim(p_name),
    lower(trim(p_email)),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    'quote_request'
  )
  returning id into v_lead_id;

  insert into public.appointments (
    appointment_type, status, scheduled_date, time_slot,
    lead_id, contact_name, contact_phone, address, notes
  )
  values (
    v_type,
    'requested',
    p_scheduled_date,
    p_time_slot,
    v_lead_id,
    trim(p_name),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    nullif(left(trim(coalesce(p_notes, '')), 2000), '')
  );
end;
$$;


-- ============================================================================
-- 6 · GRANTS
-- ----------------------------------------------------------------------------
-- Deny by default, then grant back deliberately — the rule established in 0009.
-- These three are the only SECURITY DEFINER functions in the schema that anon
-- may execute, which is why the authorisation reasoning is written out at the
-- top of this file rather than assumed.
--
-- The two helpers stay closed to everyone: they are called from inside the
-- three functions above, which run as owner, so they need no grant of their own.
-- ============================================================================

revoke all on function public.validate_public_contact(text, text) from public, anon, authenticated;
revoke all on function public.check_public_form_rate(text) from public, anon, authenticated;

revoke all on function public.submit_enquiry(text, text, text, text, numeric, text)
  from public, anon, authenticated;
revoke all on function public.submit_estimate(text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.request_booking(text, date, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.submit_enquiry(text, text, text, text, numeric, text)
  to anon, authenticated;
grant execute on function public.submit_estimate(text, text, text, text, jsonb, jsonb)
  to anon, authenticated;
grant execute on function public.request_booking(text, date, text, text, text, text, text, text)
  to anon, authenticated;


-- ============================================================================
-- 7 · CLOSE THE DIRECT ANON WRITE PATH
-- ----------------------------------------------------------------------------
-- With the functions in place, the open INSERT policies are a second, unguarded
-- door into the same room. A validated entrance means nothing while the window
-- next to it is unlatched.
--
-- Each policy covered `anon` AND `authenticated`, so dropping it would also
-- stop staff creating a lead from the CRM and a client booking a maintenance
-- visit from their portal. Those paths get their own explicit policies — which
-- is an improvement in its own right, because "the public insert policy" was
-- doing three unrelated jobs and its name described only one of them.
-- ============================================================================

drop policy if exists leads_insert_public on public.leads;
drop policy if exists estimates_insert_public on public.estimates;
drop policy if exists appointments_insert_public on public.appointments;

-- Staff adding a walk-in or a referral by hand.
create policy leads_insert_staff on public.leads
  for insert to authenticated
  with check (public.has_role('sales', 'project_engineer', 'admin'));

-- A sales engineer sizing a system for a customer on the phone.
create policy estimates_insert_staff on public.estimates
  for insert to authenticated
  with check (public.is_staff());

-- A signed-in customer booking a visit for THEIR OWN account. The check on
-- client_id is what stops one customer booking a crew in another's name.
create policy appointments_insert_client on public.appointments
  for insert to authenticated
  with check (client_id = (select auth.uid()));

comment on function public.submit_enquiry(text, text, text, text, numeric, text) is
  'Public contact form. Validates and throttles; returns nothing.';
comment on function public.submit_estimate(text, text, text, text, jsonb, jsonb) is
  'Public estimator. Creates a lead and stores the appliance profile behind it.';
comment on function public.request_booking(text, date, text, text, text, text, text, text) is
  'Public booking form. Creates a lead and an unassigned appointment awaiting dispatch.';
