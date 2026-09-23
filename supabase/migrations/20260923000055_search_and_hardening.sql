-- ============================================================================
-- 0055  SEARCH WITHOUT STRING-BUILT FILTERS, AND TWO PIECES OF HOUSEKEEPING
-- ----------------------------------------------------------------------------
-- THE DEFECT
-- The console search built a PostgREST filter by interpolating what the user
-- typed into a filter-grammar string:
--
--     .or(`reference.ilike.${pattern},address.ilike.${pattern}`)
--
-- `%` and `_` were escaped, because those are LIKE wildcards. The PostgREST
-- grammar characters were not — and a comma in that string is an OR separator.
-- Searching for `x,status.eq.completed` therefore sent FOUR or-branches instead
-- of two, one of them a condition the user wrote.
--
-- HOW BAD IT ACTUALLY IS, STATED HONESTLY
-- Row-level security still applied, and the profiles query was additionally
-- pinned with `.eq('role','client')`, so this could not read anything the
-- caller was not already entitled to. It is not a data breach. It IS a real
-- injection into a query grammar, it produces wrong results, it can throw 400s
-- on any search containing a comma — and it becomes a leak the day somebody
-- removes that `.eq` or widens a policy, which is exactly the kind of latent
-- fault that is cheap now and expensive later.
--
-- THE FIX IS TO STOP BUILDING QUERIES FROM STRINGS
-- Escaping the grammar would work until somebody forgets a character. A
-- function takes the term as a bound parameter, where it is data and can never
-- be read as syntax, whatever is in it.
--
-- SECURITY INVOKER, DELIBERATELY
-- Almost every other function here is SECURITY DEFINER because it needs to see
-- past RLS. This one must NOT: it should return exactly what the caller is
-- allowed to see, and running as the caller means RLS does that scoping for
-- free. A technician and an accountant searching the same word get different
-- results, with no role logic written here at all.
-- ============================================================================

create or replace function public.console_search(p_term text)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with needle as (
    -- Escaped for LIKE, then bound as a value. `%` and `_` in somebody's name
    -- should match themselves rather than act as wildcards.
    select '%' || replace(replace(replace(btrim(p_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as q
  )
  (
    select 'project'::text, p.id, p.reference::text, coalesce(p.address, '')::text
    from public.projects p, needle n
    where p.reference ilike n.q or p.address ilike n.q
    order by p.reference
    limit 5
  )
  union all
  (
    select 'client'::text, pr.id, coalesce(pr.full_name, pr.email)::text, pr.email::text
    from public.profiles pr, needle n
    where pr.role = 'client'
      and (pr.full_name ilike n.q or pr.email ilike n.q)
    order by pr.full_name
    limit 5
  )
  union all
  (
    select 'ticket'::text, t.id, t.reference::text, t.subject::text
    from public.tickets t, needle n
    where t.reference ilike n.q or t.subject ilike n.q
    order by t.created_at desc
    limit 5
  );
$$;

revoke all on function public.console_search(text) from public, anon;
grant execute on function public.console_search(text) to authenticated;

comment on function public.console_search(text) is
  'Cross-module search for the staff console. SECURITY INVOKER on purpose, so row-level security scopes the results to the caller and no role logic is duplicated here.';


-- ----------------------------------------------------------------------------
-- HOUSEKEEPING 1 — the demo re-seeder has no business in production
-- ----------------------------------------------------------------------------
-- `refresh_demo_data()` rolls the demonstration data forward. It checks for an
-- administrator, so it was never open to customers — but it exists to restore
-- sample records, the sample records are gone, and a function whose only job is
-- to write fictional data into a live system should not be reachable from the
-- API at all. The Supabase linter flags it for the same reason.

drop function if exists public.refresh_demo_data();


-- ----------------------------------------------------------------------------
-- HOUSEKEEPING 2 — a read-only helper that was open to every signed-in user
-- ----------------------------------------------------------------------------
-- `project_gate_status` is the only SECURITY DEFINER function in the schema
-- that does not check the caller's role, because it reports whether a project's
-- permits and materials are clear — a fact its own RLS-scoped callers already
-- see. Bypassing RLS to answer it means a customer could ask about any project
-- by id. Restricted to internal roles, which is who the dispatch board and
-- project screens are for.

create or replace function public.project_gate_status(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permits_total integer;
  v_permits_approved integer;
  v_permits_rejected integer;
  v_reservations integer;
  v_short integer;
begin
  /* THE ONLY CHANGE. Everything below is the existing body, reproduced exactly
     — the seven fields it returns and the rule that no permits means the gate
     stays shut are both relied on by the dispatch board and the project page,
     and rewriting a function from memory is how that gets quietly lost. */
  if not public.is_internal() then
    raise exception 'Not your project.' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'rejected')
  into v_permits_total, v_permits_approved, v_permits_rejected
  from public.permits
  where project_id = p_project_id;

  select count(*), count(*) filter (where status = 'short')
  into v_reservations, v_short
  from public.stock_reservations
  where project_id = p_project_id;

  return jsonb_build_object(
    -- No permits tracked means nobody has said which are needed yet, so the
    -- gate stays shut. Silence is not approval.
    'permits_ready', v_permits_total > 0 and v_permits_approved = v_permits_total,
    'permits_total', v_permits_total,
    'permits_approved', v_permits_approved,
    'permits_rejected', v_permits_rejected,
    'materials_ready', v_reservations > 0 and v_short = 0,
    'reservations', v_reservations,
    'reservations_short', v_short
  );
end;
$$;

revoke all on function public.project_gate_status(uuid) from public, anon;
grant execute on function public.project_gate_status(uuid) to authenticated;
