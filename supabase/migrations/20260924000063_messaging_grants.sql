-- ============================================================================
-- 0063  SHUT THE DOORS 0062 LEFT OPEN
-- ----------------------------------------------------------------------------
-- A function in the `public` schema is a REST endpoint. Postgres grants EXECUTE
-- to PUBLIC on every new function by default, so anything not explicitly
-- revoked is callable at /rest/v1/rpc/<name> by anybody holding the anon key —
-- which is in the browser bundle of a public marketing site.
--
-- 0062 revoked the two functions it thought of and forgot the helpers. The
-- linter caught it. This is exactly the failure mode the helper functions are
-- most prone to: nobody thinks of an internal helper as an endpoint.
--
-- THE ONE THAT ACTUALLY MATTERED
-- `staff_for_client(p_client uuid)` takes a customer id and returns the staff
-- working on that customer's installation. It is SECURITY DEFINER, so it reads
-- past row-level security, and it never checked who was asking. Any signed-in
-- customer — and, because EXECUTE reached anon, any visitor at all — could pass
-- somebody else's id and get back the engineer, the crew and the sales rep on
-- that job. That is an internal staffing map of another customer's project,
-- handed out by an endpoint written to answer a permission question.
--
-- It is needed only from inside `may_message` and `messageable_people`, both
-- SECURITY DEFINER and owned by the same role, and a definer function executes
-- what it calls as its owner. So revoking EXECUTE from every API role removes
-- the endpoint without touching the feature.
-- ============================================================================

revoke all on function public.staff_for_client(uuid) from public, anon, authenticated, service_role;

-- `am_in_conversation` answers only about the CALLER — it takes no user id and
-- reads auth.uid() — so it discloses nothing. But row-level security policies
-- evaluate as the querying role, which means `authenticated` MUST keep EXECUTE
-- or every read of a conversation fails with a permission error. Only anon is
-- revoked, which has no session and so could never get true from it anyway.
revoke all on function public.am_in_conversation(uuid) from public, anon;
grant execute on function public.am_in_conversation(uuid) to authenticated;

-- Trigger functions are not meant to be called directly at all. Firing a
-- trigger does not consult EXECUTE — that is checked when the trigger is
-- created — so revoking here removes the endpoint and leaves the trigger
-- working.
revoke all on function public.touch_conversation() from public, anon, authenticated, service_role;
revoke all on function public.enforce_profile_self_edit_scope()
  from public, anon, authenticated, service_role;
