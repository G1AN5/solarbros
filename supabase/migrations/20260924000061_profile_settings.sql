-- ============================================================================
-- 0061  PROFILE SETTINGS — AND THE COLUMNS SELF-SERVICE MUST NOT REACH
-- ----------------------------------------------------------------------------
-- Adds a profile photo and lets people edit their own name, phone and address.
--
-- THE PART THAT MATTERS MORE THAN THE FEATURE
-- `profiles_update_self` grants UPDATE on your own row. RLS grants ROWS, NOT
-- COLUMNS — so it has always allowed a signed-in user to write ANY column of
-- their own profile through the API, and only `role` was defended, by the
-- trigger from 0052. `email`, `is_active`, `approval_status`, `approved_by` and
-- `approved_at` were all writable by their owner.
--
-- THE SHARPEST EDGE IS `email`.
-- `grant_admin(p_email)` finds its target with `lower(email) = lower(p_email)`.
-- A staff member who sets their own `profiles.email` to the owner's address
-- makes that lookup ambiguous — and the next time the owner creates an
-- administrator for that address, `select ... into` takes whichever row the
-- planner returns. The staff member gets the administrator role and the audit
-- row names the wrong person. That is a privilege escalation which needs no
-- exploit, only patience.
--
-- It was reachable before today. Shipping a settings page that makes profile
-- writes routine is what turns it from latent into likely, so it is fixed here
-- rather than noted for later.
--
-- WHY A TRIGGER AND NOT A NARROWER POLICY
-- Postgres has column-level GRANTs, but they do not compose with RLS the way
-- people expect and they would have to be re-granted every time a column is
-- added. A trigger states the rule once, in one place, and fires no matter
-- which client, key or policy got the write as far as the table.
-- ============================================================================

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'Path within the `avatars` storage bucket. Null means fall back to initials.';


-- ----------------------------------------------------------------------------
-- What you may change about yourself
-- ----------------------------------------------------------------------------

create or replace function public.enforce_profile_self_edit_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /* Only constrains somebody editing their OWN row.

     Administrators acting on other people are untouched, and so is
     `approve_staff`, which by definition edits a row that is not the caller's
     — it has its own guard against approving yourself. Over a direct database
     connection `auth.uid()` is null, so `grant_admin` and migrations are
     unaffected too. */
  if new.id is distinct from (select auth.uid()) then
    return new;
  end if;

  /* An administrator editing their own profile is held to the same list. They
     have no legitimate reason to rewrite their own approval history, and the
     accident this prevents is worth more than the convenience it costs. */
  if new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.approval_status is distinct from old.approval_status
     or new.requested_role is distinct from old.requested_role
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.rejection_reason is distinct from old.rejection_reason
  then
    raise exception
      'You can change your name, phone, address and photo. Your email address, role and account status are not editable here.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_self_edit_scope on public.profiles;

create trigger enforce_profile_self_edit_scope
  before update on public.profiles
  for each row execute function public.enforce_profile_self_edit_scope();

comment on function public.enforce_profile_self_edit_scope() is
  'Row-level security grants rows, not columns. This limits what somebody editing their OWN profile may change, so self-service cannot reach email, role, activation or approval history.';


-- ----------------------------------------------------------------------------
-- Somewhere to put the photograph
-- ----------------------------------------------------------------------------
-- Public-read, like every other avatar system: the URL goes in an <img> on
-- pages that already require a session, and a signed URL per face would mean
-- a round trip for each one on every render of a ticket thread.
--
-- Writes are scoped to a folder named after the owner's user id, so nobody can
-- overwrite anybody else's face.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,                                   -- 2 MB; a face does not need more
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "avatars are readable by anyone" on storage.objects;
create policy "avatars are readable by anyone"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "people upload their own avatar" on storage.objects;
create policy "people upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    -- First path segment must be the caller's own id: `<uid>/face.jpg`.
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "people replace their own avatar" on storage.objects;
create policy "people replace their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "people delete their own avatar" on storage.objects;
create policy "people delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
