-- ============================================================================
-- 0077 · PERMITS HAVE TWO DEADLINES
-- ----------------------------------------------------------------------------
-- Found walking a project through as its engineer.
--
-- 1. THE CREW COULD NEVER START.
--    Structural mounting waited for EVERY tracked permit — and the standard set
--    the permits screen adds includes the utility's interconnection, net
--    metering and permission to operate. The utility grants those after it has
--    inspected a finished installation, so a project that followed the screen
--    could only be built by recording an approval nobody had given yet.
--
--    The building and electrical permits authorise the work; they gate the
--    crew, as before. The utility's approvals authorise switching the system
--    on; they now gate signing off Commissioning & Testing instead — which is
--    also what raises the commissioning invoice.
--
-- 2. RECORDING THE LAST APPROVAL COULD FAIL.
--    When the last permit came in, the permitting stage was ticked in the same
--    statement — and if Engineering Survey was still open, the ordering rule
--    refused the tick, taking the engineer's approval down with it ("Cannot
--    start Permitting & Approvals — Engineering Survey is still pending").
--    The stage now waits for the survey, and is ticked when the survey is.
--
-- 3. A REFUSAL STAYED ON THE TRACKER AFTER IT WAS RESOLVED.
--    A refused application blocked its stage, but a resubmission left it
--    blocked until everything was approved. The block now lifts as soon as
--    nothing is refused, and a refusal by the utility blocks the stage it
--    actually holds up.
--
-- 4. THE TRIGGERS ASKED A QUESTION ONLY STAFF MAY ASK.
--    The permit sync called `project_gate_status`, which refuses anyone who is
--    not signed in as staff — so a permit written from the SQL editor or by the
--    service role failed with "Not your project." The counting now lives in an
--    internal helper the triggers call directly; the public function keeps its
--    check and returns the same fields, plus the new ones.
-- ============================================================================


-- ============================================================================
-- 1. THE FACTS, WITHOUT THE ROLE CHECK
-- ============================================================================
-- Internal: called by the triggers below and by `project_gate_status`. Which
-- permits gate which stage is decided here and nowhere else.

create or replace function public.project_gate_facts(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_approved integer;
  v_rejected integer;
  v_work_total integer;
  v_work_approved integer;
  v_work_rejected integer;
  v_energise_total integer;
  v_energise_approved integer;
  v_energise_rejected integer;
  v_reservations integer;
  v_short integer;
begin
  select count(*),
         count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'rejected'),
         count(*) filter (where permit_type in ('lgu_building', 'electrical')),
         count(*) filter (where permit_type in ('lgu_building', 'electrical') and status = 'approved'),
         count(*) filter (where permit_type in ('lgu_building', 'electrical') and status = 'rejected')
  into v_total, v_approved, v_rejected, v_work_total, v_work_approved, v_work_rejected
  from public.permits
  where project_id = p_project_id;

  v_energise_total := v_total - v_work_total;
  v_energise_approved := v_approved - v_work_approved;
  v_energise_rejected := v_rejected - v_work_rejected;

  select count(*), count(*) filter (where status = 'short')
  into v_reservations, v_short
  from public.stock_reservations
  where project_id = p_project_id;

  return jsonb_build_object(
    -- The crew's gate. No permits tracked at all still means nobody has said
    -- which are needed, so it stays shut: silence is not approval. Once some
    -- are tracked, only the building and electrical permits hold the crew.
    'permits_ready', v_total > 0 and v_work_approved = v_work_total,
    'permits_total', v_total,
    'permits_approved', v_approved,
    'permits_rejected', v_rejected,
    'work_permits_total', v_work_total,
    'work_permits_approved', v_work_approved,
    'work_permits_rejected', v_work_rejected,
    -- Switching on. A project that tracks no utility approvals (off-grid, say)
    -- has nothing to wait for here.
    'energise_ready', v_energise_approved = v_energise_total,
    'energise_permits_total', v_energise_total,
    'energise_permits_approved', v_energise_approved,
    'energise_permits_rejected', v_energise_rejected,
    'materials_ready', v_reservations > 0 and v_short = 0,
    'reservations', v_reservations,
    'reservations_short', v_short
  );
end;
$$;

revoke all on function public.project_gate_facts(uuid) from public, anon, authenticated;


