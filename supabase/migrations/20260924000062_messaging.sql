-- ============================================================================
-- 0062  DIRECT MESSAGES
-- ----------------------------------------------------------------------------
-- Staff may write to any other member of staff. A customer may write only to
-- the people actually working on their installation, plus an administrator.
--
-- WHY A CUSTOMER IS FENCED AND STAFF ARE NOT
-- Staff are colleagues; an accountant needing a word with a technician is
-- ordinary. A customer is not a colleague, and an open directory would hand
-- every customer the name and inbox of every employee — which is a staff
-- directory leak dressed up as a feature, and an invitation to route around
-- whoever is actually handling their job.
--
-- ADMINISTRATORS ARE ALWAYS REACHABLE, deliberately. A customer whose project
-- has not started yet has no engineer, no crew and possibly no sales rep. The
-- alternative is a messaging feature that shows them an empty list and no
-- explanation.
--
-- THE RULE IS ENFORCED WHEN A THREAD IS OPENED, not on every message.
-- A conversation records who may be in it; membership is then the permission.
-- Re-deriving "is this person still on that project" for every message would
-- mean a customer's thread going silently read-only the day a technician is
-- reassigned, with their history stranded inside it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Who is working on this customer's installation
-- ----------------------------------------------------------------------------

create or replace function public.staff_for_client(p_client uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  -- The engineer responsible for their project.
  select p.assigned_engineer
  from public.projects p
  where p.client_id = p_client and p.assigned_engineer is not null

  union

  -- Everybody crewed on it.
  select pc.user_id
  from public.project_crew pc
  join public.projects p on p.id = pc.project_id
  where p.client_id = p_client

  union

  -- The sales rep who sold it, who is usually who they already know.
  select l.assigned_to
  from public.leads l
  where l.converted_client_id = p_client and l.assigned_to is not null

  union

  -- Always somebody to write to.
  select pr.id
  from public.profiles pr
  where pr.role = 'admin' and pr.is_active;
$$;

comment on function public.staff_for_client(uuid) is
  'The staff a given customer is entitled to message: their engineer, their crew, their sales rep, and any administrator.';


-- ----------------------------------------------------------------------------
-- 2. May these two people hold a conversation at all
-- ----------------------------------------------------------------------------

create or replace function public.may_message(p_other uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_other_role public.user_role;
begin
  -- Not signed in, no target, or writing to yourself.
  if v_me is null or p_other is null or v_me = p_other then
    return false;
  end if;

  -- A deactivated account is not a correspondent.
  select pr.role into v_other_role
  from public.profiles pr
  where pr.id = p_other and pr.is_active;

  if v_other_role is null then
    return false;
  end if;

  if public.is_internal() then
    -- Colleague to colleague, freely.
    if v_other_role <> 'client' then
      return true;
    end if;
    -- Staff to a customer: only one of theirs, unless you are an administrator.
    return public.is_admin()
        or exists (select 1 from public.staff_for_client(p_other) s where s.user_id = v_me);
  end if;

  -- I am a customer: only the people on my own job.
  return exists (select 1 from public.staff_for_client(v_me) s where s.user_id = p_other);
end;
$$;

revoke all on function public.may_message(uuid) from public, anon;
grant execute on function public.may_message(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. The tables
-- ----------------------------------------------------------------------------

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Drives the unread badge. Null means they have never opened it.
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);
create index if not exists participants_user_idx
  on public.conversation_participants (user_id);
create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);


-- ----------------------------------------------------------------------------
-- 4. Membership decides everything
-- ----------------------------------------------------------------------------
-- `am_in_conversation` is SECURITY DEFINER on purpose. The obvious policy —
-- "you may read participants of conversations you participate in" — queries
-- the participants table from inside its own policy, which recurses until
-- Postgres gives up. A definer function breaks the cycle by not being subject
-- to the policy it is used by.

create or replace function public.am_in_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation
      and cp.user_id = (select auth.uid())
  );
$$;

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

