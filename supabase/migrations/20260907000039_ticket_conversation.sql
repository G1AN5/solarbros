-- ============================================================================
-- 0039  TICKET CONVERSATION
-- ----------------------------------------------------------------------------
-- "View thread" was a button on both the customer's support page and the
-- staff queue, and neither one opened anything. The `ticket_messages` table has
-- existed since 0006 and not a single row was ever written to it, so every
-- support conversation happened somewhere outside the system — by phone, or in
-- somebody's inbox — and the ticket recorded only its own beginning and end.
--
-- That is the gap this closes. It also fixes three things that made the table
-- unsafe to open up:
--
--   1. THE INSERT POLICY ONLY CHECKED THE AUTHOR, NOT THE TICKET.
--      `with check (author_id = auth.uid())` says "you must sign your own
--      name". It says nothing about WHOSE ticket you are signing it on, so any
--      signed-in customer could post into any other customer's thread. They
--      could not read the reply, which is worse rather than better: the office
--      would answer a stranger's message believing it came from the customer.
--
--   2. A CUSTOMER COULD MARK THEIR OWN MESSAGE INTERNAL.
--      `is_internal` is how a staff note stays out of the customer's view.
--      Nothing stopped a customer setting it, which would have let them plant
--      text that reads to staff as a colleague's private note.
--
--   3. A REPLY DID NOT COUNT AS ACTIVITY.
--      `tickets.updated_at` drives "Last update" on both queues. A conversation
--      that does not touch it looks stale, and stale is what gets ignored.
--
-- Author names come from an RPC rather than a join, for the reason established
-- in 0031 and 0036: RLS grants rows, not columns, so widening `profiles` far
-- enough to join a name would hand out every email address and mobile number
-- with it.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Who may post, and where
-- ----------------------------------------------------------------------------

drop policy if exists ticket_messages_insert on public.ticket_messages;

create policy ticket_messages_insert on public.ticket_messages
  for insert to authenticated
  with check (
    -- Provenance: you sign your own name. Same rule as payments in 0022.
    author_id = (select auth.uid())
    and (
      -- Anyone on staff, including the technician who attends, may reply on
      -- any ticket and may leave an internal note.
      public.is_internal()
      or (
        -- A customer: their own ticket, and never as an internal note.
        is_internal = false
        and exists (
          select 1
          from public.tickets t
          where t.id = ticket_messages.ticket_id
            and t.client_id = (select auth.uid())
        )
      )
    )
  );

-- Deliberately no UPDATE or DELETE policy. A support thread is evidence of what
-- was promised to a customer; being able to quietly rewrite it afterwards would
-- defeat the point of keeping it.


-- ----------------------------------------------------------------------------
-- 2. A reply is activity, and the other side should hear about it
-- ----------------------------------------------------------------------------

create or replace function public.ticket_message_posted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket record;
  v_author_is_staff boolean;
  v_recipient uuid;
begin
  select t.reference, t.client_id, t.assigned_to
    into v_ticket
  from public.tickets t
  where t.id = new.ticket_id;

  /* SECURITY DEFINER is doing real work here: a customer has no UPDATE policy
     on `tickets`, and should not have one. The trigger touches the timestamp on
     their behalf so their reply moves the ticket up the queue. */
  update public.tickets
     set updated_at = now()
   where id = new.ticket_id;

  -- An internal note is not the customer's business, and staff are looking at
  -- the queue anyway.
  if new.is_internal then
    return new;
  end if;

  select coalesce(p.role, 'client'::public.user_role) <> 'client'::public.user_role
    into v_author_is_staff
  from public.profiles p
  where p.id = new.author_id;

  if coalesce(v_author_is_staff, false) then
    v_recipient := v_ticket.client_id;
  else
    v_recipient := v_ticket.assigned_to;
  end if;

  /* A customer replying on a ticket nobody owns yet is exactly the case that
     goes unanswered for a week, so it goes to the admins rather than nowhere.
     One row each: a notification addressed to a group is a notification nobody
     feels responsible for. */
  if v_recipient is null and not coalesce(v_author_is_staff, false) then
    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    select
      p.id,
      'New reply on unassigned ticket ' || v_ticket.reference,
      left(new.body, 240),
      'in_app',
      'support',
      'tickets',
      new.ticket_id::text
    from public.profiles p
    where p.role = 'admin' and p.is_active;

    return new;
  end if;

  if v_recipient is null or v_recipient = new.author_id then
    return new;
  end if;

  insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
  values (
    v_recipient,
    'New reply on ' || v_ticket.reference,
    left(new.body, 240),
    'in_app',
    'support',
    'tickets',
    new.ticket_id::text
  );

  return new;
end;
$$;

drop trigger if exists ticket_message_posted on public.ticket_messages;

create trigger ticket_message_posted
  after insert on public.ticket_messages
  for each row execute function public.ticket_message_posted();

-- Called by the trigger machinery, never by a client.
revoke all on function public.ticket_message_posted() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Reading the thread, with names attached
-- ----------------------------------------------------------------------------

create or replace function public.ticket_thread(p_ticket_id uuid)
returns table (
  id uuid,
  body text,
  is_internal boolean,
  created_at timestamptz,
  author_name text,
  author_is_staff boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_internal boolean := public.is_internal();
  v_owner uuid;
  v_exists boolean;
begin
  if v_uid is null then
    raise exception 'Sign in to read this conversation' using errcode = '42501';
  end if;

  select t.client_id, true
    into v_owner, v_exists
  from public.tickets t
  where t.id = p_ticket_id;

  if not coalesce(v_exists, false) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  /* SECURITY DEFINER bypasses RLS, so the check RLS would have made is made
     here instead — explicitly, rather than by forgetting to. */
  if not v_internal and v_owner is distinct from v_uid then
    raise exception 'Not your ticket' using errcode = '42501';
  end if;

  return query
  select
    m.id,
    m.body,
    m.is_internal,
    m.created_at,
    -- A name and nothing else. Never the email or mobile number that sits in
    -- the same row.
    coalesce(p.full_name, 'SolarBros')::text,
    coalesce(p.role, 'client'::public.user_role) <> 'client'::public.user_role
  from public.ticket_messages m
  left join public.profiles p on p.id = m.author_id
  where m.ticket_id = p_ticket_id
    -- The customer never sees an internal note, whoever calls this.
    and (v_internal or not m.is_internal)
  order by m.created_at;
end;
$$;

revoke all on function public.ticket_thread(uuid) from public, anon;
grant execute on function public.ticket_thread(uuid) to authenticated;
