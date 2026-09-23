-- ============================================================================
-- 0028 · NOTIFICATION DISPATCH
-- ----------------------------------------------------------------------------
-- The triggers have been queueing notifications since 0008 and nothing has ever
-- sent one. There are 13 sitting in the table right now: milestone updates and
-- appointment confirmations that a customer was told they would receive.
--
-- This adds what a dispatcher needs, and the interesting part is not the
-- sending — it is making sure a message is sent EXACTLY ONCE.
--
-- WHY CLAIMING IS A DATABASE PROBLEM, NOT AN APPLICATION ONE
-- The obvious dispatcher reads the queued rows, sends them, then marks them
-- sent. Run two copies — a cron overlapping with a manual retry, or one
-- invocation that timed out and was retried — and both read the same rows, and
-- the customer gets two text messages. SMS costs money and duplicate messages
-- are the fastest way to make somebody unsubscribe.
--
-- `claim_notifications` uses FOR UPDATE SKIP LOCKED and flips the status inside
-- the same transaction that selects the rows. A second worker running at the
-- same instant skips the locked rows entirely and picks up different ones. This
-- is the standard Postgres queue pattern, and it is the only version that is
-- correct under concurrency — "check whether it is claimed, then claim it" is
-- two statements, and two workers can both pass the check.
--
-- Same lesson as the payment webhook in 0022 and the goods receipt in 0026,
-- arrived at from a third direction: only the database can settle a race.
-- ============================================================================


-- ============================================================================
-- 1 · WHAT A DISPATCHER NEEDS TO KNOW
-- ============================================================================

alter table public.notifications
  add column attempts integer not null default 0,
  add column last_attempt_at timestamptz,
  add column provider_message_id text,
  -- Which run picked this up. Makes "why did this send twice?" answerable.
  add column claimed_by text;

create index notifications_dispatch_idx
  on public.notifications (delivery_status, channel, created_at)
  where delivery_status = 'queued';

comment on column public.notifications.attempts is
  'Incremented per send attempt. A message that keeps failing stops being retried.';


-- ============================================================================
-- 2 · IN-APP MESSAGES ARE ALREADY DELIVERED
-- ----------------------------------------------------------------------------
-- Sitting in the table IS the delivery for an in-app notification — the bell in
-- the portal reads straight from here. Leaving them 'queued' makes the outbox
-- look like a backlog of undelivered messages when nine of the thirteen need no
-- action at all, and a monitoring view that cries wolf gets ignored.
-- ============================================================================

update public.notifications
set delivery_status = 'sent', sent_at = coalesce(sent_at, created_at)
where channel = 'in_app' and delivery_status = 'queued';

create or replace function public.mark_in_app_delivered()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.channel = 'in_app' then
    new.delivery_status := 'sent';
    new.sent_at := coalesce(new.sent_at, now());
  end if;
  return new;
end;
$$;

create trigger notifications_in_app_delivered
  before insert on public.notifications
  for each row execute function public.mark_in_app_delivered();

revoke all on function public.mark_in_app_delivered() from public, anon, authenticated;


-- ============================================================================
-- 3 · SETTINGS
-- ----------------------------------------------------------------------------
-- `simulate` defaults to TRUE, and that is deliberate. Nothing should start
-- sending real text messages to real customers because somebody deployed. It
-- has to be switched on knowingly, by an administrator, once the credentials
-- are in place and someone has watched the outbox behave.
-- ============================================================================

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('notifications.simulate_delivery', 'true', 'notifications',
   'Simulate delivery',
   'While this is on, messages are marked as sent and shown in the outbox without anything actually being sent. The whole flow is demonstrable with no provider account. Turn it off only when real credentials are configured and you have watched the outbox behave.',
   'boolean', null, null, null, array['admin']::public.user_role[], false, 1),

  ('notifications.email_enabled', 'true', 'notifications',
   'Send email',
   'Turn off to stop all outbound email without touching the rest of the system.',
   'boolean', null, null, null, array['admin']::public.user_role[], false, 2),

  ('notifications.sms_enabled', 'true', 'notifications',
   'Send SMS',
   'SMS costs money per message. Turn it off if the budget runs out — customers still get email and in-app messages.',
   'boolean', null, null, null, array['admin']::public.user_role[], false, 3),

  ('notifications.max_attempts', '3', 'notifications',
   'Give up after',
   'How many times to retry a message before marking it failed. A wrong phone number will never succeed, and retrying it for ever costs money and hides the real failures.',
   'number', 'attempts', 1, 10, array['admin']::public.user_role[], false, 4),

  ('notifications.batch_size', '25', 'notifications',
   'Messages per run',
   'How many the dispatcher takes at a time. Lower it if the provider rate-limits you.',
   'number', 'messages', 1, 200, array['admin']::public.user_role[], false, 5)
