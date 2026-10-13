import { Link } from 'react-router-dom'

import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { PortfolioCard } from '@/components/ui/PortfolioCard'
import { BrandMarquee } from '@/components/ui/BrandMarquee'
import { CountUp } from '@/components/ui/CountUp'
import { Reveal } from '@/components/ui/Reveal'
import { SolarMark } from '@/components/ui/SolarMark'
import { useCompany, useFaqs } from '@/lib/queries/public-site'
import { usePackages } from '@/lib/queries/crm'
import { usePortfolio, useReviews } from '@/lib/queries/content'
import { currency } from '@/lib/format'

/* ============================================================================
   HomePage — the public landing page.
   ----------------------------------------------------------------------------
   The uploaded spec listed ~18 separate items for the landing page. Rather than
   18 pages, they are organised here as SECTIONS in a deliberate persuasion
   order, with the heavier interactive ones split onto their own routes:

     1. Hero + trust strip      ← "# homes powered", warranty years, install days
     2. Quick estimator teaser  ← deep-links to the full /estimator
     3. Service packages        ← summary of /packages
     4. How it works            ← summary of /how-it-works
     5. Projects portfolio      ← summary of /portfolio
     6. Reviews
     7. Payment options + lifetime support
     8. Service areas
     9. FAQ preview             ← full list on /contact
    10. Final call to action    ← booking + personalised quote

   Sections that needed real interaction (estimator, booking calendar, package
   comparison table, blog) became their own routes so the landing page stays
   fast and scannable.
   ========================================================================== */

/* Built from the configured install time, so the copy tracks the setting. */
function buildProcess(installDays: number) {
  return [
    {
      title: 'Free consultation',
      body: 'Virtual or on-site. We review your bill and roof, and set a realistic target.',
    },
    {
      title: 'Site survey & design',
      body: 'Our engineer measures the roof, checks the structure, and produces the system design.',
    },
    {
      title: 'Proposal & contract',
      body: 'A fixed-price quotation with a full bill of materials. No hidden add-ons.',
    },
    {
      title: 'Permits & net-metering',
      body: 'We prepare and file the utility application on your behalf.',
    },
    {
      title: 'Installation',
      body: `Typically ${installDays} working days for a residential system.`,
    },
    {
      title: 'Commissioning & turnover',
      body: 'Testing, client sign-off, documentation, and monitoring app setup.',
    },
  ]
}

const PAYMENT_OPTIONS = [
  {
    icon: '🗓️',
    title: 'Staged payments',
    body: 'Down payment, delivery milestone, then commissioning. You pay as work completes.',
  },
  {
    icon: '🏦',
    title: 'Bank financing',
    body: '12–36 month terms through our partner banks, with assistance on the application.',
  },
  {
    icon: '🤝',
    title: 'In-house instalment',
    body: 'Flexible terms for qualified residential clients, arranged directly with us.',
  },
]

