-- ============================================================================
-- 0076 · ENQUIRY CONTINUITY
-- ----------------------------------------------------------------------------
-- Found walking the demonstration through, end to end, as each role.
--
-- 1. A CUSTOMER COULD NOT SEE A QUOTATION SENT TO THEM.
--    `quotations_read_own` checked ownership with a sub-query on `leads` — a
--    table customers may not read. Row Level Security applies inside the
--    sub-query too, so the check found no lead and refused every row. The
--    quotation was sent, the customer was notified, and their portal showed
--    nothing to accept. A SECURITY DEFINER helper answers the one question
--    the policy needs ("is this enquiry mine?") without opening `leads`.
--
-- 2. ONE PERSON, SEVERAL ENQUIRIES.
--    The estimator, the contact form and the booking page each created a new
--    lead. Someone who estimated and then booked a survey appeared to Sales as
--    two people, at two stages, with the estimate on one card and the survey on
--    the other. A submission from an email that already has an enquiry in
--    progress — new, quoted or surveyed, with no live contract — now joins
--    that enquiry, and Sales is told about the new submission all the same.
--    Once a contract exists, a new submission is a new enquiry (an upgrade, a
--    second property), as before.
--
-- 3. A VISIT WITH NO PHONE NUMBER.
--    A visit booked against a project took its contact details from the
--    customer's account — and an account created without a phone number left
--    the crew with "No phone on file", although the enquiry had one.
--
-- 4. TRIGGER FUNCTIONS ARE NOT AN API.
--    Functions that only ever run as triggers were left executable through the
--    REST API by the earlier migrations. They cannot do anything when called
--    that way, but the convention here is to revoke them, and the security
--    advisor flags each one.
-- ============================================================================


-- ============================================================================
-- 1. "IS THIS ENQUIRY MINE?"
-- ============================================================================

create or replace function public.owns_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.converted_client_id = (select auth.uid())
  );
$$;

revoke all on function public.owns_lead(uuid) from public, anon;
grant execute on function public.owns_lead(uuid) to authenticated;

comment on function public.owns_lead(uuid) is
  'True when the enquiry belongs to the signed-in customer. For policies on tables that hang off leads, which customers may not read directly.';

drop policy if exists quotations_read_own on public.quotations;
create policy quotations_read_own on public.quotations
  for select to authenticated
  using (
    status in ('sent', 'accepted', 'rejected', 'expired')
    and public.owns_lead(lead_id)
  );


-- ============================================================================
-- 2. ONE ENQUIRY PER PERSON WHILE IT IS IN PROGRESS
-- ============================================================================

