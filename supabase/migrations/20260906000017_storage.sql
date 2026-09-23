-- ============================================================================
-- 0017 · STORAGE BUCKETS & POLICIES
-- ----------------------------------------------------------------------------
-- File storage for marketing media, project documents and field photos.
--
-- THREE BUCKETS, BECAUSE THEY HAVE THREE DIFFERENT AUDIENCES
--
--   public-media    Portfolio covers, blog images, package photos.
--                   Readable by ANYONE, including logged-out visitors — that is
--                   the entire point, they render on the marketing site.
--                   Writable only by sales and admin.
--
--   project-files   Contracts, invoices, permits, warranty certificates.
--                   PRIVATE. A customer reads only their own; staff read all.
--                   This is where a mistake would leak one customer's contract
--                   value to another, so the policies are the strictest here.
--
--   site-photos     Geotagged installation photos from the field portal.
--                   Private. Uploaded by technicians, visible to the customer
--                   whose roof they are of.
--
-- WHY BUCKET POLICIES ARE SEPARATE FROM TABLE POLICIES
-- Supabase Storage keeps file metadata in `storage.objects`, a table with its
-- own RLS. Securing `public.documents` does nothing for the file itself — a
-- signed-out visitor could still fetch the PDF directly from the storage URL if
-- the bucket allowed it. Both layers have to agree, and they are configured in
-- different places, which is exactly why this is easy to get wrong.
--
-- PATH CONVENTION — load-bearing, not cosmetic
--   project-files/<project_id>/<filename>
--   site-photos/<project_id>/<filename>
-- The policies below parse the project id out of the first path segment and
-- check ownership against it. Uploading to a flat path would silently bypass
-- that check, so the client helpers in src/lib/queries/storage.ts always build
-- the path rather than accepting one.
-- ============================================================================

-- ============================================================================
-- BUCKETS
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'public-media',
    'public-media',
    true,
    5242880, -- 5 MB. A hero image larger than this is a mistake, not a choice.
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml']
  ),
  (
    'project-files',
    'project-files',
    false,
    20971520, -- 20 MB, enough for a scanned permit pack.
    array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  ),
  (
    'site-photos',
    'site-photos',
    false,
    10485760, -- 10 MB. Phone cameras produce large files; technicians are on
              -- mobile data, so the client compresses before upload.
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do nothing;


-- ============================================================================
-- PUBLIC MEDIA
-- Anyone reads. Only the roles that maintain marketing content may write.
-- ============================================================================

create policy "public media is readable by anyone"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'public-media');

create policy "sales and admin upload public media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'public-media' and public.has_role('sales', 'admin'));

create policy "sales and admin replace public media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'public-media' and public.has_role('sales', 'admin'))
  with check (bucket_id = 'public-media' and public.has_role('sales', 'admin'));

create policy "sales and admin delete public media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'public-media' and public.has_role('sales', 'admin'));


-- ============================================================================
-- PROJECT FILES
-- ----------------------------------------------------------------------------
-- The first path segment is the project id. A customer may read a file only if
-- they own that project AND the corresponding `documents` row is marked
-- client-visible — so an internal margin analysis stored against their project
-- stays internal even though the file sits in their folder.
-- ============================================================================

create policy "staff read all project files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'project-files' and public.is_internal());

create policy "clients read their own visible project files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-files'
    and public.owns_project((storage.foldername(name))[1]::uuid)
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and d.is_client_visible
    )
  );

create policy "staff upload project files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'project-files' and public.is_internal());

-- Deletion is restricted more tightly than upload. Removing a signed contract
-- or a permit destroys the evidence trail for a project, so it is limited to
-- the two roles accountable for that record.
create policy "engineers and admin delete project files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'project-files' and public.has_role('project_engineer', 'admin'));


-- ============================================================================
-- SITE PHOTOS
-- Uploaded from the field portal; the customer sees photos of their own roof.
-- ============================================================================

create policy "internal read all site photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'site-photos' and public.is_internal());

create policy "clients read their own site photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'site-photos'
    and public.owns_project((storage.foldername(name))[1]::uuid)
  );

create policy "internal upload site photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'site-photos' and public.is_internal());

create policy "engineers and admin delete site photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'site-photos' and public.has_role('project_engineer', 'admin'));


-- ============================================================================
-- CONTENT TABLES: fields the CMS needs
-- ----------------------------------------------------------------------------
-- Portfolio and blog rows already existed; these add what an editor needs to
-- attach images and write a post properly.
-- ============================================================================

alter table public.portfolio_items
  add column if not exists gallery_paths text[] not null default '{}',
  add column if not exists client_consented boolean not null default false;

comment on column public.portfolio_items.client_consented is
  'A real customer roof, address and photos are being published. This records that they agreed. Nothing publishes without it.';

alter table public.blog_posts
  add column if not exists cover_storage_path text,
  add column if not exists author_name text;

-- Backfill before the constraint. The demo portfolio rows from migration 0012
-- are already published, and the new column defaults to false, so adding the
-- check first fails on existing data.
--
-- These are fictional showcase entries, not real customers, so marking them
-- consented is accurate. Real entries added through the CMS must have the box
-- ticked by whoever publishes them.
update public.portfolio_items set client_consented = true where published;

-- Publishing a portfolio entry means putting a customer's property, address and
-- photographs on the public internet. Consent is not a checkbox to be
-- forgotten later — the database refuses the row without it.
alter table public.portfolio_items
  add constraint portfolio_published_needs_consent
  check (not published or client_consented);
