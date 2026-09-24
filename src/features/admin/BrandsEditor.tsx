import { useState, type ChangeEvent } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { QueryState } from '@/components/ui/QueryState'
import { useBrands, useDeleteBrand, useSaveBrand, useUploadBrandLogo } from '@/lib/queries/cms'

/* ============================================================================
   BrandsEditor — the equipment strip on the home page.
   ----------------------------------------------------------------------------
   Answering the question directly: a table beats a folder. Logos dropped into
   `public/` would mean a developer and a redeploy every time a supplier is
   added or a logo is refreshed, plus a filename convention for somebody to get
   wrong. Here the administrator uploads the file and it is live immediately.

   Logos go into the existing `public-media` bucket, which is already
   public-read and already restricted to sales and admin for writes — a logo on
   a marketing page is about as public as a file gets, so no new policy was
   needed.
   ========================================================================== */

const EMPTY_BRAND = {
  name: '',
  logoUrl: '',
  websiteUrl: '',
  sortOrder: 0,
  isActive: true,
}

export function BrandsEditor() {
  // `false` so hidden brands are listed here; the public strip only sees active.
  const brandsQuery = useBrands(false)
  const saveBrand = useSaveBrand()
  const deleteBrand = useDeleteBrand()
  const uploadLogo = useUploadBrandLogo()

  const [draft, setDraft] = useState(EMPTY_BRAND)
  const [editingId, setEditingId] = useState<string | null>(null)

  function reset() {
    setEditingId(null)
    setDraft(EMPTY_BRAND)
  }

  function handleLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    /* The upload returns a public URL and nothing is written to the row until
       the brand itself is saved, so a failed upload leaves no half-made brand
       behind. */
    uploadLogo.mutate(file, {
      onSuccess: (url) => setDraft((prev) => ({ ...prev, logoUrl: url })),
    })
    event.target.value = ''
  }

  return (
    <div className="grid grid--2" style={{ alignItems: 'start' }}>
      <Card>
        <CardHeader
          title={editingId ? 'Edit brand' : 'Add a brand'}
          action={
            editingId && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Cancel
              </Button>
            )
          }
        />
        <CardBody>
          <FormError error={saveBrand.error ?? deleteBrand.error ?? uploadLogo.error} />

          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              saveBrand.mutate(
                { ...(editingId ? { id: editingId } : {}), ...draft },
                { onSuccess: reset },
              )
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="brandName">
                Brand name
              </label>
              <input
                id="brandName"
                className="input"
                required
                maxLength={60}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Canadian Solar"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="brandSite">
                Website
              </label>
              <input
                id="brandSite"
                className="input"
                type="url"
                maxLength={300}
                value={draft.websiteUrl}
                onChange={(e) => setDraft({ ...draft, websiteUrl: e.target.value })}
                placeholder="https://..."
              />
              <p className="xs dim" style={{ marginTop: 'var(--space-1)' }}>
                Clicking the logo opens this in a new tab. Leave it blank and the logo is not a
                link.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="brandLogo">
                Logo
              </label>
              <input
                id="brandLogo"
                className="input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleLogo}
                disabled={uploadLogo.isPending}
              />
              <p className="xs dim" style={{ marginTop: 'var(--space-1)' }}>
                {uploadLogo.isPending
                  ? 'Uploading...'
                  : 'PNG or SVG with a transparent background works best — the strip greys logos out until hovered. Up to 5 MB.'}
              </p>

              {draft.logoUrl && (
                <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                  <img
                    src={draft.logoUrl}
                    alt=""
                    style={{ maxHeight: 40, maxWidth: 120, objectFit: 'contain' }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft({ ...draft, logoUrl: '' })}
                  >
                    Remove logo
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid--2">
              <div className="field">
                <label className="field__label" htmlFor="brandOrder">
                  Position in the strip
                </label>
                <input
                  id="brandOrder"
                  className="input"
                  type="number"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                />
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label className="row" style={{ gap: 'var(--space-2)' }}>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  />
                  <span className="small">Show on the website</span>
                </label>
              </div>
            </div>

            <Button type="submit" variant="primary" disabled={saveBrand.isPending}>
              {saveBrand.isPending ? 'Saving...' : editingId ? 'Save changes' : 'Add brand'}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Brands on the home page" />
        <CardBody>
          <QueryState
            isLoading={brandsQuery.isLoading}
            error={brandsQuery.error as Error | null}
            isEmpty={(brandsQuery.data?.length ?? 0) === 0}
            emptyTitle="No brands yet"
            emptyMessage="The strip is hidden until there is at least one."
          >
            <div className="stack stack--sm">
              {(brandsQuery.data ?? []).map((brand) => (
                <div key={brand.id} className="row row--between">
                  <div className="row" style={{ gap: 'var(--space-3)', minWidth: 0 }}>
                    {brand.logoUrl ? (
                      <img
                        src={brand.logoUrl}
                        alt=""
                        style={{ maxHeight: 28, maxWidth: 80, objectFit: 'contain' }}
                      />
                    ) : (
                      <span className="xs dim">No logo</span>
                    )}
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <span className="small strong">{brand.name}</span>
                      {!brand.isActive && <Badge tone="neutral">Hidden</Badge>}
                      {!brand.websiteUrl && <Badge tone="neutral">No link</Badge>}
                    </div>
                  </div>

                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingId(brand.id)
                        setDraft({
                          name: brand.name,
                          logoUrl: brand.logoUrl ?? '',
                          websiteUrl: brand.websiteUrl ?? '',
                          sortOrder: brand.sortOrder,
                          isActive: brand.isActive,
                        })
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleteBrand.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove ${brand.name} from the strip?`)) {
                          deleteBrand.mutate(brand.id)
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </QueryState>
        </CardBody>
      </Card>
    </div>
  )
}