-- Conversations ---------------------------------------------------------------
create policy conversations_read on public.conversations
  for select to authenticated
  using (public.am_in_conversation(id));

create policy conversations_create on public.conversations
  for insert to authenticated
  with check (created_by = (select auth.uid()));

-- `last_message_at` is maintained by a trigger, so nobody needs UPDATE.
-- There is no DELETE policy either: a conversation one side can erase from the
-- other's history is worse than one that simply stays.

-- Participants ----------------------------------------------------------------
create policy participants_read on public.conversation_participants
  for select to authenticated
  using (public.am_in_conversation(conversation_id));

/* Adding somebody is the ONE moment the messaging rule is checked. You may add
   yourself to a conversation you created, and you may add anybody you are
   allowed to write to. */
create policy participants_add on public.conversation_participants
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or public.may_message(user_id)
  );

-- Marking your own thread as read.
create policy participants_mark_read on public.conversation_participants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Messages --------------------------------------------------------------------
create policy messages_read on public.messages
  for select to authenticated
  using (public.am_in_conversation(conversation_id));

create policy messages_send on public.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.am_in_conversation(conversation_id)
  );

/* No UPDATE and no DELETE, for anybody. A message somebody has already read
   should not change or vanish afterwards — the same reasoning that makes the
   audit log append-only. Deleting the account redacts the name; the words
   stay. */


-- ----------------------------------------------------------------------------
-- 5. Keep the thread list in order
-- ----------------------------------------------------------------------------

create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation();


-- ----------------------------------------------------------------------------
-- 6. Opening a thread, as one atomic act
-- ----------------------------------------------------------------------------
-- Creating the conversation, adding two participants and posting the first
-- message is four round trips that must all succeed. Half of it succeeding
-- leaves an empty thread nobody can see or a thread with one member.
--
-- It also RE-USES an existing one-to-one thread. Without that, every message
-- from the client portal would start a new conversation and the history would
-- be scattered across dozens of threads with one line each.

create or replace function public.open_conversation(p_other uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_conversation uuid;
begin
  if not public.may_message(p_other) then
    raise exception 'You are not able to message that person.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'A message cannot be empty.' using errcode = '22023';
  end if;

  -- An existing thread between exactly these two people.
  select c.id into v_conversation
  from public.conversations c
  where (select count(*) from public.conversation_participants p where p.conversation_id = c.id) = 2
    and exists (select 1 from public.conversation_participants p
                 where p.conversation_id = c.id and p.user_id = v_me)
    and exists (select 1 from public.conversation_participants p
                 where p.conversation_id = c.id and p.user_id = p_other)
  limit 1;

  if v_conversation is null then
    insert into public.conversations (created_by) values (v_me)
    returning id into v_conversation;

    insert into public.conversation_participants (conversation_id, user_id)
    values (v_conversation, v_me), (v_conversation, p_other);
  end if;

  insert into public.messages (conversation_id, author_id, body)
  values (v_conversation, v_me, btrim(p_body));

  -- The sender has by definition read their own message.
  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = v_conversation and user_id = v_me;

  return v_conversation;
end;
$$;

revoke all on function public.open_conversation(uuid, text) from public, anon;
grant execute on function public.open_conversation(uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 7. Who can I write to
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER would not work here: the caller cannot read the profiles of
-- staff they have no other relationship with, which is most of the directory.
-- Definer, therefore, with the rule applied explicitly — and it returns a name
-- and a role and nothing else. No email, no phone, no address.

create or replace function public.messageable_people()
returns table (id uuid, full_name text, role public.user_role, avatar_initials text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.full_name::text, pr.role, pr.avatar_initials::text, pr.avatar_url::text
  from public.profiles pr
  where pr.is_active
    and pr.id <> (select auth.uid())
    and public.may_message(pr.id)
  order by pr.role, pr.full_name;
$$;

revoke all on function public.messageable_people() from public, anon;
grant execute on function public.messageable_people() to authenticated;

comment on function public.messageable_people() is
  'The directory, already filtered by who the caller may write to. Returns a name, role and avatar only — never an email or phone number.';
