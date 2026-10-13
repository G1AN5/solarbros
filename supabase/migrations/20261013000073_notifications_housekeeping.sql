-- ============================================================================
-- 0073  EVERY HAND-OFF TELLS THE NEXT PERSON, AND TIME MOVES THINGS ON
-- ----------------------------------------------------------------------------
-- WHAT WAS MISSING
-- The workflow crosses seven roles, and almost none of the hand-offs told the
-- person on the other side. Sales raised a contract and the customer was not
-- told it was waiting; the customer signed it and nobody in the office was
-- told it needed a counter-signature; an invoice was raised and nobody was
-- told it was due. Each role had to go and look — which in practice means each
-- role finds out a day late, by phone.
--
-- Two of the three notifications that DID exist were broken:
--
--   · The "a team has been assigned" SMS was queued without `to_phone`, so the
--     dispatcher could only ever mark it failed — the destination is read from
--     the row, and the row had none. It also ignored the customer's own SMS
--     preference.
--   · Staff had no notification bell at all (the topbar button had no
--     handler), so the in-app messages addressed to them — a reply on a ticket
--     they own — went nowhere a person would see them. The bell is fixed in
--     the application; this migration gives it something to say.
--
-- THE SHAPE
--   notify_client   a customer, through their own channel preferences
--   notify_contact  a prospect with no account yet, by email (and SMS where
--                   they asked for a visit)
--   notify_roles    everybody in the roles that act on it, in-app
--   notify_person   one member of staff, in-app
--
-- Email and SMS rows carry their destination, so the dispatcher can deliver
-- them, and simulation (the default) records them without sending anything.
--
-- AND TIME
-- An invoice past its due date stayed "sent" until somebody happened to record
-- a payment against it; a quotation past its validity stayed "sent" for ever;
-- the maintenance visit due a year after turnover was written down and never
-- mentioned to anybody. `refresh_time_based_statuses` does all three, and runs
-- daily through pg_cron where the extension is available — and lazily from the
-- finance, billing and quotation screens, so it is correct either way.
-- ============================================================================


-- ============================================================================
-- 1. THE HELPERS
-- ============================================================================

/* Whether a customer wants this category on this channel. The defaults match
   the ones the preferences screen shows before anybody has saved anything. */
create or replace function public.client_wants(p_user uuid, p_category text, p_channel text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_channel = 'email' then
      case p_category
        when 'milestone'   then coalesce(np.milestone_email, true)
        when 'appointment' then coalesce(np.appointment_email, true)
        when 'billing'     then coalesce(np.billing_email, true)
        when 'marketing'   then coalesce(np.marketing_email, false)
        else true
      end
    when p_channel = 'sms' then
      case p_category
        when 'milestone'   then coalesce(np.milestone_sms, false)
        when 'appointment' then coalesce(np.appointment_sms, true)
        when 'billing'     then coalesce(np.billing_sms, false)
        else false
      end
    else true
  end
  from (select 1) one
  left join public.notification_preferences np on np.user_id = p_user;
$$;


create or replace function public.notify_client(
  p_user uuid,
  p_title text,
  p_body text,
  p_category text,
  p_entity text default null,
  p_entity_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  if p_user is null then
    return;
  end if;

  select p.email, p.phone, p.is_active into v_profile
  from public.profiles p where p.id = p_user;

  if not found or not v_profile.is_active then
    return;
  end if;

  insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
  values (p_user, left(p_title, 200), left(p_body, 2000), 'in_app', p_category, p_entity, p_entity_id);

  if nullif(btrim(coalesce(v_profile.email, '')), '') is not null
     and public.client_wants(p_user, p_category, 'email') then
    insert into public.notifications (user_id, to_email, title, body, channel, category, entity, entity_id)
    values (p_user, v_profile.email, left(p_title, 200), left(p_body, 2000), 'email', p_category, p_entity, p_entity_id);
  end if;

  if nullif(btrim(coalesce(v_profile.phone, '')), '') is not null
     and public.client_wants(p_user, p_category, 'sms') then
    insert into public.notifications (user_id, to_phone, title, body, channel, category, entity, entity_id)
    values (p_user, v_profile.phone, left(p_title, 200), left(p_body, 2000), 'sms', p_category, p_entity, p_entity_id);
  end if;
end;
$$;


/* Somebody with no account: an email, and an SMS only where they gave us a
   number for a visit they are expecting. Never marketing. */
create or replace function public.notify_contact(
  p_email text,
  p_phone text,
  p_title text,
  p_body text,
  p_category text,
  p_entity text default null,
  p_entity_id text default null,
  p_sms boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_email, '')), '') is not null then
    insert into public.notifications (to_email, title, body, channel, category, entity, entity_id)
    values (lower(btrim(p_email)), left(p_title, 200), left(p_body, 2000), 'email', p_category, p_entity, p_entity_id);
  end if;

  if p_sms and nullif(btrim(coalesce(p_phone, '')), '') is not null then
    insert into public.notifications (to_phone, title, body, channel, category, entity, entity_id)
    values (btrim(p_phone), left(p_title, 200), left(p_body, 2000), 'sms', p_category, p_entity, p_entity_id);
  end if;
