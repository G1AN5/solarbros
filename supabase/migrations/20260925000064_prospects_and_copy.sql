-- ============================================================================
-- 0064  WHERE PROSPECT ENQUIRIES GO, AND COPY THE OWNER CAN CHANGE
-- ----------------------------------------------------------------------------
-- THREE THINGS, ALL THE SAME COMPLAINT: something the business needs is
-- captured or displayed, and nobody can see it or change it.
--
-- 1. ENQUIRIES ARE NOT LOST — THEY ARE INVISIBLE.
--    `submit_enquiry` and `request_booking` both already write a full lead:
--    name, email, phone, address, the message. The CRM board then shows the
--    name, the stage and a score, and NONE of the contact details. So a sales
--    rep looking at a quotation request cannot see the email address they are
--    supposed to reply to. The data was never the problem; the screen was.
--
--    What is genuinely missing is the record of what was done about it. `stage`
--    says where the deal is, not whether anybody has replied. A rep needs to
--    know "has this person been contacted at all", which is the difference
--    between a prospect who is being handled and one who has been ignored for
--    three days.
--
-- 2. THE HOMEPAGE HEADLINE IS COMPILED INTO THE BUNDLE.
--    "Cut your electricity bill by up to 70%" is the single most important
--    sentence on the site and changing it required a developer.
--
-- 3. THERE IS NO BATTERY WARRANTY, only panel, inverter and workmanship — on a
--    company whose main product is a hybrid system with a battery in it.
--
-- HOW A PROSPECT IS TRACKED BEFORE THEY HAVE AN ACCOUNT — already solved.
-- `handle_new_user` claims every lead, contract, project, invoice and
-- appointment whose email matches, the moment that person registers. So the
-- rep works the lead by email now, and if the prospect later creates an
-- account the whole history follows them across automatically. Nothing extra
-- is needed for that; it is recorded here because it is the question everybody
-- asks when they see this table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Has anybody actually replied to this person
-- ----------------------------------------------------------------------------

alter table public.leads
  add column if not exists first_contacted_at timestamptz,
  add column if not exists quotation_sent_at timestamptz,
  add column if not exists contacted_by uuid references public.profiles (id) on delete set null;

comment on column public.leads.first_contacted_at is
  'When somebody first replied to this enquiry. Null means nobody has, which is the only number that matters on a fresh enquiry.';
comment on column public.leads.quotation_sent_at is
  'When a quotation was actually sent, by email or messaging app. Recorded by the rep, because the sending happens outside this system.';

-- The inbox sorts on "never contacted, oldest first", which is the query it
-- runs constantly.
create index if not exists leads_uncontacted_idx
  on public.leads (created_at)
  where first_contacted_at is null;


-- ----------------------------------------------------------------------------
-- 2. The words on the front page
-- ----------------------------------------------------------------------------

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('home.hero_headline', '"Cut your electricity bill by up to 70%."', 'company',
   'Home page headline',
   'The first sentence a visitor reads. Keep it short — it is set in very large type and wraps badly beyond about eight words.',
   'text', null, null, null, array['admin']::public.user_role[], true, 30),

  ('home.hero_subhead', '"Design, permits, installation and lifetime after-sales support — handled end to end by one team. Most homes are switched on in 2 working days."', 'company',
   'Home page sub-heading',
   'The paragraph under the headline. Two sentences at most.',
   'text', null, null, null, array['admin']::public.user_role[], true, 31),

  ('warranty.battery_years', '8', 'warranty',
   'Battery warranty',
   'Years of warranty on battery storage. Shown on the packages page and in the warranty terms.',
   'number', 'years', 0, 30, array['admin']::public.user_role[], true, 4)
on conflict (key) do nothing;
