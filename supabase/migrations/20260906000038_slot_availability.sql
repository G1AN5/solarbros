-- ============================================================================
-- 0038 · REAL BOOKING AVAILABILITY
-- ----------------------------------------------------------------------------
-- The public booking calendar decided what was free with this:
--
--     function isSlotAvailable(day, slot) {
--       return (day + Number(slot.split(':')[0])) % 3 !== 0
--     }
--
-- Arithmetic. It greyed out roughly a third of the slots at random, and let a
-- prospect book one that was already full — so two customers could be promised
-- the same 9am, and the coordinator only found out on the dispatch board.
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT A QUERY THE PAGE MAKES
-- The booking form is public, so `anon` would need to SELECT appointments to
-- count them — which would hand every visitor the company's whole diary:
-- customer names, addresses and visit times. RLS correctly refuses that.
--
-- A SECURITY DEFINER function returns only what a visitor needs — a list of
-- slots and whether each is free — and nothing about who is in them.
--
-- IT IS ADVISORY, AND THE BOOKING FUNCTION IS THE AUTHORITY
-- Anyone can call this endpoint and ignore the answer. `request_booking` below
-- re-checks capacity inside the write, so a fabricated request is refused
-- there. This exists so an honest visitor is not told a slot is free when it
-- is not.
-- ============================================================================

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('operations.slots_per_hour', '2', 'operations',
   'Visits bookable per time slot',
   'How many consultations or surveys the team can run at the same hour. Raise it when you hire, lower it when people are on leave — the public booking calendar greys out full slots from this number.',
   'number', 'visits', 1, 20, array['admin', 'project_engineer']::public.user_role[], false, 1),

  ('operations.booking_lead_hours', '24', 'operations',
   'Minimum notice for a booking',
   'How far ahead a visitor must book. Stops somebody requesting a survey for two hours from now, which nobody can staff.',
   'number', 'hours', 0, 336, array['admin', 'project_engineer']::public.user_role[], false, 2)
on conflict (key) do nothing;


create or replace function public.available_slots(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_capacity integer := public.setting_num('operations.slots_per_hour', 2)::integer;
  v_lead_hours integer := public.setting_num('operations.booking_lead_hours', 24)::integer;
  v_slots text[] := array['08:00','09:00','10:00','11:00','13:00','14:00','15:00','16:00'];
  v_slot text;
  v_taken integer;
  v_result jsonb := '[]'::jsonb;
begin
  foreach v_slot in array v_slots loop
    select count(*) into v_taken
    from public.appointments a
    where a.scheduled_date = p_date
      and a.time_slot = v_slot
      and a.status <> 'cancelled';

    v_result := v_result || jsonb_build_object(
      'slot', v_slot,
      -- Only the count and a yes/no. Never who, never where.
      'available',
        v_taken < v_capacity
        and (p_date + v_slot::time) > (now() + make_interval(hours => v_lead_hours)),
      'remaining', greatest(v_capacity - v_taken, 0)
    );
  end loop;

  return v_result;
end;
$$;

revoke all on function public.available_slots(date) from public;
grant execute on function public.available_slots(date) to anon, authenticated;

comment on function public.available_slots(date) is
  'Which slots are bookable on a date. Advisory - request_booking re-checks. Returns no customer data, so it is safe for anon.';


-- ----------------------------------------------------------------------------
-- THE AUTHORITY
-- A visitor can ignore a greyed-out slot; this cannot be ignored, because it
-- runs inside the write itself.
-- ----------------------------------------------------------------------------

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

  /* --- NOTICE AND CAPACITY, checked at the moment of writing -------------
     The greyed-out calendar is a courtesy. Two people can be looking at the
     same free slot at the same instant, and whoever presses second has to be
     the one refused — otherwise both are promised the same 9am. */
  if (p_scheduled_date + p_time_slot::time) <= (now() + make_interval(hours => v_lead_hours)) then
    raise exception
      'We need at least %  hours notice for a visit. Please choose a later slot.', v_lead_hours
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

revoke all on function public.request_booking(text, date, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.request_booking(text, date, text, text, text, text, text, text)
  to anon, authenticated;