export function HomePage() {
  // All public reads. RLS exposes only published rows and public settings,
  // so a logged-out visitor gets exactly the marketing content and nothing
  // operational.
  const COMPANY = useCompany()
  const packagesQuery = usePackages()
  const portfolioQuery = usePortfolio()
  const reviewsQuery = useReviews()
  const faqsQuery = useFaqs()

  const PACKAGES = packagesQuery.data ?? []
  const PORTFOLIO = portfolioQuery.data ?? []
  const REVIEWS = reviewsQuery.data ?? []
  const FAQS = faqsQuery.data ?? []
  const PROCESS = buildProcess(COMPANY.installDays)

  return (
    <>
      {/* ---------------------------------------------------------- 1. HERO */}
      <section className="hero">
        <div className="container hero__inner">
          <div className="stack stack--lg">
            <div>
              <span className="eyebrow" style={{ color: 'var(--brand-400)' }}>
                Solar for homes &amp; businesses
              </span>
              {/* Both sentences come from Business Settings. They were the
                  most important copy on the site and the only way to change
                  them was a code edit and a deploy. */}
              <h1 className="hero__title" style={{ marginTop: 'var(--space-3)' }}>
                {COMPANY.heroHeadline}
              </h1>
              <p className="hero__sub">{COMPANY.heroSubhead}</p>
            </div>

            <div className="row row--wrap">
              <ButtonLink to="/estimator" variant="primary" size="lg">
                Calculate my savings
              </ButtonLink>
              <ButtonLink to="/booking" variant="light" size="lg">
                Book a free consultation
              </ButtonLink>
            </div>
          </div>

          {/* The one piece of illustration on the site, drawn in CSS. See
              SolarMark — a hero image good enough to use would be 200-400 KB
              loaded by exactly the person this page exists to persuade. */}
          <SolarMark />
        </div>

        {/* Trust signals — the spec's "About details" block. Moved below the
            two columns rather than beside the headline: at 1.1fr / 0.9fr it was
            competing with the call to action for the same glance, and four
            numbers in a narrow column wrapped badly on a laptop. */}
        <div className="container">
          <div className="trust-strip">
            {/* The figures count up the first time they are scrolled to. Four
                static numbers were the flattest thing on an otherwise moving
                page, and this is the one place where a little movement earns
                its keep — it is what makes somebody read them. */}
            <div>
              <div className="trust-strip__value">
                <CountUp to={COMPANY.homesPowered} suffix="+" />
              </div>
              <div className="trust-strip__label">Homes powered</div>
            </div>
            <div>
              <div className="trust-strip__value">
                <CountUp to={COMPANY.businessesPowered} />
              </div>
              <div className="trust-strip__label">Businesses powered</div>
            </div>
            <div>
              <div className="trust-strip__value">
                <CountUp to={COMPANY.warrantyPanelYears} suffix=" yrs" />
              </div>
              <div className="trust-strip__label">Panel warranty</div>
            </div>
            <div>
              <div className="trust-strip__value">
                <CountUp to={COMPANY.installDays} suffix=" days" />
              </div>
              <div className="trust-strip__label">Typical install</div>
            </div>
          </div>
        </div>
      </section>

      {/* Brands. Was nine grey words on a centred row that wrapped to two
          lines; now a continuous strip fed from the `brands` table, with logos
          and links the administrator maintains under Website Content. */}
      <BrandMarquee />

      {/* ------------------------------------------- 2. ESTIMATOR TEASER */}
      <section className="section section--warm section--edge">
        <div className="container">
          {/* Two columns rather than one wide row. The old layout pinned the
              text hard left and the button hard right with an acre of nothing
              between them, which on a wide screen read as a mistake. The right
              column now carries the three things the estimator gives you, so
              the space is doing work. */}
          <div className="teaser">
            <div className="teaser__glow" aria-hidden="true" />

            <div className="teaser__copy">
              <span className="eyebrow">Free · No obligation</span>
              <h2 style={{ marginBlock: 'var(--space-3)' }}>How much would you actually save?</h2>
              <p className="muted">
                Tell us which appliances you run and for how long. You get a recommended system
                size, an estimated price and a payback period — in about a minute, with no salesman
                and no email required to see it.
              </p>
              <ButtonLink
                to="/estimator"
                variant="primary"
                size="lg"
                style={{ marginTop: 'var(--space-6)' }}
              >
                Open the estimator →
              </ButtonLink>
            </div>

            <ul className="teaser__list">
              <li>
                <span className="teaser__icon" aria-hidden="true">
                  ☀
                </span>
                <span>
                  <strong>The right size</strong>
                  <span className="small muted">
                    Panels, inverter and battery, worked out from what you actually run.
                  </span>
                </span>
              </li>
              <li>
                <span className="teaser__icon" aria-hidden="true">
                  ₱
                </span>
                <span>
                  <strong>A real price</strong>
                  <span className="small muted">
                    What it costs installed, and what it saves you every month.
                  </span>
                </span>
              </li>
              <li>
                <span className="teaser__icon" aria-hidden="true">
                  ⏱
                </span>
                <span>
                  <strong>When it pays back</strong>
                  <span className="small muted">
                    Against a system built to last twenty-five years.
                  </span>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- 3. PACKAGES */}
      <section className="section section--plain section--edge">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">Packages</span>
              <h2>Straightforward pricing, everything included</h2>
              <p>
                Every package covers panels, inverter, mounting, wiring, permits and commissioning.
                No surprise line items at handover.
              </p>
              <span className="section-head__rule" aria-hidden />
            </div>
          </Reveal>

          <Reveal
            stagger
            className="gallery"
            style={{ '--gallery-item': '340px' } as React.CSSProperties}
          >
            {PACKAGES.filter((p) => p.segment === 'residential').map((pkg) => (
              <Card key={pkg.id} accent={pkg.featured} interactive>
                <div className={`pkg${pkg.featured ? ' pkg--featured' : ''}`}>
                  {/* Named so the one-line and two-line descriptions can be
                      levelled. Without it, "Large households, or a home with a
                      small business attached." wraps to two lines and shoves
                      that card's price a row lower than its neighbour's. */}
                  <div className="pkg__intro">
                    <h3>{pkg.name}</h3>
                    <p className="small muted">{pkg.idealFor}</p>
                  </div>
                  <div>
                    <div className="pkg__price">{currency(pkg.priceFrom)}</div>
                    <div className="small dim">{pkg.sizeKw} kWp array · starting price</div>
                  </div>
                  <ul className="pkg__features">
                    {pkg.inclusions.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <div style={{ marginTop: 'auto' }}>
                    <ButtonLink to="/packages" variant={pkg.featured ? 'primary' : 'outline'} block>
                      See full inclusions
                    </ButtonLink>
                  </div>
                </div>
              </Card>
            ))}
          </Reveal>

          <div className="center" style={{ marginTop: 'var(--space-8)' }}>
            <ButtonLink to="/packages" variant="ghost">
              Compare all packages and system types →
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------- 4. HOW IT WORKS */}
      <section className="section section--muted section--edge">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">The process</span>
              <h2>From first call to switch-on</h2>
              <p>Six steps. You can follow every one of them live in your client portal.</p>
              <span className="section-head__rule" aria-hidden />
            </div>
          </Reveal>

          <Reveal stagger>
            <div className="grid" style={{ '--col-min': '300px' } as React.CSSProperties}>
              {PROCESS.map((step, i) => (
                <div key={step.title} className="step step--card" data-step={i + 1}>
                  <div className="step__num">{i + 1}</div>
                  <h4>{step.title}</h4>
                  <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------- 5. PORTFOLIO */}
      {/* HIDDEN WHEN THERE IS NOTHING TO SHOW.
          This section, the reviews below it and the FAQ further down all used
          to render their heading, their rule and their "see all" button over
          an empty grid whenever the table behind them was empty — which it is
          on a new install. A marketing page carrying the words "What our
          clients say" above a blank band does not read as new, it reads as
          abandoned, and it invites the visitor to wonder what else is missing.

          Omitting the section entirely is the honest option, and nothing is
          lost: the moment a real project, review or question exists, the
          section returns by itself. */}
      {PORTFOLIO.length > 0 && (
        <section className="section section--dark">
          <div className="container">
            <Reveal>
              <div className="section-head">
                <span className="eyebrow">Portfolio</span>
                <h2>Recent installations</h2>
                <span className="section-head__rule" aria-hidden />
              </div>
            </Reveal>

            <Reveal stagger>
              <div className="gallery">
                {PORTFOLIO.slice(0, 3).map((project) => (
                  <PortfolioCard key={project.id} item={project} />
                ))}
              </div>
            </Reveal>

            <div className="center" style={{ marginTop: 'var(--space-8)' }}>
              <ButtonLink to="/portfolio" variant="outline">
                View the full portfolio
              </ButtonLink>
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------------------- 6. REVIEWS */}
      {/* Hidden while empty — see the note on the portfolio section. */}
      {REVIEWS.length > 0 && (
        <section className="section section--eco section--edge">
          <div className="container">
            <Reveal>
              <div className="section-head">
                <span className="eyebrow">Customer reviews</span>
                <h2>What our clients say</h2>
                <span className="section-head__rule" aria-hidden />
              </div>
            </Reveal>

            <Reveal stagger>
              <div className="gallery" style={{ '--gallery-item': '380px' } as React.CSSProperties}>
                {REVIEWS.map((review) => (
                  <Card key={review.id} className="review-card">
                    <CardBody>
                      <div className="review__stars" aria-label={`${review.rating} out of 5 stars`}>
                        {'★'.repeat(review.rating)}
                        <span className="dim">{'★'.repeat(5 - review.rating)}</span>
                      </div>
                      {/* The opening mark is drawn large by `.review__quote::before`;
                          typing one here as well printed two. */}
                      <p className="review__quote">{review.quote}”</p>
                      <div className="row">
                        <span className="avatar">
                          {review.displayName
                            .split(' ')
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join('')}
                        </span>
                        <div>
                          <div className="small strong">{review.displayName}</div>
                          <div className="xs dim">
                            {review.displayLocation} · {review.systemSummary}
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ------------------------------- 7. PAYMENT OPTIONS + AFTER-SALES */}
      <section className="section section--muted section--edge">
        <div className="container">
          <Reveal stagger>
            <div className="grid grid--2" style={{ alignItems: 'start' }}>
              <div>
                <span className="eyebrow">Flexible payment</span>
                <h2 style={{ marginBlock: 'var(--space-3)' }}>Options that fit your cash flow</h2>
                <div className="stack">
                  {PAYMENT_OPTIONS.map((option) => (
                    <Card key={option.title} interactive>
                      <CardBody>
                        <div
                          className="row"
                          style={{ alignItems: 'flex-start', gap: 'var(--space-4)' }}
                        >
                          <span className="icon-chip" aria-hidden="true">
                            {option.icon}
                          </span>
                          <div>
                            <h4>{option.title}</h4>
                            <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                              {option.body}
                            </p>
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </div>

              <div>
                <span className="eyebrow">After-sales</span>
                <h2 style={{ marginBlock: 'var(--space-3)' }}>
                  Lifetime support, not a handover and goodbye
                </h2>
                <Card>
                  <CardBody>
                    <ul className="pkg__features">
                      <li>Dedicated client portal with live project tracking</li>
                      <li>Support ticketing with photo upload for hardware issues</li>
                      <li>Annual preventive maintenance packages</li>
                      <li>Warranty registration, and transfer if you sell the property</li>
                      <li>System expansion and upgrade requests handled in-portal</li>
                      {/* All three terms, not just the panels. A hybrid system
                          is mostly what this company sells, and the battery is
                          the part a customer worries about most — quoting only
                          the panel warranty invites the question rather than
                          answering it. */}
                      <li>{COMPANY.warrantyPanelYears}-year panel performance warranty</li>
                      <li>{COMPANY.warrantyBatteryYears}-year battery warranty</li>
                      <li>{COMPANY.warrantyInverterYears}-year inverter warranty</li>
                    </ul>
                  </CardBody>
                </Card>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------- 8. SERVICE AREAS */}
      <section className="section--tight section--plain section--edge">
        <div className="container center">
          <span className="eyebrow">Where we operate</span>
          <h3 style={{ marginBlock: 'var(--space-3)' }}>Service areas</h3>
          <div className="row row--wrap" style={{ justifyContent: 'center' }}>
            {COMPANY.serviceAreas.map((area) => (
              <span key={area} className="badge badge--neutral">
                {area}
              </span>
            ))}
          </div>
          {/* `center` is needed even though the section already centres its
              text: the paragraph is capped at 72ch for readability, and a
              capped box with no auto margin sits flush left however its text
              is aligned. */}
          <p className="small muted center" style={{ marginTop: 'var(--space-4)' }}>
            Outside these areas?{' '}
            <Link to="/contact" style={{ color: 'var(--text-brand)', fontWeight: 600 }}>
              Get in touch
            </Link>{' '}
            — we take selected projects nationwide.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------- 9. FAQ PREVIEW */}
      {/* Hidden while empty — see the note on the portfolio section. */}
      {FAQS.length > 0 && (
        <section className="section section--muted">
          <div className="container container--narrow">
            <Reveal>
              <div className="section-head">
                <span className="eyebrow">FAQ</span>
                <h2>Common questions</h2>
              </div>
            </Reveal>

            {FAQS.slice(0, 4).map((faq) => (
              <div key={faq.id} className="faq__item">
                {/* <details> gives us an accordion with zero JavaScript. */}
                <details>
                  <summary className="faq__q" style={{ cursor: 'pointer', listStyle: 'none' }}>
                    {faq.question}
                    <span aria-hidden>+</span>
                  </summary>
                  <p className="faq__a">{faq.answer}</p>
                </details>
              </div>
            ))}

            <div className="center" style={{ marginTop: 'var(--space-8)' }}>
              <ButtonLink to="/contact" variant="ghost">
                See all questions →
              </ButtonLink>
            </div>
          </div>
        </section>
      )}

      {/* -------------------------------------------- 10. FINAL CALL TO ACTION */}
      <section className="section section--dark">
        <div className="container center">
          <h2 style={{ fontSize: 'var(--text-3xl)' }}>Ready to see your numbers?</h2>
          <p
            style={{
              color: 'var(--ink-300)',
              marginBlock: 'var(--space-4)',
              maxWidth: '56ch',
              marginInline: 'auto',
            }}
          >
            Get a free automated estimate in seconds, or book a consultation with an engineer who
            will look at your actual roof and bill.
          </p>
          <div className="row row--wrap" style={{ justifyContent: 'center' }}>
            <ButtonLink to="/estimator" variant="primary" size="lg">
              Free instant estimate
            </ButtonLink>
            <ButtonLink to="/booking" variant="light" size="lg">
              Book a consultation
            </ButtonLink>
          </div>

          {/* Was an `alert('Live chat widget mounts here.')`. Until a real chat
              widget is mounted — Crisp, Tawk.to or a Supabase Realtime channel
              — sending people to a form that works beats a popup telling them
              about a feature that does not exist. */}
          <div style={{ marginTop: 'var(--space-8)' }}>
            <ButtonLink to="/contact" variant="light">
              💬 Talk to us
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  )
}
