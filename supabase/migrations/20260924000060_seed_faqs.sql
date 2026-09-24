-- ============================================================================
-- 0060  THE QUESTIONS EVERY SOLAR CUSTOMER ASKS
-- ----------------------------------------------------------------------------
-- The home page carried a "Common questions" heading over an empty band, and
-- /blog and the FAQ page had nothing in them either. The section is now hidden
-- while empty, so this is not a rescue — it is content the business needs
-- anyway, and a FAQ is the cheapest sales tool a solar company has. Every one
-- of these is a question a Philippine homeowner actually asks before buying.
--
-- WHY THIS IS SEEDED AND REVIEWS AND PORTFOLIO ARE NOT
-- These are statements of fact about how the business works and how solar
-- behaves — the sort of thing the owner would write, and can edit freely under
-- Website Content. A testimonial or a case study is a claim about a real
-- customer who exists. Inventing those would put fabricated praise and
-- fabricated projects on a live commercial site, which is not a placeholder
-- problem, it is a lie to the visitor. Those two sections stay hidden until
-- SolarBros has real ones.
--
-- Figures deliberately hedged ("typically", "most"), and anything that varies
-- by customer points at the estimator or a survey rather than promising a
-- number this file cannot know.
-- ============================================================================

insert into public.faqs (question, answer, category, sort_order, published)
select v.question, v.answer, v.category, v.sort_order, true
from (values

  ('How much can I actually save on my electricity bill?',
   'It depends on how much power you use and when you use it. A system sized to cover most daytime consumption typically removes 50-70% of a monthly bill; covering evening use as well needs batteries and costs more. Rather than guess, use the estimator on this site — it asks which appliances you run and for how long, and gives you a figure based on your own usage instead of an average.',
   'Savings', 1),

  ('How long before the system pays for itself?',
   'For most residential customers, somewhere between five and eight years, against a system designed to last twenty-five. The exact figure depends on your electricity rate, how much of your generation you actually use, and the size of the system. The estimator calculates a payback period for your own numbers.',
   'Savings', 2),

  ('What is the difference between on-grid, hybrid and off-grid?',
   'On-grid is the cheapest. It runs your house from the sun during the day and from the utility at night, but it shuts down in a brownout for the safety of line workers. Hybrid adds batteries, so you keep power when the grid fails and can use solar energy after dark. Off-grid has no utility connection at all and needs enough storage to carry you through a run of cloudy days — normally only worth it where there is no line to connect to.',
   'Systems', 3),

  ('Will solar work during a brownout?',
   'Only if you have batteries. An on-grid system is required by law to disconnect when the grid goes down, because feeding power into a dead line endangers anyone working on it. A hybrid system isolates your house and keeps running. If riding out brownouts is the main reason you are considering solar, you want a hybrid.',
   'Systems', 4),

  ('How long does the installation take?',
   'Most residential installations are completed in about three working days on site. The longer part is before that: site survey, system design, and the utility paperwork for net metering, which is outside our control and varies by provider.',
   'Process', 5),

  ('Do you handle the permits and the net-metering application?',
   'Yes. We prepare the drawings and paperwork and file with your electricity provider and local authority on your behalf. You can follow each approval in your client portal as it comes back. Timelines depend on the offices concerned, so we report progress rather than promise a date.',
   'Process', 6),

  ('What happens to the extra power I generate?',
   'Under net metering, surplus exported to the grid is credited against your bill. The credit is worth less per kWh than the power you avoid buying, which is why systems are sized against what you actually consume rather than to maximise export.',
   'Savings', 7),

  ('How much roof space do I need?',
   'Roughly six square metres for each kilowatt of panels, so a typical 6 kWp home system needs about 36 square metres of unshaded roof. Orientation and shading matter as much as area — the site survey measures both before anything is quoted.',
   'Systems', 8),

  ('What warranty do I get?',
   'Panels carry a 25-year performance warranty from the manufacturer, inverters and batteries carry their own manufacturer terms, and our workmanship is covered separately. Every serial number we install is recorded against your account, so a claim does not depend on you having kept the paperwork.',
   'After-sales', 9),

  ('Do the panels need maintenance?',
   'Very little. They have no moving parts. Dust and bird droppings reduce output, so an occasional rinse helps, and we include a preventive check each year. Your portal shows what the system is producing, which is the quickest way to notice anything wrong.',
   'After-sales', 10),

  ('How do I pay, and do you offer instalments?',
   'Payment is staged as the work progresses rather than in one lump at the start. We accept bank transfer and over-the-counter deposit. Financing through partner banks and in-house instalment terms are available for qualified customers — ask during the consultation, as terms come from the lender rather than from us.',
   'Payment', 11),

  ('What if my roof cannot take the weight, or is the wrong shape?',
   'The site survey checks the structure before any commitment is made. If the roof is unsuitable we will tell you, and where possible propose an alternative such as a smaller array, a different section of roof, or a ground-mounted frame. A survey that ends in "not yet" is a better outcome than an installation that should not have happened.',
   'Process', 12)

) as v(question, answer, category, sort_order)
-- Seeded only into an empty table, so re-running never duplicates entries the
-- owner has since rewritten.
where not exists (select 1 from public.faqs);