/* The enquiry a new submission from this email should join, if any. */
create or replace function public.open_enquiry_for(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.leads l
  where lower(l.email) = lower(btrim(p_email))
    and l.stage in ('new', 'quoted', 'site_visit')
    and l.created_at > now() - interval '180 days'
    and not exists (
      select 1 from public.contracts c
      where c.lead_id = l.id and c.status <> 'cancelled'
    )
  order by l.created_at desc
  limit 1;
$$;

revoke all on function public.open_enquiry_for(text) from public, anon, authenticated;


/* What Sales and the enquirer are told about a submission. Moved out of the
   insert trigger so a submission that joins an existing enquiry is announced
   exactly like one that starts a new enquiry. */
create or replace function public.announce_enquiry(p_lead_id uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_estimate record;
  v_title text;
  v_body text;
  v_ack_title text;
  v_ack_body text;
  v_kind text;
begin
  select l.id, l.name, l.email, l.phone, l.source, l.monthly_bill, l.qualification_notes,
         l.converted_client_id
    into v_lead
  from public.leads l
  where l.id = p_lead_id;

  if v_lead.id is null then
    return;
  end if;

  v_kind := case
    when p_message is null and exists (select 1 from public.estimates e where e.lead_id = p_lead_id) then 'estimator'
    when v_lead.source = 'referral' and v_lead.qualification_notes like 'UPGRADE REQUEST%' then 'upgrade'
    else 'enquiry'
  end;

  if v_kind = 'estimator' then
    select e.recommended_kw, e.system_type, e.estimated_cost, e.monthly_savings, e.payback_years
      into v_estimate
    from public.estimates e
    where e.lead_id = p_lead_id
    order by e.created_at desc
    limit 1;

    v_title := 'New estimator submission · ' || v_lead.name;
    v_body := v_lead.email || coalesce(' · ' || v_lead.phone, '') ||
      coalesce(' · ' || v_estimate.recommended_kw || ' kWp ' || replace(v_estimate.system_type::text, '_', '-'), '') ||
      coalesce(' · ' || public.peso(v_estimate.estimated_cost), '');

    v_ack_title := 'Your SolarBros solar estimate';
    v_ack_body :=
      'Thank you, ' || v_lead.name || '. Based on the appliances you entered we recommend a ' ||
      coalesce(v_estimate.recommended_kw::text, '—') || ' kWp ' ||
      coalesce(replace(v_estimate.system_type::text, '_', '-'), '') || ' system, from about ' ||
      public.peso(v_estimate.estimated_cost) || ', saving roughly ' ||
      public.peso(v_estimate.monthly_savings) || ' a month (payback in about ' ||
      coalesce(round(v_estimate.payback_years)::text, '—') || ' years). ' ||
      'A sales engineer will contact you within one business day with a detailed quotation and to arrange a free site survey.';

  elsif v_kind = 'upgrade' then
    v_title := 'Upgrade request · ' || v_lead.name;
    v_body := 'An existing customer wants to expand their system. See Enquiries.';
    v_ack_title := 'We received your upgrade request';
    v_ack_body := 'A sales engineer will review your current system and come back to you within two business days.';

  else
    v_title := 'New quotation request · ' || v_lead.name;
    v_body := v_lead.email || coalesce(' · ' || v_lead.phone, '') ||
      coalesce(' · bill ' || public.peso(v_lead.monthly_bill), '') ||
      coalesce(' · "' || left(coalesce(p_message, v_lead.qualification_notes), 140) || '"', '');
    v_ack_title := 'We received your enquiry';
    v_ack_body := 'Thank you, ' || v_lead.name || '. A SolarBros sales engineer will contact you within one business day.';
  end if;

  perform public.notify_roles(array['sales', 'admin'], v_title, v_body, 'enquiry', 'leads', p_lead_id::text);

  if v_lead.converted_client_id is not null then
    perform public.notify_client(v_lead.converted_client_id, v_ack_title, v_ack_body, 'enquiry', 'leads', p_lead_id::text);
  else
    perform public.notify_contact(v_lead.email, null, v_ack_title, v_ack_body, 'enquiry', 'leads', p_lead_id::text, false);
  end if;
end;
$$;

revoke all on function public.announce_enquiry(uuid, text) from public, anon, authenticated;


/* The insert trigger now hands over to the shared announcement. */
create or replace function public.lead_arrived()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Staff typing in a walk-in do not need telling about their own entry.
  if public.is_staff() then
    return null;
  end if;

  -- A booking is announced by the visit it created (appointment_requested).
  if exists (select 1 from public.appointments a where a.lead_id = new.id) then
    return null;
  end if;

  perform public.announce_enquiry(
    new.id,
    case when new.source = 'estimator' then null else new.qualification_notes end
  );
  return null;
end;
$$;


/* --- The estimator --------------------------------------------------------- */
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
  v_monthly_cost numeric;
  v_joined boolean := false;
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
  v_monthly_cost := (p_estimate ->> 'currentMonthlyCost')::numeric;

  -- CHANGED 0076: join an enquiry already in progress for this email.
  v_lead_id := public.open_enquiry_for(p_email);

  if v_lead_id is not null then
    v_joined := true;
    update public.leads
    set phone = coalesce(phone, nullif(left(trim(coalesce(p_phone, '')), 40), '')),
        address = coalesce(address, nullif(left(trim(coalesce(p_address, '')), 300), '')),
        location = coalesce(location, nullif(left(trim(coalesce(p_address, '')), 300), '')),
        -- The newest estimate is the one Sales should size from.
        monthly_bill = case when v_monthly_cost between 0 and 1000000 then round(v_monthly_cost) else monthly_bill end,
        estimated_kw = case when v_recommended_kw between 0 and 10000 then v_recommended_kw else estimated_kw end
    where id = v_lead_id;
  else
    insert into public.leads (
      name, email, phone, address, location, monthly_bill, estimated_kw, source
    )
    values (
      trim(p_name),
      lower(trim(p_email)),
      nullif(left(trim(coalesce(p_phone, '')), 40), ''),
      nullif(left(trim(coalesce(p_address, '')), 300), ''),
      nullif(left(trim(coalesce(p_address, '')), 300), ''),
      case when v_monthly_cost between 0 and 1000000 then round(v_monthly_cost) end,
      case when v_recommended_kw between 0 and 10000 then v_recommended_kw end,
      'estimator'
    )
    returning id into v_lead_id;
  end if;

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

  -- A new enquiry is announced by its insert trigger; a joined one here.
  if v_joined then
    perform public.announce_enquiry(v_lead_id, null);
  end if;
end;
$$;


/* --- The contact form ------------------------------------------------------ */
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
declare
  v_lead_id uuid;
  v_message text := nullif(left(trim(coalesce(p_message, '')), 2000), '');
begin
  perform public.validate_public_contact(p_name, p_email);
  perform public.check_public_form_rate(p_email);

  -- CHANGED 0076: join an enquiry already in progress for this email.
  v_lead_id := public.open_enquiry_for(p_email);

  if v_lead_id is not null then
    update public.leads
    set phone = coalesce(phone, nullif(left(trim(coalesce(p_phone, '')), 40), '')),
        address = coalesce(address, nullif(left(trim(coalesce(p_address, '')), 300), '')),
        location = coalesce(location, nullif(left(trim(coalesce(p_address, '')), 300), '')),
        monthly_bill = coalesce(
          case when p_monthly_bill between 0 and 1000000 then p_monthly_bill end,
          monthly_bill
        ),
        -- Every message is kept, newest last, dated.
        qualification_notes = left(
          concat_ws(
            E'\n\n',
            qualification_notes,
            case when v_message is not null
              then to_char(now() at time zone 'Asia/Manila', 'DD Mon YYYY') || ' — ' || v_message
            end
          ),
          8000
        )
    where id = v_lead_id;

    perform public.announce_enquiry(v_lead_id, coalesce(v_message, 'Sent the contact form again.'));
    return;
  end if;

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
    v_message
  );
end;
$$;


/* --- The booking page ------------------------------------------------------
   0065's body; only where the lead comes from changes. The visit itself is
   announced by appointment_requested, whichever enquiry it belongs to. */
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
  v_capacity integer := public.setting_num('operations.slots_per_hour', 2)::integer;
  v_lead_hours integer := public.setting_num('operations.booking_lead_hours', 24)::integer;
  v_taken integer;
  v_slots text[] := string_to_array(
    coalesce(
      public.setting_text('operations.booking_slots', '08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00'),
      '08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00'
    ),
    ','
  );
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

  if not public.booking_date_open(p_scheduled_date) then
    raise exception 'We are closed on that date. Please choose another day.'
      using errcode = '22023';
  end if;

  if not (p_time_slot = any (array(select btrim(unnest(v_slots))))) then
    raise exception 'We do not take visits at that time. Please choose another slot.'
      using errcode = '22023';
  end if;

  if (p_scheduled_date + p_time_slot::time) <= (now() + make_interval(hours => v_lead_hours)) then
    raise exception
      'We need at least % hours notice for a visit. Please choose a later slot.', v_lead_hours
      using errcode = '22023';
  end if;

  select count(*) into v_taken
  from public.appointments a
  where a.scheduled_date = p_scheduled_date
    and a.time_slot = p_time_slot
    and a.status <> 'cancelled';

  if v_taken >= v_capacity then
    raise exception 'That slot has just been taken. Please choose another time.'
      using errcode = '23505';
  end if;

  -- CHANGED 0076: join an enquiry already in progress for this email.
  v_lead_id := public.open_enquiry_for(p_email);

  if v_lead_id is not null then
    update public.leads
    set phone = coalesce(phone, nullif(left(trim(coalesce(p_phone, '')), 40), '')),
        address = coalesce(address, nullif(left(trim(coalesce(p_address, '')), 300), '')),
        location = coalesce(location, nullif(left(trim(coalesce(p_address, '')), 300), ''))
    where id = v_lead_id;
  else
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
  end if;

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
-- 3. A VISIT TAKES ITS CONTACT DETAILS FROM THE ENQUIRY TOO
-- ============================================================================
-- 0071's body, with one addition at the end: anything still missing comes
-- from the enquiry behind the project, then from the customer's most recent
-- enquiry that has it.

create or replace function public.fill_appointment_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket record;
  v_project record;
  v_lead record;
  v_profile record;
  v_fallback record;
  -- A plain variable: a record that was never selected into cannot be read.
  v_project_lead uuid;
begin
  if new.ticket_id is not null then
    select t.client_id, t.project_id into v_ticket
    from public.tickets t where t.id = new.ticket_id;

    new.client_id := coalesce(new.client_id, v_ticket.client_id);
    new.project_id := coalesce(new.project_id, v_ticket.project_id);
  end if;

  if new.project_id is not null then
    select p.client_id, p.address, p.lead_id into v_project
    from public.projects p where p.id = new.project_id;

    if v_project.client_id is not null
       and new.client_id is not null
       and new.client_id is distinct from v_project.client_id
       and not public.is_internal() then
      raise exception 'That installation is not on your account.' using errcode = '42501';
    end if;

    new.client_id := coalesce(new.client_id, v_project.client_id);
    new.address := coalesce(nullif(btrim(new.address), ''), v_project.address);
    v_project_lead := v_project.lead_id;
  end if;

  if new.lead_id is not null then
    select l.name, l.email, l.phone, l.address, l.location, l.converted_client_id
      into v_lead
    from public.leads l where l.id = new.lead_id;

    new.client_id := coalesce(
      new.client_id, v_lead.converted_client_id, public.client_id_for_email(v_lead.email)
    );
    new.contact_name := coalesce(nullif(btrim(new.contact_name), ''), v_lead.name);
    new.contact_phone := coalesce(nullif(btrim(new.contact_phone), ''), v_lead.phone);
    new.address := coalesce(nullif(btrim(new.address), ''), v_lead.address, v_lead.location);
  end if;

  if new.client_id is not null then
    select p.full_name, p.phone, p.address into v_profile
    from public.profiles p where p.id = new.client_id;

    new.contact_name := coalesce(nullif(btrim(new.contact_name), ''), v_profile.full_name);
    new.contact_phone := coalesce(nullif(btrim(new.contact_phone), ''), v_profile.phone);
    new.address := coalesce(nullif(btrim(new.address), ''), v_profile.address);
  end if;

  -- ADDED 0076: the enquiry fills what the account does not have.
  if nullif(btrim(coalesce(new.contact_phone, '')), '') is null
     or nullif(btrim(coalesce(new.address, '')), '') is null then
    select l.name, l.phone, l.address, l.location into v_fallback
    from public.leads l
    where (v_project_lead is not null and l.id = v_project_lead)
       or (new.client_id is not null and l.converted_client_id = new.client_id)
    order by (l.id = v_project_lead) desc nulls last,
             (l.phone is not null) desc,
             l.created_at desc
    limit 1;

    new.contact_phone := coalesce(nullif(btrim(new.contact_phone), ''), v_fallback.phone);
    new.address := coalesce(nullif(btrim(new.address), ''), v_fallback.address, v_fallback.location);
    new.contact_name := coalesce(nullif(btrim(new.contact_name), ''), v_fallback.name);
  end if;

  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;

  return new;
end;
$$;


-- ============================================================================
-- 4. TRIGGER FUNCTIONS RUN AS TRIGGERS, NOT THROUGH THE API
-- ============================================================================
-- Revoking EXECUTE does not stop a trigger firing: the privilege is checked
-- when a trigger is created, not each time it runs.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
  end loop;
end;
$$;
