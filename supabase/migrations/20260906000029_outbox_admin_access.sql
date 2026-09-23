-- ============================================================================
-- 0029 · ADMIN ACCESS TO THE DISPATCH FUNCTIONS
-- ----------------------------------------------------------------------------
-- `claim_notifications` and `settle_notification` were locked to the service
-- role, on the reasoning that only the Edge Function dispatches messages. That
-- is right for the scheduled path and wrong in two ways in practice:
--
--   1. The outbox screen needs to be able to retry one message — a customer
--      corrects their phone number and wants their confirmation now, not after
--      the next cron tick.
--
--   2. Nothing could test the concurrency guarantee. The one property that
--      matters here is that two overlapping runs never claim the same message,
--      and it was unreachable from anything holding a normal session.
--
-- The fix is the pattern migration 0009 established for `consume_project_stock`
-- rather than a blanket grant: keep SECURITY DEFINER, put the authorisation
-- INSIDE the function, then grant EXECUTE to `authenticated`. The function is
-- its own boundary, so a grant is not an opening.
--
-- `auth.uid() is null` is allowed through deliberately: that is the service
-- role inside the scheduled dispatcher, which has no session and is the system
-- rather than a person trying to get around a check.
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
  -- SECURITY DEFINER bypasses RLS, so the check RLS would have made is made
  -- here. Dispatching costs money; nobody but an administrator starts it.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Only an administrator can dispatch notifications'
      using errcode = '42501';
  end if;

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
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Only an administrator can settle a notification'
      using errcode = '42501';
  end if;

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


create or replace function public.requeue_stalled_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Only an administrator can requeue notifications'
      using errcode = '42501';
  end if;

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


revoke all on function public.claim_notifications(text, integer) from public, anon;
revoke all on function public.settle_notification(uuid, public.delivery_status, text, text)
  from public, anon;
revoke all on function public.requeue_stalled_notifications() from public, anon;

grant execute on function public.claim_notifications(text, integer) to authenticated;
grant execute on function public.settle_notification(uuid, public.delivery_status, text, text)
  to authenticated;
grant execute on function public.requeue_stalled_notifications() to authenticated;
