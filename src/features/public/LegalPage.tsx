import { Link, useParams } from 'react-router-dom'

import { QueryState } from '@/components/ui/QueryState'
import { useLegalDocuments } from '@/lib/queries/cms'

/* ============================================================================
   LegalPage — one route serving privacy policy, terms and warranty terms.
   ----------------------------------------------------------------------------
   The spec listed "Legal info" as a single landing-page bullet. In practice
   that is three separate documents, all with identical layout — so they share
   one route (/legal/:document) rather than three near-identical components.

   THE TEXT NOW LIVES IN THE DATABASE.
   It used to be built by a function in this file, with a standing warning that
   it was placeholder scaffolding and counsel should draft the real wording.
   That warning was the problem: when counsel does hand the real text over, the
   only way to publish it was a developer editing TypeScript and redeploying —
   on the one kind of content nobody should be retyping or paraphrasing.

   Migration 0066 moved the same words into `legal_documents`, unchanged, where
   an administrator edits them under Website Content. This component now only
   renders whatever is there.
   ========================================================================== */

export function LegalPage() {
  const { document: docKey } = useParams<{ document: string }>()
  const documentsQuery = useLegalDocuments()

  const documents = documentsQuery.data ?? []
  const doc = documents.find((d) => d.slug === docKey)

  return (
    <div className="section">
      <div className="container container--narrow">
        <QueryState
          isLoading={documentsQuery.isLoading}
          error={documentsQuery.error as Error | null}
          loadingLabel="Loading…"
        >
          {!doc ? (
            <>
              <h1>Document not found</h1>
              <p className="muted" style={{ marginBlock: 'var(--space-4)' }}>
                Available documents:
              </p>
              <ul className="stack stack--sm">
                {documents.map((value) => (
                  <li key={value.slug}>
                    <Link
                      to={`/legal/${value.slug}`}
                      style={{ color: 'var(--text-brand)', fontWeight: 600 }}
                    >
                      {value.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <span className="eyebrow">Legal</span>
              <h1 style={{ marginBlock: 'var(--space-3)' }}>{doc.title}</h1>
              {/* The real edit date, not today's. A legal page that claims to
                  have been updated every time somebody loads it is worse than
                  one with no date at all. */}
              <p className="small dim">
                Last updated{' '}
                {new Date(doc.updatedAt).toLocaleDateString('en-PH', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>

              <div className="stack stack--lg" style={{ marginTop: 'var(--space-8)' }}>
                {doc.sections.map((section, index) => (
                  <section key={`${section.heading}-${index}`}>
                    <h3>{section.heading}</h3>
                    <p className="muted" style={{ marginTop: 'var(--space-2)', lineHeight: 1.7 }}>
                      {section.body}
                    </p>
                  </section>
                ))}
              </div>

              <hr style={{ marginBlock: 'var(--space-10)' }} />

              <div className="row row--wrap">
                {documents
                  .filter((value) => value.slug !== docKey)
                  .map((value) => (
                    <Link
                      key={value.slug}
                      to={`/legal/${value.slug}`}
                      style={{ color: 'var(--text-brand)', fontWeight: 600 }}
                    >
                      {value.title}
                    </Link>
                  ))}
              </div>
            </>
          )}
        </QueryState>
      </div>
    </div>
  )
}
