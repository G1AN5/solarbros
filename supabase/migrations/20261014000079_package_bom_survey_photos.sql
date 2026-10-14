-- ============================================================================
-- 0079 · WHAT A PACKAGE IS MADE OF, AND PHOTOS FROM A SITE SURVEY
-- ----------------------------------------------------------------------------
-- 1. A PACKAGE CARRIES ITS OWN BILL OF MATERIALS
--    A package was a name, a size and a price. Quoting one rebuilt the
--    equipment list from sizing rules every time, so the brands and
--    accessories the company actually sells as "the 6 kW Hybrid" lived in
--    people's heads. Each package now keeps that list — catalogue items and
--    quantities — edited under Website Content → Packages. The quotation
--    builder starts from it, and everything after the quotation (the
--    reservation, purchasing, the job's materials, the serials expected)
--    already follows the quotation's lines.
--
--    Stored on the package row as a list of {stock_item_id, quantity}, so it
--    is covered by the package policies that already exist: anyone reads an
--    active package, Sales and administrators write. The list holds no prices.
--
-- 2. A SITE SURVEY CAN BE PHOTOGRAPHED
--    Every photo had to name a project, and a survey comes before there is
--    one — so a technician standing on a roof to survey it could not record
--    it. A photo may now belong to the visit alone (its file sits in a folder
--    named after the visit), and it finds its project by itself:
--      · when it is taken, if the visit or its enquiry already has a project;
--      · when the enquiry's project is created, otherwise.
--    A customer may open a photo file whenever they may see its record; the
--    folder-name rule alone would have hidden every survey photo from them.
-- ============================================================================


-- 1. ------------------------------------------------------------------------
alter table public.packages
  add column if not exists bom jsonb not null default '[]'::jsonb;

alter table public.packages drop constraint if exists packages_bom_is_list;
alter table public.packages
  add constraint packages_bom_is_list check (jsonb_typeof(bom) = 'array');


-- 2a. A photo taken on a visit with no project looks for one. -------------
create or replace function public.site_photo_finds_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is null and new.appointment_id is not null then
    select coalesce(
             a.project_id,
             (
               select p.id
               from public.projects p
               where a.lead_id is not null
                 and p.lead_id = a.lead_id
               order by p.created_at desc
               limit 1
             )
           )
      into new.project_id
      from public.appointments a
     where a.id = new.appointment_id;
  end if;
  return new;
end;
$$;

drop trigger if exists site_photos_find_project on public.site_photos;
create trigger site_photos_find_project
  before insert on public.site_photos
  for each row execute function public.site_photo_finds_project();

revoke all on function public.site_photo_finds_project() from public, anon, authenticated;


-- 2b. A new project collects the photos from its enquiry's survey. --------
create or replace function public.project_collects_survey_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null then
    update public.site_photos sp
       set project_id = new.id
     where sp.project_id is null
       and sp.appointment_id in (
             select a.id from public.appointments a where a.lead_id = new.lead_id
           );
  end if;
  return null;
end;
$$;

drop trigger if exists projects_collect_survey_photos on public.projects;
create trigger projects_collect_survey_photos
  after insert or update of lead_id on public.projects
  for each row execute function public.project_collects_survey_photos();

revoke all on function public.project_collects_survey_photos() from public, anon, authenticated;


-- 2c. The file follows the record. ---------------------------------------
--     "clients read their own site photos" (0017) reads the project from the
--     folder name, which a survey photo's folder is not. This adds the rule
--     the photo grid actually needs: a customer may open the file of any photo
--     whose record they may see — visible to them, on their own project.
drop policy if exists "clients read site photos on their record" on storage.objects;
create policy "clients read site photos on their record"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'site-photos'
    and exists (
      select 1
      from public.site_photos sp
      where sp.storage_path = objects.name
        and sp.is_client_visible
        and public.owns_project(sp.project_id)
    )
  );
