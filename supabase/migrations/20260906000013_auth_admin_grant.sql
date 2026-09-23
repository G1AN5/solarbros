-- ============================================================================
-- 0013 · FIX: restore supabase_auth_admin's grant on the auth trigger
-- ----------------------------------------------------------------------------
-- THE BUG
-- After 0009 hardened function privileges, every sign-in failed with:
--
--     AuthApiError: Database error querying schema
--
-- Nobody could log in. The entire application was inaccessible.
--
-- THE CAUSE
-- 0009 contained, correctly in spirit:
--
--     revoke all on function public.handle_new_user() from public, anon, authenticated;
--
-- `public` there is not the schema — it is the PUBLIC pseudo-role, meaning
-- "every role in the database". PostgreSQL grants EXECUTE on new functions to
-- PUBLIC by default, and `supabase_auth_admin` (the role GoTrue connects as)
-- held its access only through that default. Revoking from PUBLIC therefore
-- silently revoked it from GoTrue too.
--
-- public.handle_new_user() is attached as a trigger to auth.users. GoTrue
-- cannot touch auth.users without being able to execute the trigger, so
-- authentication broke completely.
--
-- THE LESSON
-- `revoke ... from public` is a blunt instrument. It removes access from roles
-- you never listed, including Supabase's own internal service roles. Any
-- function reachable from a trigger on an `auth.*` table needs an explicit
-- grant back to supabase_auth_admin afterwards.
--
-- Revoking from PUBLIC was still the right call — the function must not be
-- callable as an RPC endpoint. The fix is to grant it back narrowly, to exactly
-- the one role that legitimately needs it.
--
-- HOW IT WAS CAUGHT
-- scripts/verify-rls.mjs signs in as each demo account through the real API.
-- Nothing in the type-checker, the linter or the unit tests would have noticed
-- this, and it would have presented as "the app is completely broken" during a
-- demonstration.
-- ============================================================================

grant execute on function public.handle_new_user() to supabase_auth_admin;

-- touch_updated_at() is not currently on any auth-schema trigger, but it is
-- generic and likely to be reused. Granting it now avoids reintroducing the
-- same outage the first time somebody attaches it to an auth table.
grant execute on function public.touch_updated_at() to supabase_auth_admin;

-- GoTrue also needs to reach the profiles table through that trigger.
grant usage on schema public to supabase_auth_admin;
grant insert, select, update on public.profiles to supabase_auth_admin;