end;
$$;


create or replace function public.notify_roles(
  p_roles text[],
  p_title text,
  p_body text,
  p_category text,
  p_entity text default null,
  p_entity_id text default null,
  p_except uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
  select pr.id, left(p_title, 200), left(p_body, 2000), 'in_app', p_category, p_entity, p_entity_id
  from public.profiles pr
  where pr.is_active
    and pr.role::text = any (p_roles)
    and pr.id is distinct from p_except;
$$;


create or replace function public.notify_person(
  p_user uuid,
  p_title text,
  p_body text,
  p_category text,
  p_entity text default null,
  p_entity_id text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
  select pr.id, left(p_title, 200), left(p_body, 2000), 'in_app', p_category, p_entity, p_entity_id
  from public.profiles pr
  where pr.id = p_user and pr.is_active;
$$;


/* Who a visit is for: their account when they have one, else the address and
   number on the lead or the visit itself. */
create or replace function public.notify_appointment_party(
  p_appointment public.appointments,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_appointment.client_id is not null then
    perform public.notify_client(
      p_appointment.client_id, p_title, p_body, 'appointment', 'appointments', p_appointment.id::text
    );
    return;
  end if;

  select l.email into v_email from public.leads l where l.id = p_appointment.lead_id;

  perform public.notify_contact(
    v_email, p_appointment.contact_phone, p_title, p_body, 'appointment',
    'appointments', p_appointment.id::text, true
  );
end;
$$;


create or replace function public.appointment_label(p_type public.appointment_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'virtual_consultation' then 'virtual consultation'
    when 'site_survey' then 'site survey'
    when 'installation' then 'installation visit'
    when 'maintenance' then 'maintenance visit'
    when 'repair' then 'repair visit'
  end;
$$;


create or replace function public.peso(p_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'PHP ' || to_char(coalesce(p_amount, 0), 'FM999,999,999,990.00');
$$;


revoke all on function public.client_wants(uuid, text, text) from public, anon, authenticated;
revoke all on function public.notify_client(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_contact(text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.notify_roles(text[], text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.notify_person(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_appointment_party(public.appointments, text, text) from public, anon, authenticated;


-- ============================================================================
-- 2. ENQUIRIES REACH SALES, AND THE ENQUIRER HEARS BACK
-- ============================================================================
-- Deferred to the end of the transaction, because the three public forms each
-- write more than one row: by commit time the estimate behind an estimator
-- lead exists, and a booking's lead can be recognised by its appointment
-- (which announces itself, so the lead does not announce it twice).

create or replace function public.lead_arrived()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate record;
  v_title text;
  v_body text;
  v_ack_title text;
  v_ack_body text;
begin
  -- Staff typing in a walk-in do not need telling about their own entry.
  if public.is_staff() then
    return null;
  end if;

  if exists (select 1 from public.appointments a where a.lead_id = new.id) then
    return null;
  end if;

  if new.source = 'estimator' then
    select e.recommended_kw, e.system_type, e.estimated_cost, e.monthly_savings, e.payback_years
      into v_estimate
    from public.estimates e
    where e.lead_id = new.id
    order by e.created_at desc
    limit 1;

    v_title := 'New estimator submission · ' || new.name;
    v_body := new.email || coalesce(' · ' || new.phone, '') ||
      coalesce(' · ' || v_estimate.recommended_kw || ' kWp ' || replace(v_estimate.system_type::text, '_', '-'), '') ||
      coalesce(' · ' || public.peso(v_estimate.estimated_cost), '');

    v_ack_title := 'Your SolarBros solar estimate';
    v_ack_body :=
      'Thank you, ' || new.name || '. Based on the appliances you entered we recommend a ' ||
      coalesce(v_estimate.recommended_kw::text, '—') || ' kWp ' ||
      coalesce(replace(v_estimate.system_type::text, '_', '-'), '') || ' system, from about ' ||
      public.peso(v_estimate.estimated_cost) || ', saving roughly ' ||
      public.peso(v_estimate.monthly_savings) || ' a month (payback in about ' ||
      coalesce(round(v_estimate.payback_years)::text, '—') || ' years). ' ||
      'A sales engineer will contact you within one business day with a detailed quotation and to arrange a free site survey.';

  elsif new.source = 'referral' and new.qualification_notes like 'UPGRADE REQUEST%' then
    v_title := 'Upgrade request · ' || new.name;
    v_body := 'An existing customer wants to expand their system. See Enquiries.';
    v_ack_title := 'We received your upgrade request';
    v_ack_body := 'A sales engineer will review your current system and come back to you within two business days.';

  else
    v_title := 'New quotation request · ' || new.name;
    v_body := new.email || coalesce(' · ' || new.phone, '') ||
      coalesce(' · bill ' || public.peso(new.monthly_bill), '') ||
      coalesce(' · "' || left(new.qualification_notes, 140) || '"', '');
    v_ack_title := 'We received your enquiry';
    v_ack_body := 'Thank you, ' || new.name || '. A SolarBros sales engineer will contact you within one business day.';
  end if;

  perform public.notify_roles(array['sales', 'admin'], v_title, v_body, 'enquiry', 'leads', new.id::text);

  if new.converted_client_id is not null then
    perform public.notify_client(new.converted_client_id, v_ack_title, v_ack_body, 'enquiry', 'leads', new.id::text);
  else
    perform public.notify_contact(new.email, null, v_ack_title, v_ack_body, 'enquiry', 'leads', new.id::text, false);
  end if;

  return null;
end;
$$;

drop trigger if exists leads_announce on public.leads;
create constraint trigger leads_announce
  after insert on public.leads
  deferrable initially deferred
  for each row execute function public.lead_arrived();


-- ============================================================================
-- 3. VISITS
-- ============================================================================

-- The old dispatch SMS: no destination, no preference check. Replaced below.
drop trigger if exists appointment_dispatched on public.appointments;

create or replace function public.appointment_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_when text := to_char(new.scheduled_date, 'Dy DD Mon YYYY') || ' at ' || new.time_slot;
begin
  /* Office-created visits are the office's own entry: nobody needs telling,
     and the customer hears about them when they are confirmed or a crew is
     assigned. Only a request a CUSTOMER made is announced and acknowledged. */
  if new.status = 'requested' and not public.is_internal() then
    perform public.notify_roles(
      array['sales', 'project_engineer', 'admin'],
      'Visit requested · ' || initcap(public.appointment_label(new.appointment_type)),
      coalesce(new.contact_name, 'A customer') || ' asked for ' || v_when ||
        coalesce(' · ' || new.address, '') || '. Confirm it under Enquiries, then assign a crew on the Dispatch board.',
      'appointment', 'appointments', new.id::text
    );

    perform public.notify_appointment_party(
      new,
      'We received your request',
      'Your ' || public.appointment_label(new.appointment_type) || ' request for ' || v_when ||
        ' is with our team. We will confirm it once a team member is assigned.'
    );
  end if;

  return null;
end;
$$;

drop trigger if exists appointments_requested on public.appointments;
create trigger appointments_requested
  after insert on public.appointments
  for each row execute function public.appointment_requested();


create or replace function public.appointment_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_when text := to_char(new.scheduled_date, 'Dy DD Mon YYYY') || ' at ' || new.time_slot;
  v_label text := public.appointment_label(new.appointment_type);
  v_crew text;
  v_actor_role text := public.current_user_role()::text;
  r record;
begin
  if new.status is distinct from old.status then
    if new.status = 'confirmed' then
      perform public.notify_appointment_party(
        new, 'Your ' || v_label || ' is confirmed',
        'We will see you on ' || v_when || coalesce(' at ' || new.address, '') || '.'
      );

    elsif new.status = 'dispatched' then
      select string_agg(pr.full_name, ', ' order by pr.full_name) into v_crew
      from public.appointment_assignees aa
      join public.profiles pr on pr.id = aa.user_id
      where aa.appointment_id = new.id;

      perform public.notify_appointment_party(
        new, 'Your visit is confirmed',
        'A team has been assigned for ' || v_when || coalesce(': ' || v_crew, '') || '.'
      );

    elsif new.status = 'cancelled' then
      if v_actor_role = 'client' then
        perform public.notify_roles(
          array['sales', 'project_engineer', 'admin'],
          'Customer cancelled a ' || v_label,
          coalesce(new.contact_name, 'A customer') || ' cancelled the visit on ' || v_when ||
            coalesce(': ' || new.cancelled_reason, '') || '.',
          'appointment', 'appointments', new.id::text
        );
        for r in select aa.user_id from public.appointment_assignees aa where aa.appointment_id = new.id loop
          perform public.notify_person(
            r.user_id, 'Job cancelled by the customer',
            initcap(v_label) || ' on ' || v_when || ' is cancelled.',
            'appointment', 'appointments', new.id::text
          );
        end loop;
      else
        perform public.notify_appointment_party(
          new, 'Your ' || v_label || ' was cancelled',
          'The visit on ' || v_when || ' has been cancelled' ||
            coalesce(': ' || new.cancelled_reason, '') || '. Contact us to book another time.'
        );
      end if;

    elsif new.status = 'completed' then
      if new.client_id is not null then
        perform public.notify_client(
          new.client_id, 'Visit completed',
          'Your ' || v_label || ' on ' || to_char(new.scheduled_date, 'DD Mon YYYY') ||
            ' is complete' || coalesce(', signed off by ' || new.client_signoff_name, '') || '.',
          'appointment', 'appointments', new.id::text
        );
      end if;
    end if;

  elsif (new.scheduled_date is distinct from old.scheduled_date
         or new.time_slot is distinct from old.time_slot)
        and new.status not in ('cancelled', 'completed') then
    perform public.notify_appointment_party(
      new, 'Your ' || v_label || ' has moved',
      'It is now on ' || v_when || '.'
    );

    for r in select aa.user_id from public.appointment_assignees aa where aa.appointment_id = new.id loop
      perform public.notify_person(
        r.user_id, 'Job rescheduled',
        initcap(v_label) || ' for ' || coalesce(new.contact_name, 'a customer') || ' is now on ' || v_when || '.',
        'appointment', 'appointments', new.id::text
      );
    end loop;
  end if;

  return null;
end;
$$;

drop trigger if exists appointments_changed on public.appointments;
create trigger appointments_changed
  after update on public.appointments
  for each row execute function public.appointment_changed();


create or replace function public.assignee_told()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt record;
begin
  select a.appointment_type, a.scheduled_date, a.time_slot, a.contact_name, a.address
    into v_appt
  from public.appointments a where a.id = new.appointment_id;

  if new.user_id is distinct from (select auth.uid()) then
    perform public.notify_person(
      new.user_id,
      'New job · ' || initcap(public.appointment_label(v_appt.appointment_type)),
      to_char(v_appt.scheduled_date, 'Dy DD Mon') || ' at ' || v_appt.time_slot || ' · ' ||
        coalesce(v_appt.contact_name, 'Customer') || coalesce(' · ' || v_appt.address, ''),
      'appointment', 'appointments', new.appointment_id::text
    );
  end if;

  return null;
end;
$$;

drop trigger if exists appointment_assignees_told on public.appointment_assignees;
create trigger appointment_assignees_told
  after insert on public.appointment_assignees
  for each row execute function public.assignee_told();


-- ============================================================================
-- 4. QUOTATIONS AND CONTRACTS
-- ============================================================================

create or replace function public.quotation_announced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_actor_role text := public.current_user_role()::text;
  v_summary text;
begin
  select l.id, l.name, l.email, l.converted_client_id, l.assigned_to
    into v_lead
  from public.leads l where l.id = new.lead_id;

  v_summary := new.system_kw || ' kWp ' || replace(new.system_type::text, '_', '-') ||
    ' system for ' || public.peso(new.total_price);

  -- Waiting on an administrator.
  if new.status = 'pending_approval'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending_approval') then
    perform public.notify_roles(
      array['admin'],
      'Discount approval needed · ' || new.reference,
      v_lead.name || ': ' || v_summary || ' at ' || new.discount_pct || '% off. Approve it under Quotations.',
      'billing', 'quotations', new.id::text
    );
  end if;

  if tg_op = 'UPDATE' then
    -- Approved: tell whoever is waiting to send it.
    if new.discount_approved_by is not null and old.discount_approved_by is null then
      perform public.notify_person(
        new.prepared_by,
        'Discount approved · ' || new.reference,
        'You can send it to ' || v_lead.name || ' now.',
        'billing', 'quotations', new.id::text
      );
    end if;

    if new.status is distinct from old.status then
      if new.status = 'sent' then
        if v_lead.converted_client_id is not null then
          perform public.notify_client(
            v_lead.converted_client_id,
            'Your quotation ' || new.reference || ' is ready',
            'A ' || v_summary || coalesce(', valid until ' || to_char(new.valid_until, 'DD Mon YYYY'), '') ||
              '. Review it and accept or decline it from your SolarBros portal.',
            'billing', 'quotations', new.id::text
          );
        else
          perform public.notify_contact(
            v_lead.email, null,
            'Your SolarBros quotation ' || new.reference,
            'Hello ' || v_lead.name || ', we have prepared a ' || v_summary ||
              coalesce(', valid until ' || to_char(new.valid_until, 'DD Mon YYYY'), '') ||
              '. Reply to this email or call us to go ahead — or create a SolarBros account with this email address to review and accept it online.',
            'billing', 'quotations', new.id::text, false
          );
        end if;

      elsif new.status in ('accepted', 'rejected') and v_actor_role = 'client' then
        perform public.notify_roles(
          array['sales', 'admin'],
          case when new.status = 'accepted'
            then 'Customer accepted ' || new.reference
            else 'Customer declined ' || new.reference
          end,
          v_lead.name || ': ' || v_summary ||
            case when new.status = 'accepted'
              then '. Raise the contract under Quotations.'
              else coalesce('. Reason: ' || new.rejection_reason, '.')
            end,
          'billing', 'quotations', new.id::text
        );
      end if;
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists quotations_announced on public.quotations;
create trigger quotations_announced
  after insert or update on public.quotations
  for each row execute function public.quotation_announced();


create or replace function public.contract_announced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_name text;
  v_down numeric := round(new.contract_value * new.down_payment_pct / 100, 2);
begin
  select l.name, l.email into v_lead from public.leads l where l.id = new.lead_id;

  -- Waiting for the customer.
  if new.status = 'awaiting_client'
     and (tg_op = 'INSERT'
          or old.status is distinct from 'awaiting_client'
          or (old.client_id is null and new.client_id is not null)) then
    if new.client_id is not null then
      perform public.notify_client(
        new.client_id,
        'Your contract ' || new.reference || ' is ready to sign',
        'Total ' || public.peso(new.contract_value) || ', with ' || public.peso(v_down) ||
          ' due on signing. Sign it from the dashboard of your SolarBros portal.',
        'billing', 'contracts', new.id::text
      );
    elsif tg_op = 'INSERT' then
      perform public.notify_contact(
        v_lead.email, null,
        'Your SolarBros contract ' || new.reference || ' is ready',
        'Hello ' || v_lead.name || ', your contract for ' || public.peso(new.contract_value) ||
          ' is ready. Create your SolarBros account with this email address (' || v_lead.email ||
          ') and it will be waiting on your dashboard to review and sign.',
        'billing', 'contracts', new.id::text, false
      );
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- Signed by the customer: the office counter-signs.
    if new.status = 'awaiting_company' then
      v_name := coalesce(new.client_signature_name, v_lead.name, 'The customer');
      perform public.notify_roles(
        array['admin', 'sales', 'accountant'],
        'Contract ' || new.reference || ' signed — ready to counter-sign',
        v_name || ' signed for ' || public.peso(new.contract_value) ||
          '. Counter-signing under Quotations creates the project and the down-payment invoice.',
        'billing', 'contracts', new.id::text
      );

    elsif new.status = 'cancelled' and new.client_id is not null then
      perform public.notify_client(
        new.client_id,
        'Contract ' || new.reference || ' withdrawn',
        'This contract is no longer active. Your sales engineer will be in touch about next steps.',
        'billing', 'contracts', new.id::text
      );
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists contracts_announced on public.contracts;
create trigger contracts_announced
  after insert or update on public.contracts
  for each row execute function public.contract_announced();


-- ============================================================================
-- 5. PROJECTS, MATERIALS AND COMMISSION
-- ============================================================================

create or replace function public.project_announced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_client(
      new.client_id,
      'Your project ' || new.reference || ' has started',
      'Thank you for signing. We are now preparing your permits and materials. You can follow every stage of the installation under Project tracker.',
      'milestone', 'projects', new.id::text
    );

    perform public.notify_roles(
      array['project_engineer', 'admin'],
      'New project · ' || new.reference,
      new.system_kw || ' kWp at ' || new.address ||
        '. Assign an engineer and track its permits so the crew can be scheduled.',
      'operations', 'projects', new.id::text
    );
    return null;
  end if;

  if new.assigned_engineer is not null
     and new.assigned_engineer is distinct from old.assigned_engineer then
    perform public.notify_person(
      new.assigned_engineer,
      'You are the engineer on ' || new.reference,
      new.system_kw || ' kWp at ' || new.address || '.',
      'operations', 'projects', new.id::text
    );
  end if;

  if new.status is distinct from old.status then
    if new.status in ('on_hold', 'cancelled') then
      perform public.notify_client(
        new.client_id,
        'Project ' || new.reference || ' is ' || replace(new.status::text, '_', ' '),
        'Your project engineer will explain what happens next. You can message them from your portal.',
        'milestone', 'projects', new.id::text
      );
    end if;

    -- Commission follows the project to its end, either way.
    if new.status = 'completed' then
      if exists (select 1 from public.commissions c where c.project_id = new.id and c.status = 'pending') then
        perform public.notify_roles(
          array['accountant', 'admin'],
          'Commission ready to release · ' || new.reference,
          'The project is complete. Release the sales commission under Invoicing.',
          'billing', 'projects', new.id::text
        );
      end if;
    elsif new.status = 'cancelled' then
      update public.commissions
      set status = 'rejected'
      where project_id = new.id and status = 'pending';
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists projects_announced on public.projects;
create trigger projects_announced
  after insert or update on public.projects
  for each row execute function public.project_announced();


create or replace function public.reservation_short()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
begin
  if new.status <> 'short' then
    return null;
  end if;

  -- One message per project, not one per line.
  if exists (
    select 1 from public.stock_reservations sr
    where sr.project_id = new.project_id and sr.status = 'short' and sr.id <> new.id
  ) then
    return null;
  end if;

  select p.reference into v_reference from public.projects p where p.id = new.project_id;

  perform public.notify_roles(
    array['inventory_manager', 'admin'],
    'Materials short for ' || coalesce(v_reference, 'a new project'),
    'The warehouse could not hold everything on the bill of materials. Raise a purchase order — the shortfall is listed under Purchasing.',
    'operations', 'projects', new.project_id::text
  );

  return null;
end;
$$;

drop trigger if exists stock_reservations_short on public.stock_reservations;
create trigger stock_reservations_short
  after insert on public.stock_reservations
  for each row execute function public.reservation_short();


/* Commission is created when the contract executes, at the rate in force then,
   for the sales representative who owns the lead (or prepared the quotation).
   Released by finance once the project is complete. The rate is copied onto
   the row, so changing the setting later does not rewrite what was earned. */
create or replace function public.contract_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric := public.setting_num('sales.commission_pct', 3);
  v_rep uuid;
  v_project uuid;
begin
  if new.status <> 'executed' or old.status = 'executed' or v_rate <= 0 then
    return null;
  end if;

  select coalesce(
           (select l.assigned_to from public.leads l
             join public.profiles pr on pr.id = l.assigned_to and pr.role = 'sales'
             where l.id = new.lead_id),
           (select q.prepared_by from public.quotations q
             join public.profiles pr on pr.id = q.prepared_by and pr.role = 'sales'
             where q.id = new.quotation_id)
         )
    into v_rep;

  select p.id into v_project from public.projects p where p.contract_id = new.id;

  if v_rep is not null and v_project is not null then
    insert into public.commissions (user_id, project_id, amount, rate_pct, status)
    values (v_rep, v_project, round(new.contract_value * v_rate / 100, 2), v_rate, 'pending')
    on conflict (user_id, project_id) do nothing;
  end if;

  return null;
end;
$$;

/* Sorts after `contract_executed`, so the project it reads already exists. */
drop trigger if exists contract_executed_commission on public.contracts;
create trigger contract_executed_commission
  after update on public.contracts
  for each row execute function public.contract_commission();


create or replace function public.stamp_commission_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.released_by := coalesce((select auth.uid()), new.released_by);
    new.released_at := coalesce(new.released_at, now());

    perform public.notify_person(
      new.user_id,
      'Commission released',
      public.peso(new.amount) || ' has been released to you.',
      'billing', 'commissions', new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists commissions_stamp_release on public.commissions;
create trigger commissions_stamp_release
  before update on public.commissions
  for each row execute function public.stamp_commission_release();


-- ============================================================================
-- 6. MONEY
-- ============================================================================

create or replace function public.invoice_announced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
begin
  if new.status in ('draft', 'void') then
    return null;
  end if;

  select p.reference into v_reference from public.projects p where p.id = new.project_id;

  perform public.notify_client(
    new.client_id,
    'Invoice ' || new.invoice_number || ' issued',
    public.peso(new.amount) || ' for ' || replace(new.stage::text, '_', ' ') ||
      coalesce(' on ' || v_reference, '') ||
      coalesce(', due ' || to_char(new.due_at, 'DD Mon YYYY'), '') ||
      '. Pay by bank transfer quoting ' || new.invoice_number ||
      ' — the account details are on your Billing page.',
    'billing', 'invoices', new.id::text
  );

  return null;
end;
$$;

drop trigger if exists invoices_announced on public.invoices;
create trigger invoices_announced
  after insert on public.invoices
  for each row execute function public.invoice_announced();


create or replace function public.payment_announced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice record;
begin
  select i.invoice_number, i.client_id, i.amount, i.amount_paid
    into v_invoice
  from public.invoices i where i.id = new.invoice_id;

  if new.verified and (tg_op = 'INSERT' or not old.verified) then
    perform public.notify_client(
      v_invoice.client_id,
      'Payment received — thank you',
      public.peso(new.amount) || ' recorded against ' || v_invoice.invoice_number ||
        case
          when v_invoice.amount_paid >= v_invoice.amount then '. That invoice is now fully paid.'
          else '. Remaining on this invoice: ' || public.peso(v_invoice.amount - v_invoice.amount_paid) || '.'
        end,
      'billing', 'invoices', new.invoice_id::text
    );
  elsif not new.verified and tg_op = 'INSERT' then
    perform public.notify_roles(
      array['accountant', 'admin'],
      'Payment awaiting verification · ' || v_invoice.invoice_number,
      public.peso(new.amount) || ' was recorded and needs a second person to confirm it against the bank statement.',
      'billing', 'payments', new.id::text,
      new.recorded_by
    );
  end if;

  return null;
end;
$$;

/* Sorts after `payment_updates_invoice`, so the balance it quotes is the new
   one. */
drop trigger if exists payments_announced on public.payments;
create trigger payments_announced
  after insert or update of verified on public.payments
  for each row execute function public.payment_announced();


-- ============================================================================
-- 7. SUPPORT AND WARRANTY
-- ============================================================================

create or replace function public.ticket_announced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A technician reporting an app problem counts; office staff logging a
    -- ticket on a customer's behalf already know about it.
    if not public.is_staff() then
      perform public.notify_roles(
        array['sales', 'project_engineer', 'admin'],
        'New support ticket · ' || new.reference,
        upper(new.priority::text) || ' · ' || new.subject,
        'support', 'tickets', new.id::text
      );
    end if;
    return null;
  end if;

  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
    perform public.notify_person(
      new.assigned_to,
      'Ticket ' || new.reference || ' assigned to you',
      upper(new.priority::text) || ' · ' || new.subject,
      'support', 'tickets', new.id::text
    );
  end if;

  if new.status is distinct from old.status and public.is_staff() then
    perform public.notify_client(
      new.client_id,
      'Ticket ' || new.reference || ': ' ||
        case new.status
          when 'in_progress' then 'we are working on it'
          when 'awaiting_client' then 'we need something from you'
          when 'resolved' then 'resolved'
          when 'closed' then 'closed'
          else replace(new.status::text, '_', ' ')
        end,
      coalesce(
        case when new.status = 'resolved' then new.resolution end,
        new.subject
      ),
      'support', 'tickets', new.id::text
    );
  end if;

  return null;
end;
$$;

drop trigger if exists tickets_announced on public.tickets;
create trigger tickets_announced
  after insert or update on public.tickets
  for each row execute function public.ticket_announced();


create or replace function public.warranty_request_announced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
begin
  select p.reference into v_reference from public.projects p where p.id = new.project_id;

  if tg_op = 'INSERT' then
    perform public.notify_roles(
      array['inventory_manager', 'admin'],
      'Warranty ' || new.request_type::text || ' request · ' || coalesce(v_reference, ''),
      case when new.request_type = 'transfer'
        then 'Transfer to ' || coalesce(new.transfer_to_name, '') || ' (' || coalesce(new.transfer_to_email, '') || '). Review the proof of sale under Warranty approvals.'
        else 'Review it under Warranty approvals.'
      end,
      'support', 'warranty_requests', new.id::text
    );
    return null;
  end if;

  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.notify_client(
      new.client_id,
      'Your warranty ' || new.request_type::text || ' request was ' || new.status::text,
      coalesce(new.review_notes, case when new.status = 'approved'
        then 'The registered owner of the installation has been updated.'
        else 'Contact us if you would like to discuss it.' end),
      'support', 'warranty_requests', new.id::text
    );
  end if;

  return null;
end;
$$;

drop trigger if exists warranty_requests_announced on public.warranty_requests;
create trigger warranty_requests_announced
  after insert or update on public.warranty_requests
  for each row execute function public.warranty_request_announced();


create or replace function public.review_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_internal() then
    perform public.notify_roles(
      array['sales', 'admin'],
      'New review awaiting moderation',
      new.rating || '★ from ' || new.display_name || ': "' || left(new.quote, 140) || '"',
      'marketing', 'reviews', new.id::text
    );
  end if;
  return null;
end;
$$;

drop trigger if exists reviews_submitted on public.reviews;
create trigger reviews_submitted
  after insert on public.reviews
  for each row execute function public.review_submitted();


-- ============================================================================
-- 8. A MAINTENANCE VISIT CLOSES ITS SCHEDULE AND BOOKS THE NEXT ONE
-- ============================================================================

create or replace function public.maintenance_visit_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_months integer := public.setting_num('operations.maintenance_interval_months', 12)::integer;
  v_schedule record;
begin
  if new.appointment_type <> 'maintenance'
     or new.status <> 'completed'
     or old.status = 'completed' then
    return null;
  end if;

  for v_schedule in
    update public.maintenance_schedules
    set status = 'approved', completed_at = now()
    where appointment_id = new.id and status = 'pending'
    returning project_id
  loop
    insert into public.maintenance_schedules (project_id, due_date)
    values (v_schedule.project_id, current_date + (v_months || ' months')::interval);
  end loop;

  return null;
end;
$$;

drop trigger if exists appointments_maintenance_done on public.appointments;
create trigger appointments_maintenance_done
  after update of status on public.appointments
  for each row execute function public.maintenance_visit_done();


-- ============================================================================
-- 9. TIME
-- ============================================================================

create or replace function public.refresh_time_based_statuses()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_overdue integer := 0;
  v_expired integer := 0;
  v_reminded integer := 0;
  r record;
begin
  -- Signed-in callers only, of any kind: the screens call this lazily. It
  -- changes nothing a caller could not otherwise see change, and every
  -- update is idempotent.
  if (select auth.uid()) is not null and public.current_user_role() is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;

  -- Serialise concurrent callers rather than having them race.
  perform pg_advisory_xact_lock(hashtext('solarbros.refresh_time_based_statuses'));

  update public.invoices
  set status = 'overdue'
  where status = 'sent'
    and due_at < current_date
    and amount_paid < amount;
  get diagnostics v_overdue = row_count;

  update public.quotations
  set status = 'expired'
  where status = 'sent'
    and valid_until is not null
    and valid_until < current_date;
  get diagnostics v_expired = row_count;

  for r in
    select ms.id, ms.due_date, p.id as project_id, p.reference, p.client_id
    from public.maintenance_schedules ms
    join public.projects p on p.id = ms.project_id
    where ms.status = 'pending'
      and ms.notified_at is null
      and ms.due_date <= current_date + 14
    for update of ms
  loop
    perform public.notify_client(
      r.client_id,
      'Your maintenance visit is due',
      'Your system''s preventive maintenance is due on ' || to_char(r.due_date, 'DD Mon YYYY') ||
        '. Book it from Appointments in your portal, or we will contact you to arrange it.',
      'appointment', 'projects', r.project_id::text
    );

    perform public.notify_roles(
      array['project_engineer', 'admin'],
      'Maintenance due · ' || r.reference,
      'Due ' || to_char(r.due_date, 'DD Mon YYYY') || '. Schedule it from the Dispatch board.',
      'operations', 'projects', r.project_id::text
    );

    update public.maintenance_schedules set notified_at = now() where id = r.id;
    v_reminded := v_reminded + 1;
  end loop;

  return jsonb_build_object(
    'overdue_invoices', v_overdue,
    'expired_quotations', v_expired,
    'maintenance_reminders', v_reminded
  );
end;
$$;

revoke all on function public.refresh_time_based_statuses() from public, anon;
grant execute on function public.refresh_time_based_statuses() to authenticated;


/* Daily at 00:05 Manila (16:05 UTC), where pg_cron is available. Guarded: on a
   project without the extension the migration must still apply, and the
   screens call the function lazily anyway. */
do $outer$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available here (%); statuses refresh lazily from the screens.', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'solarbros-daily-housekeeping';

      perform cron.schedule(
        'solarbros-daily-housekeeping',
        '5 16 * * *',
        'select public.refresh_time_based_statuses();'
      );
    exception when others then
      raise notice 'Could not schedule the daily housekeeping job (%).', sqlerrm;
    end;
  end if;
end;
$outer$;

-- Bring today's state up to date.
select public.refresh_time_based_statuses();
