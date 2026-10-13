import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { date, number } from '@/lib/format'
import { DOCUMENT_KIND_LABEL } from '@/lib/labels'
import { useMyDocuments } from '@/lib/queries/client-portal'
import type { DocumentKind, StoredDocument } from '@/types/domain'
import { getPrivateFileUrl } from '@/lib/queries/storage'

/* ============================================================================
   DocumentVaultPage — "Asset and Document Vault" from the spec.
   ----------------------------------------------------------------------------
   A single place for every PDF a customer might need years after turnover:
   quotation, contract, receipts, permits, warranty and turnover certificates.

   BACKEND PLAN
     • Files live in a PRIVATE Supabase Storage bucket, never public.
     • Metadata lives in a `documents` table with a project_id foreign key.
     • Downloads use `createSignedUrl(path, 60)` — short-lived, single-use links.
       Never expose permanent public URLs: these contain contract values,
       addresses and signatures.
     • An RLS policy on the bucket restricts each client to their own project's
       folder.
   ========================================================================== */

type Filter = 'all' | DocumentKind

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All documents' },
  { value: 'contract', label: 'Contracts' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'receipt', label: 'Receipts' },
  { value: 'warranty_certificate', label: 'Warranties' },
  { value: 'permit', label: 'Permits' },
  { value: 'other', label: 'Your uploads' },
]

/** Small visual cue per document type — faster to scan than text alone. */
const ICONS: Record<DocumentKind, string> = {
  quotation: '📋',
  contract: '📝',
  invoice: '🧾',
  receipt: '💳',
  warranty_certificate: '🛡️',
  turnover_certificate: '🏅',
  inspection_report: '🔍',
  permit: '🏛️',
  survey_report: '📐',
  as_built: '📏',
  proof_of_sale: '🏠',
  other: '📎',
}

export function DocumentVaultPage() {
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  /* This button used to be `alert('Signed download URL generated here.')`.

     The file lives in a PRIVATE bucket, so there is no public URL to link to —
     a signed one has to be minted per request. It is valid for a minute
     deliberately: a link to a signed contract that works for a week is a link
     that gets forwarded and still works long after it should have stopped. */
  async function download(doc: { id: string; name: string; storagePath?: string }) {
    if (!doc.storagePath) return
    setDownloading(doc.id)
    setDownloadError(null)
    try {
      const url = await getPrivateFileUrl('project-files', doc.storagePath)
      if (!url) {
        setDownloadError('That file could not be opened. Please contact us.')
        return
      }
      window.open(url, '_blank', 'noopener')
    } finally {
      setDownloading(null)
    }
  }

  /* This was "Download all as ZIP" and did nothing. A real ZIP means
     shipping a compression library (~100 KB) to build an archive the browser
     will immediately unpack again, and the customer wanted the files, not the
     format. Opening each one in turn is the same outcome with nothing added to
     the bundle - and it reports progress, which a silent ZIP would not. */
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)

  async function downloadAll(docs: StoredDocument[]) {
    const withFiles = docs.filter((d) => d.storagePath)
    if (withFiles.length === 0) return

    setBulk({ done: 0, total: withFiles.length })
    for (const [index, doc] of withFiles.entries()) {
      const url = await getPrivateFileUrl('project-files', doc.storagePath!)
      if (url) window.open(url, '_blank', 'noopener')
      setBulk({ done: index + 1, total: withFiles.length })
    }
    setBulk(null)
  }

  const [filter, setFilter] = useState<Filter>('all')
  const documentsQuery = useMyDocuments()
  const documents = documentsQuery.data ?? []

  const rows = filter === 'all' ? documents : documents.filter((d) => d.kind === filter)

  const columns: Column<StoredDocument>[] = [
    {
      header: 'Document',
      cell: (doc) => (
        <span className="row">
          <span aria-hidden>{ICONS[doc.kind]}</span>
          <span className="strong">{doc.name}</span>
        </span>
      ),
    },
    {
      header: 'Type',
      cell: (doc) => <Badge tone="neutral">{DOCUMENT_KIND_LABEL[doc.kind]}</Badge>,
    },
    { header: 'Uploaded', cell: (doc) => date(doc.uploadedAt) },
    {
      header: 'Size',
      numeric: true,
      cell: (doc) => `${number(doc.sizeKb)} KB`,
    },
    {
      header: '',
      cell: (doc) => (
        <Button
          variant="outline"
          size="sm"
          disabled={!doc.storagePath || downloading === doc.id}
          onClick={() => void download(doc)}
        >
          {downloading === doc.id ? 'Preparing…' : 'Download'}
        </Button>
      ),
    },
  ]

  return (
    <>
      {downloadError && (
        <p
          role="alert"
          className="small"
          style={{
            marginBottom: 'var(--space-4)',
            padding: 'var(--space-3)',
            background: 'var(--danger-bg)',
            color: 'var(--danger-fg)',
            borderRadius: 'var(--radius)',
          }}
        >
          {downloadError}
        </p>
      )}

      <PageHeader
        title="Document vault"
        description="Every document for your installation, in one place — permanently."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Documents' }]}
        actions={
          <Button
            variant="outline"
            disabled={bulk !== null || rows.length === 0}
            onClick={() => void downloadAll(rows)}
          >
            {bulk ? `Opening ${bulk.done} of ${bulk.total}…` : 'Download all'}
          </Button>
        }
      />

      <Tabs tabs={FILTERS} active={filter} onChange={setFilter} />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(doc) => doc.id}
        emptyMessage="No documents of this type yet."
      />

      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>🔒</span>
            <div>
              <h4>Your documents are private</h4>
              <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                Files are stored encrypted and are only accessible to you and authorised SolarBros
                staff. Download links expire after 60 seconds, so a link you share by accident
                cannot be reused.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  )
}