-- 0055's role check, unchanged; the body now asks the helper.
create or replace function public.project_gate_status(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_internal() then
    raise exception 'Not your project.' using errcode = '42501';
  end if;

  return public.project_gate_facts(p_project_id);
end;
$$;

revoke all on function public.project_gate_status(uuid) from public, anon;
grant execute on function public.project_gate_status(uuid) to authenticated;


-- The dispatch board's badge asked the same question with its own copy of the
-- rule (every permit approved), so it would have disagreed with the trigger.
-- It also answered anybody, about any project.
create or replace function public.project_ready_for_dispatch(p_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
begin
  if not public.is_internal() then
    return false;
  end if;

  v_gate := public.project_gate_facts(p_project_id);
  return (v_gate ->> 'permits_ready')::boolean and (v_gate ->> 'materials_ready')::boolean;
end;
$$;

revoke all on function public.project_ready_for_dispatch(uuid) from public, anon;
grant execute on function public.project_ready_for_dispatch(uuid) to authenticated;


-- ============================================================================
-- 2. PERMITS DRIVE THEIR STAGES
-- ============================================================================
-- The notes are read by the customer on their tracker as well as by staff.

create or replace function public.sync_permit_stages(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb := public.project_gate_facts(p_project_id);
  v_work_refused constant text := 'An application was refused by the issuing authority and is being resolved.';
  v_utility_refused constant text := 'The utility refused an application. It is being resolved before the system is switched on.';
  -- What 0027 wrote, so a block it left behind can be lifted too.
  v_legacy_refused constant text := 'A permit application was rejected. See Permits & Approvals.';
begin
  /* --- Permitting & Approvals: the permits the crew needs ----------------- */
  if (v_gate ->> 'work_permits_rejected')::integer > 0 then
    update public.project_milestones
    set status = 'blocked', note = v_work_refused
    where project_id = p_project_id
      and key = 'permitting'
      and status <> 'done'
      and (status <> 'blocked' or note is distinct from v_work_refused);

  elsif (v_gate ->> 'permits_ready')::boolean then
    -- Only once the stage before it is done: ticking it early is refused by
    -- the ordering rule, and the refusal would take the approval with it.
    -- The survey's own completion calls this again (section 3).
    update public.project_milestones m
    set status = 'done',
        completed_at = coalesce(m.completed_at, now()),
        completed_by = coalesce(m.completed_by, (select auth.uid())),
        note = 'The permits needed before installation are approved.'
    where m.project_id = p_project_id
      and m.key = 'permitting'
      and m.status <> 'done'
      and not exists (
        select 1 from public.project_milestones e
        where e.project_id = m.project_id
          and e.sequence < m.sequence
          and e.status <> 'done'
      );

  else
    -- Nothing refused any more (resubmitted, or the refused one removed):
    -- lift the block this function put there, and only that one.
    update public.project_milestones
    set status = 'pending', note = null
    where project_id = p_project_id
      and key = 'permitting'
      and status = 'blocked'
      and note in (v_work_refused, v_legacy_refused);
  end if;

  /* --- Commissioning & Testing: the utility's approvals ------------------- */
  if (v_gate ->> 'energise_permits_rejected')::integer > 0 then
    update public.project_milestones
    set status = 'blocked', note = v_utility_refused
    where project_id = p_project_id
      and key = 'commissioning'
      and status <> 'done'
      and (status <> 'blocked' or note is distinct from v_utility_refused);
  else
    update public.project_milestones
    set status = 'pending', note = null
    where project_id = p_project_id
      and key = 'commissioning'
      and status = 'blocked'
      and note = v_utility_refused;
  end if;
end;
$$;

revoke all on function public.sync_permit_stages(uuid) from public, anon, authenticated;


-- 0027's trigger function, now a thin wrapper. Deletes are included: removing
-- an application nobody needs can be what clears a stage.
create or replace function public.sync_permitting_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  if tg_op = 'DELETE' then
    v_project := old.project_id;
  else
    v_project := new.project_id;
  end if;

  -- A project being deleted takes its permits with it; nothing to sync.
  if exists (select 1 from public.projects where id = v_project) then
    perform public.sync_permit_stages(v_project);
  end if;

  return null;
end;
$$;

drop trigger if exists permit_syncs_milestone on public.permits;
create trigger permit_syncs_milestone
  after insert or update or delete on public.permits
  for each row execute function public.sync_permitting_milestone();

revoke all on function public.sync_permitting_milestone() from public, anon, authenticated;


-- ============================================================================
-- 3. THE SURVEY'S COMPLETION RELEASES A WAITING PERMITTING STAGE
-- ============================================================================

create or replace function public.resync_permits_after_survey()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key = 'engineering_survey'
     and new.status = 'done'
     and old.status is distinct from 'done' then
    perform public.sync_permit_stages(new.project_id);
  end if;
  return null;
end;
$$;

drop trigger if exists milestone_resyncs_permits on public.project_milestones;
create trigger milestone_resyncs_permits
  after update on public.project_milestones
  for each row execute function public.resync_permits_after_survey();

revoke all on function public.resync_permits_after_survey() from public, anon, authenticated;


-- ============================================================================
-- 4. NOTHING IS SWITCHED ON BEFORE THE UTILITY SAYS SO
-- ============================================================================
-- 0072's body. Rule 2 asks the helper rather than the role-checked function,
-- and Rule 2b is new; everything else is reproduced as it was.

create or replace function public.enforce_milestone_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocker record;
  v_gate jsonb;
  v_is_admin boolean := public.is_admin();
  v_forced boolean := false;
  v_held_by text;
begin
  -- Only interested in moving forward. Anyone may reopen or block a stage.
  if new.status not in ('in_progress', 'done')
     or new.status = coalesce(old.status, 'pending') then
    return new;
  end if;

  -- 'done' needs a timestamp (there is a constraint) and, more usefully, needs
  -- to say who. Taken from the session rather than the request.
  if new.status = 'done' then
    if new.completed_at is null then
      new.completed_at := now();
    end if;
    new.completed_by := coalesce((select auth.uid()), new.completed_by);
  end if;

  /* --- Rule 1: order ------------------------------------------------------ */
  select key, label, sequence, status into v_blocker
  from public.project_milestones
  where project_id = new.project_id
    and sequence < new.sequence
    and status <> 'done'
  order by sequence
  limit 1;

  if v_blocker.key is not null then
    if not v_is_admin then
      raise exception
        'Cannot start % — % is still %. Stages have to be completed in order.',
        new.label, v_blocker.label, replace(v_blocker.status::text, '_', ' ')
        using errcode = '42501';
    end if;
    v_forced := true;
    v_held_by := v_blocker.key::text;
  end if;

  /* --- Rule 2: the synchronise gate --------------------------------------- */
  if new.key = 'structural_mounting' then
    v_gate := public.project_gate_facts(new.project_id);

    if not (v_gate ->> 'permits_ready')::boolean or not (v_gate ->> 'materials_ready')::boolean then
      if not v_is_admin then
        raise exception
          'Physical work cannot start yet. Building and electrical permits approved: % of %. Materials on site: %. Both have to be clear before a crew is sent.',
          v_gate ->> 'work_permits_approved',
          v_gate ->> 'work_permits_total',
          case when (v_gate ->> 'materials_ready')::boolean then 'yes' else 'no' end
          using errcode = '42501';
      end if;
      v_forced := true;
      v_held_by := coalesce(v_held_by, 'synchronise gate');
    end if;
  end if;

  /* --- Rule 2b: the utility's approvals (ADDED 0077) ---------------------- */
  -- Signing commissioning off means the system is live. Testing may start
  -- before the utility has answered — its inspection is part of the stage.
  if new.key = 'commissioning' and new.status = 'done' then
    v_gate := public.project_gate_facts(new.project_id);

    if not (v_gate ->> 'energise_ready')::boolean then
      if not v_is_admin then
        raise exception
          'Commissioning cannot be signed off yet. The utility has approved % of % applications, and the system may not be switched on before it has approved them all.',
          v_gate ->> 'energise_permits_approved',
          v_gate ->> 'energise_permits_total'
          using errcode = '42501';
      end if;
      v_forced := true;
      v_held_by := coalesce(v_held_by, 'utility approvals');
    end if;
  end if;

  /* --- Rule 3: an override is allowed, and is recorded -------------------- */
  if v_forced then
    perform public.write_audit(
      'Milestone "' || new.label || '" forced past its preconditions',
      'project_milestones',
      new.id::text,
      'warning',
      jsonb_build_object(
        'project_id', new.project_id,
        'milestone', new.key,
        'new_status', new.status,
        'blocked_by', v_held_by,
        'gate', v_gate,
        'override', true
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_milestone_order() from public, anon, authenticated;


-- ============================================================================
-- 5. PROJECTS ALREADY WAITING
-- ============================================================================
-- Re-run the sync once for every project that tracks permits, so a stage held
-- by the old rule (or blocked by a since-resolved refusal) catches up now
-- rather than at its next permit change.

do $$
declare
  v_project uuid;
begin
  for v_project in
    select distinct pm.project_id
    from public.permits pm
    join public.projects p on p.id = pm.project_id
    where p.status not in ('completed', 'cancelled')
  loop
    perform public.sync_permit_stages(v_project);
  end loop;
end;
$$;
