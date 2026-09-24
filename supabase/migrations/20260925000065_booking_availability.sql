-- ============================================================================
-- 0065  THE BOOKING CALENDAR, DECIDED BY THE BUSINESS
-- ----------------------------------------------------------------------------
-- The times a prospect could choose were an array literal inside
-- `available_slots`:
--
--     v_slots text[] := array['08:00','09:00','10:00','11:00','13:00', ...];
--
-- So the company's opening hours were a line of code. Closing on Sundays,
-- shutting for a public holiday, or stopping at 3pm on Saturdays all needed a
-- developer and a deploy — and `company.hours` already said "Mon-Sat, 8:00 AM
-- - 6:00 PM" while the booking form happily offered Sunday.
--
-- THREE CONTROLS, WHICH IS ENOUGH
--   · which times of day are offered at all
--   · which days of the week are worked
--   · specific dates that are closed regardless — holidays, stock-take, a
--     company outing
--
-- ENFORCED ON THE WRITE, NOT JUST THE CALENDAR.
-- `available_slots` paints the calendar; `request_booking` is what actually
-- accepts. Both consult the same settings, because a greyed-out button stops
-- an honest visitor and nothing else. This is the same reason the capacity
-- check was already duplicated in both.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Opening hours as data
-- ----------------------------------------------------------------------------

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('operations.booking_slots',
   '"08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00"',
   'operations',
   'Bookable times',
   'Comma-separated 24-hour times offered to prospects, e.g. 08:00,09:00,13:00. Leave out the lunch hour to close it.',
   'text', null, null, null, array['admin']::public.user_role[], false, 30),

  ('operations.booking_weekdays',
   '"1,2,3,4,5,6"',
   'operations',
   'Days of the week worked',
   'Comma-separated, 1 = Monday through 7 = Sunday. The default is Monday to Saturday, matching the published business hours.',
   'text', null, null, null, array['admin']::public.user_role[], false, 31)
on conflict (key) do nothing;


-- ----------------------------------------------------------------------------
-- 2. Dates that are closed whatever the weekday says
-- ----------------------------------------------------------------------------

create table if not exists public.booking_blackouts (
  blackout_date date primary key,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.booking_blackouts is
  'Specific dates on which no visit can be booked — holidays and closures. Overrides the weekday setting.';

alter table public.booking_blackouts enable row level security;

/* A prospect is anonymous, and the calendar has to grey out closed dates before
   anybody signs in. The only thing exposed is that a date is closed, which is
   the same thing the greyed-out button says. */
create policy blackouts_read on public.booking_blackouts
  for select to anon, authenticated
  using (true);

create policy blackouts_manage on public.booking_blackouts
  for all to authenticated
  using (public.has_role('admin', 'sales'))
  with check (public.has_role('admin', 'sales'));


-- ----------------------------------------------------------------------------
-- 3. One place that decides whether a date is open
-- ----------------------------------------------------------------------------

create or replace function public.booking_date_open(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- A worked weekday. `isodow` is 1=Monday..7=Sunday, which is what the
    -- setting documents, rather than `dow` which starts at Sunday=0.
    extract(isodow from p_date)::text = any (
      string_to_array(
        coalesce(public.setting_text('operations.booking_weekdays', '1,2,3,4,5,6'), '1,2,3,4,5,6'),
        ','
      )
    )
    and not exists (
      select 1 from public.booking_blackouts b where b.blackout_date = p_date
    );
$$;

revoke all on function public.booking_date_open(date) from public;
grant execute on function public.booking_date_open(date) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. The calendar reads the settings
-- ----------------------------------------------------------------------------
-- Body preserved from the original apart from where the slot list comes from
-- and the new closed-date check. The capacity rule, the notice rule and the
-- "count and a yes/no, never who or where" shape are unchanged.

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
  v_slots text[] := string_to_array(
    coalesce(
      public.setting_text('operations.booking_slots', '08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00'),
      '08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00'
    ),
    ','
  );
  v_open boolean := public.booking_date_open(p_date);
  v_slot text;
  v_taken integer;
  v_result jsonb := '[]'::jsonb;
begin
  foreach v_slot in array v_slots loop
    v_slot := btrim(v_slot);
    continue when v_slot = '';

    select count(*) into v_taken
    from public.appointments a
    where a.scheduled_date = p_date
      and a.time_slot = v_slot
      and a.status <> 'cancelled';

    v_result := v_result || jsonb_build_object(
      'slot', v_slot,
      -- Only the count and a yes/no. Never who, never where.
      'available',
        v_open
        and v_taken < v_capacity
        and (p_date + v_slot::time) > (now() + make_interval(hours => v_lead_hours)),
      'remaining', greatest(v_capacity - v_taken, 0)
    );
  end loop;

  return v_result;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. And so does the write
-- ----------------------------------------------------------------------------
-- Only two checks are added to `request_booking`: the date must be open, and
-- the time must be one the business offers. Everything else is the existing
-- body, because the validation, rate limiting, notice period, capacity check
-- and the lead-plus-appointment insert are all still exactly right.

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

  -- NEW: the business is open that day.
  if not public.booking_date_open(p_scheduled_date) then
    raise exception 'We are closed on that date. Please choose another day.'
      using errcode = '22023';
  end if;

  -- NEW: and that time is one we offer. The calendar greys the others out;
  -- this is what stops a request that did not come from the calendar.
  if not (p_time_slot = any (array(select btrim(unnest(v_slots))))) then
    raise exception 'We do not take visits at that time. Please choose another slot.'
      using errcode = '22023';
  end if;

  /* --- NOTICE AND CAPACITY, checked at the moment of writing -------------
     The greyed-out calendar is a courtesy. Two people can be looking at the
     same free slot at the same instant, and whoever presses second has to be
     the one refused — otherwise both are promised the same 9am. */
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