on conflict (key) do nothing;


-- ============================================================================
-- 4 · CLAIMING A BATCH
-- ----------------------------------------------------------------------------
-- Returns rows AND marks them in flight, atomically. The caller can then take
-- as long as it likes talking to a provider without any risk of a second worker
-- picking up the same message.
--
-- Rows are marked 'skipped' while in flight rather than adding a new enum value:
-- 'skipped' already means "not queued, not delivered", the dispatcher sets a
-- final status within the same invocation, and anything still sitting in
-- 'skipped' with a recent claim is visibly a crashed run rather than a mystery.
-- ============================================================================

create or replace function public.claim_notifications(
  p_worker text,
  p_limit integer default null
)
returns setof public.notifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := coalesce(p_limit, public.setting_num('notifications.batch_size', 25)::integer);
  v_max_attempts integer := public.setting_num('notifications.max_attempts', 3)::integer;
begin
  return query
  with candidates as (
    select id
    from public.notifications
    where delivery_status = 'queued'
      and channel <> 'in_app'
      and attempts < v_max_attempts
    order by created_at
    limit v_limit
    -- The whole point. A concurrent worker steps over these rows instead of
    -- waiting for them, and comes back with a different batch.
    for update skip locked
  )
  update public.notifications n
  set delivery_status = 'skipped',
      attempts = n.attempts + 1,
      last_attempt_at = now(),
      claimed_by = p_worker
  from candidates c
  where n.id = c.id
  returning n.*;
end;
$$;

revoke all on function public.claim_notifications(text, integer) from public, anon, authenticated;


/**
 * Record the outcome of one send.
 *
 * Separate from claiming so a crash between the two leaves the message in a
 * findable state rather than silently back in the queue to be sent again.
 */
create or replace function public.settle_notification(
  p_id uuid,
  p_status public.delivery_status,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_attempts integer := public.setting_num('notifications.max_attempts', 3)::integer;
  v_attempts integer;
begin
  select attempts into v_attempts from public.notifications where id = p_id;

  if p_status = 'sent' then
    update public.notifications
    set delivery_status = 'sent',
        sent_at = now(),
        provider_message_id = p_provider_message_id,
        delivery_error = null
    where id = p_id;
  else
    -- Back into the queue while retries remain; a wrong phone number is never
    -- going to work, so give up eventually rather than paying to find out again.
    update public.notifications
    set delivery_status = case
          when v_attempts >= v_max_attempts then 'failed'::public.delivery_status
          else 'queued'::public.delivery_status
        end,
        delivery_error = p_error
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.settle_notification(uuid, public.delivery_status, text, text)
  from public, anon, authenticated;


-- ============================================================================
-- 5 · RECOVERING A CRASHED RUN
-- ----------------------------------------------------------------------------
-- If the dispatcher dies mid-batch — a timeout, a deploy — its claimed rows sit
-- in 'skipped' for ever, which reads as "deliberately not sent". Anything
-- claimed more than fifteen minutes ago and never settled is a crash, and goes
-- back in the queue.
--
-- Fifteen minutes is comfortably longer than any real run and short enough that
-- a customer is not left waiting for an appointment confirmation.
-- ============================================================================

create or replace function public.requeue_stalled_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications
  set delivery_status = 'queued',
      delivery_error = 'Requeued after a dispatcher run did not finish.'
  where delivery_status = 'skipped'
    and claimed_by is not null
    and last_attempt_at < now() - interval '15 minutes'
    and attempts < public.setting_num('notifications.max_attempts', 3)::integer;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.requeue_stalled_notifications() from public, anon, authenticated;


-- ============================================================================
-- 6 · WHO MAY SEE THE OUTBOX
-- ----------------------------------------------------------------------------
-- The existing policy scopes a reader to their own notifications, which is
-- right for the bell in the portal and useless for an administrator trying to
-- work out why nobody got their appointment confirmations.
-- ============================================================================

create policy notifications_read_admin on public.notifications
  for select to authenticated
  using (public.is_admin());

comment on function public.claim_notifications(text, integer) is
  'Takes a batch and marks it in flight atomically. FOR UPDATE SKIP LOCKED is what stops two workers sending the same message twice.';
