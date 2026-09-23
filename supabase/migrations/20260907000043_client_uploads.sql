-- ============================================================================
-- 0043  CUSTOMER UPLOADS
-- ----------------------------------------------------------------------------
-- Two file inputs in the customer portal could never have worked, and one of
-- them broke a whole workflow:
--
--   /portal/tickets   "Photos (strongly recommended)" — a photo of the
--                     inverter's error screen is usually enough to diagnose a
--                     fault without sending a van. The input was decoration.
--
--   /portal/warranty  "Proof of sale (deed of sale or similar)" — and on the
--                     other side of the desk, the staff warranty queue asks a
--                     reviewer to approve moving a warranty to a different
--                     person. THE EVIDENCE FOR THAT DECISION IS THIS FILE, and
--                     the customer had no way to send it. The reviewer was
--                     being asked to approve on trust.
--
-- Nothing was wired because nothing COULD be: 0017 grants insert on
-- `project-files` to `public.is_internal()` only, and `documents_write_internal`
-- does the same for the metadata row. So this migration opens exactly enough
-- and no more.
--
-- WHAT IS DELIBERATELY NARROW
--   · Uploads go under `<project_id>/uploads/`, a subfolder. The path
--     convention in 0017 parses the project id out of the FIRST segment, so
--     ownership is still checked the same way — and a customer cannot land a
--     file on top of a staff one, because names never collide across folders.
--   · No UPDATE and no DELETE for customers. A signed contract in that folder
--     stays exactly as it was; an upload can be added and never replaced.
--   · The metadata row is written by a SECURITY DEFINER function, not by a
--     widened table policy. `documents` carries `is_client_visible`, and a
--     customer who could INSERT freely could mark an internal document visible
--     to themselves. The function decides those fields; the caller does not.
--   · Only two kinds are accepted. A customer has no business filing something
--     as a 'contract' or a 'permit'.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The file itself
-- ----------------------------------------------------------------------------

create policy "clients upload to their own project folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-files'
    and public.owns_project((storage.foldername(name))[1]::uuid)
    -- Second segment must be 'uploads'. Keeps customer files in their own
    -- subfolder, away from anything the company generated.
    and (storage.foldername(name))[2] = 'uploads'
  );


-- ----------------------------------------------------------------------------
-- 2. The metadata row that makes it findable
-- ----------------------------------------------------------------------------

create or replace function public.record_client_upload(
  p_project_id uuid,
  p_storage_path text,
  p_name text,
  p_kind text,
  p_mime_type text default null,
  p_size_kb integer default null,
  p_ticket_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_kind public.document_kind;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the ownership check RLS would have made
  -- is made here explicitly.
  if not public.owns_project(p_project_id) then
    raise exception 'That is not your project.' using errcode = '42501';
  end if;

  /* The path is checked, not trusted. A caller who sent
     'someone-elses-project/uploads/x.pdf' would otherwise attach their file to
     a stranger's project record — the storage policy would have refused the
     upload, but the row would still be there pointing at nothing, which is its
     own kind of mess. */
  if p_storage_path is null
     or p_storage_path not like p_project_id::text || '/uploads/%' then
    raise exception 'That file was not stored where it should be.' using errcode = '22023';
  end if;

  if p_kind not in ('proof_of_sale', 'other') then
    raise exception 'A customer cannot file a document as %.', p_kind using errcode = '22023';
  end if;
  v_kind := p_kind::public.document_kind;

  if p_ticket_id is not null then
    if not exists (
      select 1 from public.tickets t
      where t.id = p_ticket_id and t.client_id = v_uid
    ) then
      raise exception 'That is not your ticket.' using errcode = '42501';
    end if;
  end if;

  insert into public.documents (
    name, kind, project_id, client_id, ticket_id,
    storage_path, mime_type, size_kb, is_client_visible, uploaded_by
  )
  values (
    left(btrim(coalesce(p_name, 'Upload')), 200),
    v_kind,
    p_project_id,
    v_uid,
    p_ticket_id,
    p_storage_path,
    left(coalesce(p_mime_type, ''), 100),
    greatest(0, coalesce(p_size_kb, 0)),
    -- Their own file. Hiding it from them would be absurd, and the storage
    -- read policy in 0017 requires this to be true for them to fetch it back.
    true,
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_client_upload(uuid, text, text, text, text, integer, uuid)
  from public, anon;
grant execute on function public.record_client_upload(uuid, text, text, text, text, integer, uuid)
  to authenticated;

comment on function public.record_client_upload(uuid, text, text, text, text, integer, uuid) is
  'Registers a file a customer uploaded to their own project folder. Decides is_client_visible and uploaded_by itself rather than accepting them, and refuses any document kind a customer has no business filing.';
