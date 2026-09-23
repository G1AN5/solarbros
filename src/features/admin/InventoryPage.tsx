import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { StatTile } from '@/components/ui/StatTile'
import { currency, currencyCompact, number } from '@/lib/format'
import { STOCK_CATEGORY_LABEL } from '@/lib/labels'
import { type FormEvent, useState } from 'react'

import { QueryState } from '@/components/ui/QueryState'
import {
  useDeleteStockItem,
  usePostStockMovement,
  useSaveStockItem,
  useStock,
} from '@/lib/queries/inventory-finance'
import { useUpdateStockThresholds } from '@/lib/queries/settings'
import { useAuth } from '@/app/auth/useAuth'
import type { StockItem } from '@/types/domain'
import type { StockItemInput } from '@/lib/queries/inventory-finance'
import { Modal } from '@/components/ui/Modal'
import { FormError } from '@/components/ui/FormError'
import { datedFilename, downloadCsv } from '@/lib/csv'

/* ============================================================================
   InventoryPage — Inventory & Supply Chain module.
   ----------------------------------------------------------------------------
   THE THREE-NUMBER MODEL that makes this module work:

       onHand    physically in the warehouse
       reserved  committed to signed contracts (BOM reservation)
       available = onHand − reserved   ← the ONLY number sales may promise against

   Reserving on contract signature is what stops two sales reps promising the
   same inverter to different customers in the same week.

   stock MOVES OUT when a technician logs consumed materials in the field
   portal — the deduction is a real event tied to a real job, not a monthly
   stock-take.

   ⚠️ CONCURRENCY: reservations must be written inside a Postgres transaction
   (or a stored procedure) that re-checks availability. Doing the check in
   JavaScript and then writing lets two simultaneous contracts oversell the
   same unit.
   ========================================================================== */

export function InventoryPage() {
  const { user } = useAuth()
  const stockQuery = useStock()
  const updateThresholds = useUpdateStockThresholds()
  const stock = stockQuery.data ?? []

  // Only the two roles accountable for stock may retune thresholds. The
  // database enforces it too; this just avoids showing a field that would
  // reject the edit.
  const canEditThresholds = user?.role === 'inventory_manager' || user?.role === 'admin'

  // Uncommitted edits, keyed by stock item.
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  /* "Stock adjustment" was a button with no handler. A warehouse cannot
     reconcile a stock-take, write off damaged goods or correct a miscount
     without one — and every one of those is an ordinary week. */
  const postMovement = usePostStockMovement()

  /* There was no way to add a product at all. Every item in the system came
     from the seed migration, so the warehouse could not stock something the
     company had started selling without somebody writing SQL — and the system
     could not be populated with a real catalogue in the first place. */
  const saveItem = useSaveStockItem()
  const deleteItem = useDeleteStockItem()
  const [editingItem, setEditingItem] = useState<StockItem | null>(null)
  const [addingItem, setAddingItem] = useState(false)

  const canEditCatalogue = user?.role === 'inventory_manager' || user?.role === 'admin'

  function closeItemForm() {
    setAddingItem(false)
    setEditingItem(null)
    saveItem.reset()
  }

  function handleSaveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    saveItem.mutate(
      {
        id: editingItem?.id,
        sku: String(form.get('sku') ?? ''),
        name: String(form.get('name') ?? ''),
        category: String(form.get('category') ?? 'accessory') as StockItemInput['category'],
        brand: String(form.get('brand') ?? ''),
        unit: String(form.get('unit') ?? 'pc'),
        unitCost: Number(form.get('unitCost') ?? 0),
        reorderPoint: Number(form.get('reorderPoint') ?? 0),
        isSerialised: form.get('isSerialised') === 'on',
      },
      {
        onSuccess: (result) => {
          /* Opening stock goes in as a MOVEMENT rather than as a starting
             balance, so the ledger explains the figure from the first unit.
             A balance nothing accounts for is how stock systems lose trust. */
          const opening = Number(form.get('openingQty') ?? 0)
          if (!editingItem && opening > 0 && result?.id) {
            postMovement.mutate({
              stockItemId: result.id,
              quantity: opening,
              movementType: 'receipt',
              note: 'Opening stock, recorded when the item was added.',
            })
          }
          closeItemForm()
        },
      },
    )
  }
  const [adjusting, setAdjusting] = useState(false)

  const totalValue = stock.reduce((sum, item) => sum + item.onHand * item.unitCost, 0)
  const lowStock = stock.filter((item) => item.onHand - item.reserved < item.reorderPoint)
  const oversold = stock.filter((item) => item.onHand - item.reserved < 0)

  const columns: Column<StockItem>[] = [
    {
      header: 'SKU',
      cell: (item) => <code>{item.sku}</code>,
    },
    {
      header: 'Item',
      cell: (item) => (
        <div>
          <div className="strong">{item.name}</div>
          <div className="xs dim">
            {STOCK_CATEGORY_LABEL[item.category]} · {item.brand}
          </div>
        </div>
      ),
    },
    { header: 'On hand', numeric: true, cell: (item) => number(item.onHand) },
    {
      header: 'Reserved',
      numeric: true,
      cell: (item) => <span className="muted">{number(item.reserved)}</span>,
    },
    {
      header: 'Available',
      numeric: true,
      cell: (item) => {
        const available = item.onHand - item.reserved
        return (
          <span
            className="strong"
            style={{ color: available < 0 ? 'var(--danger-fg)' : undefined }}
          >
            {number(available)}
          </span>
        )
      },
    },
    {
      header: 'Level',
      cell: (item) => {
        const available = item.onHand - item.reserved
        const ratio = Math.max(0, Math.min(available / Math.max(item.reorderPoint, 1), 1))
        const draft = drafts[item.id]
        const dirty = draft !== undefined && Number(draft) !== item.reorderPoint

        return (
          <div style={{ minWidth: 150 }}>
            <Progress value={ratio} tone={ratio < 1 ? 'danger' : 'success'} />

            {/* The reorder point is a judgement call that changes with the
                season and with supplier lead times, so the person who lives
                with it edits it here rather than filing a ticket. */}
            {canEditThresholds ? (
              <div className="row" style={{ marginTop: 4, gap: 'var(--space-2)' }}>
                <span className="xs dim">reorder at</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  aria-label={`Reorder point for ${item.name}`}
                  value={draft ?? String(item.reorderPoint)}
                  onChange={(e) => setDrafts({ ...drafts, [item.id]: e.target.value })}
                  style={{
                    width: 64,
                    padding: '2px 6px',
                    fontSize: 'var(--text-xs)',
                    textAlign: 'right',
                  }}
                />
                {dirty && (
                  <button
                    className="btn btn--primary btn--sm"
                    style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                    disabled={updateThresholds.isPending}
                    onClick={() =>
                      updateThresholds.mutate(
                        { id: item.id, reorderPoint: Number(draft) },
                        {
                          onSuccess: () =>
                            setDrafts((d) => {
                              const next = { ...d }
                              delete next[item.id]
                              return next
                            }),
                        },
                      )
                    }
                  >
                    Save
                  </button>
                )}
              </div>
            ) : (
              <div className="xs dim" style={{ marginTop: 2 }}>
                reorder at {item.reorderPoint}
              </div>
            )}
          </div>
        )
      },
    },
    {
      header: 'Status',
      cell: (item) => {
        const available = item.onHand - item.reserved
        if (available < 0) return <Badge tone="danger">Oversold</Badge>
        if (available < item.reorderPoint) return <Badge tone="warning">Reorder</Badge>
        return <Badge tone="success">Healthy</Badge>
      },
    },
    { header: 'Unit cost', numeric: true, cell: (item) => currency(item.unitCost) },
    {
      header: '',
      cell: (item) =>
        canEditCatalogue ? (
          <Button variant="ghost" size="sm" onClick={() => setEditingItem(item)}>
            Edit
          </Button>
        ) : null,
    },
    {
      header: 'Stock value',
      numeric: true,
      cell: (item) => <span className="strong">{currency(item.onHand * item.unitCost)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Real-time stock with automatic reservation against signed contracts."
        actions={
          <>
            {canEditCatalogue && (
              <Button variant="primary" onClick={() => setAddingItem(true)}>
                + New item
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(datedFilename('stock'), stock, [
                  { header: 'SKU', value: (s) => s.sku },
                  { header: 'Item', value: (s) => s.name },
                  { header: 'Category', value: (s) => s.category },
                  { header: 'Brand', value: (s) => s.brand },
                  { header: 'On hand', value: (s) => s.onHand },
                  { header: 'Reserved', value: (s) => s.reserved },
                  { header: 'Available', value: (s) => s.onHand - s.reserved },
                  { header: 'Reorder point', value: (s) => s.reorderPoint },
                  { header: 'Unit cost', value: (s) => s.unitCost },
                  { header: 'Stock value', value: (s) => s.onHand * s.unitCost },
                ])
              }
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              disabled={!canEditThresholds}
              title={
                canEditThresholds
                  ? 'Correct a count, or write off damaged stock'
                  : 'Only the inventory manager or an administrator can adjust stock'
              }
              onClick={() => setAdjusting(true)}
            >
              Stock adjustment
            </Button>
            {/* Receiving is a PURCHASE ORDER action, not a free-standing one.
                Stock arrives against an order, which is what makes the delivery
                auditable back to what was bought. */}
            <ButtonLink to="/admin/purchasing" variant="primary">
              + Receive delivery
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Total stock value" value={currencyCompact(totalValue)} />
        <StatTile label="SKUs tracked" value={String(stock.length)} />
        <StatTile
          label="Below reorder point"
          value={String(lowStock.length)}
          delta="Procurement needed"
          direction="up"
          invertDelta
        />
        <StatTile
          label="Oversold"
          value={String(oversold.length)}
          delta={oversold.length ? 'Reservations exceed stock' : 'None'}
          direction={oversold.length ? 'up' : 'flat'}
          invertDelta
        />
      </div>

      {/* ------------------------------------------ PROCUREMENT ALERT */}
      {lowStock.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--warning-solid)' }}>
          <CardHeader
            title="⚠ Reorder required"
            action={
              /* Purchase orders are raised on /admin/purchasing, which already
                 lists these same shortfalls with a suggested quantity on each.
                 A second composer here would be a second place for the
                 requisition limit to be got wrong. */
              <ButtonLink to="/admin/purchasing" variant="primary" size="sm">
                Raise a purchase order →
              </ButtonLink>
            }
          />
          <CardBody>
            <div className="stack stack--sm">
              {lowStock.map((item) => {
                const available = item.onHand - item.reserved
                const shortfall = item.reorderPoint - available
                return (
                  <div key={item.id} className="row row--between">
                    <div>
                      <span className="strong small">{item.name}</span>
                      <span className="xs dim" style={{ display: 'block' }}>
                        {item.sku} · {available} available against a reorder point of{' '}
                        {item.reorderPoint}
                      </span>
                    </div>
                    <Badge tone={available < 0 ? 'danger' : 'warning'}>
                      Order {shortfall} more
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}

      <QueryState
        isLoading={stockQuery.isLoading}
        error={stockQuery.error as Error | null}
        emptyIcon="&#128230;"
        emptyTitle="No stock items"
        emptyMessage="Add the catalogue before quoting, so the bill of materials can price itself."
      >
        <DataTable columns={columns} rows={stock} rowKey={(item) => item.id} />
      </QueryState>

      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardBody>
          <h4>How stock moves</h4>
          <div className="grid" style={{ marginTop: 'var(--space-4)' }}>
            <div>
              <Badge tone="info">1. Reserved</Badge>
              <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                A contract is signed in the CRM. The Bill of Materials reserves each line item, so
                the units can no longer be promised elsewhere.
              </p>
            </div>
            <div>
              <Badge tone="warning">2. Issued</Badge>
              <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                Materials are picked and loaded for the installation crew on the scheduled day.
              </p>
            </div>
            <div>
              <Badge tone="success">3. Consumed</Badge>
              <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                The technician logs what was actually used on site. On-hand drops, the reservation
                clears, and serial numbers are written to the asset registry.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------- STOCK ADJUSTMENT */}
      <Modal open={adjusting} onClose={() => setAdjusting(false)} title="Adjust stock">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const direction = String(form.get('direction'))
            const magnitude = Math.abs(Number(form.get('quantity')))

            postMovement.mutate(
              {
                stockItemId: String(form.get('item')),
                // A write-off or an issue REMOVES stock, so the ledger entry is
                // negative. Storing the sign here means the balance trigger
                // needs no special cases.
                quantity: direction === 'remove' ? -magnitude : magnitude,
                movementType: String(form.get('reason')) as 'adjustment',
                note: String(form.get('note') ?? ''),
              },
              { onSuccess: () => setAdjusting(false) },
            )
          }}
        >
          <p className="small muted">
            This writes a movement to the stock ledger — it does not overwrite the balance. The
            on-hand figure is the sum of its movements, so every correction stays traceable to
            whoever made it and why.
          </p>

          <div className="field">
            <label className="field__label" htmlFor="adj-item">
              Item
            </label>
            <select id="adj-item" name="item" className="select" required defaultValue="">
              <option value="" disabled>
                Choose an item…
              </option>
              {stock.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.sku}) — {item.onHand} on hand
                </option>
              ))}
            </select>
          </div>

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="adj-direction">
                Direction
              </label>
              <select id="adj-direction" name="direction" className="select" defaultValue="add">
                <option value="add">Add to stock</option>
                <option value="remove">Remove from stock</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="adj-qty">
                Quantity
              </label>
              <input
                id="adj-qty"
                name="quantity"
                className="input"
                type="number"
                min="1"
                required
              />
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="adj-reason">
              Reason
            </label>
            <select id="adj-reason" name="reason" className="select" defaultValue="adjustment">
              <option value="adjustment">Stock-take correction</option>
              <option value="write_off">Damaged or lost — write off</option>
              <option value="return">Returned to stock</option>
              <option value="issue">Issued out</option>
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="adj-note">
              Note
            </label>
            <input
              id="adj-note"
              name="note"
              className="input"
              required
              placeholder="What happened? An auditor reads this."
            />
          </div>

          <FormError error={postMovement.error} />

          <Button type="submit" variant="primary" block disabled={postMovement.isPending}>
            {postMovement.isPending ? 'Posting…' : 'Post adjustment'}
          </Button>
        </form>
      </Modal>

      {/* -------------------------------------------- ADD / EDIT AN ITEM */}
      <Modal
        open={addingItem || editingItem !== null}
        onClose={closeItemForm}
        title={editingItem ? `Edit · ${editingItem.name}` : 'New stock item'}
      >
        <form className="stack" onSubmit={handleSaveItem}>
          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="item-sku">
                SKU
              </label>
              <input
                id="item-sku"
                name="sku"
                className="input"
                required
                placeholder="PANEL-CS-615"
                defaultValue={editingItem?.sku ?? ''}
              />
              <span className="field__hint">Must be unique. Used on purchase orders.</span>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="item-category">
                Category
              </label>
              <select
                id="item-category"
                name="category"
                className="select"
                defaultValue={editingItem?.category ?? 'panel'}
              >
                <option value="panel">Panel</option>
                <option value="inverter">Inverter</option>
                <option value="battery">Battery</option>
                <option value="racking">Racking</option>
                <option value="charge_controller">Charge controller</option>
                <option value="accessory">Accessory</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="item-name">
              Description
            </label>
            <input
              id="item-name"
              name="name"
              className="input"
              required
              placeholder="Canadian Solar 615W Monocrystalline"
              defaultValue={editingItem?.name ?? ''}
            />
          </div>

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 2 }}>
              <label className="field__label" htmlFor="item-brand">
                Brand
              </label>
              <input
                id="item-brand"
                name="brand"
                className="input"
                defaultValue={editingItem?.brand ?? ''}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="item-unit">
                Counted in
              </label>
              <input
                id="item-unit"
                name="unit"
                className="input"
                placeholder="pc"
                defaultValue={editingItem?.unit ?? 'pc'}
              />
            </div>
          </div>

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="item-cost">
                Unit cost
              </label>
              <input
                id="item-cost"
                name="unitCost"
                className="input"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={editingItem?.unitCost ?? 0}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="item-reorder">
                Reorder point
              </label>
              <input
                id="item-reorder"
                name="reorderPoint"
                className="input"
                type="number"
                min="0"
                defaultValue={editingItem?.reorderPoint ?? 0}
              />
            </div>
          </div>

          {!editingItem && (
            <div className="field">
              <label className="field__label" htmlFor="item-opening">
                Opening stock <span className="dim">(optional)</span>
              </label>
              <input
                id="item-opening"
                name="openingQty"
                className="input"
                type="number"
                min="0"
                defaultValue={0}
              />
              <span className="field__hint">
                Recorded as a receipt movement, not as a starting number — so the ledger explains
                the balance from the very first unit.
              </span>
            </div>
          )}

          <label className="row small" style={{ gap: 'var(--space-2)' }}>
            <input
              type="checkbox"
              name="isSerialised"
              defaultChecked={editingItem?.isSerialised ?? false}
            />
            Carries a serial number
          </label>
          <span className="xs dim">
            Panels, inverters and batteries do; rails and connectors do not. This is what decides
            whether the field portal asks a technician to scan each unit on site.
          </span>

          <FormError error={saveItem.error} />

          <Button type="submit" variant="primary" block disabled={saveItem.isPending}>
            {saveItem.isPending ? 'Saving…' : editingItem ? 'Save changes' : 'Add to the catalogue'}
          </Button>

          {editingItem && (
            <>
              <FormError error={deleteItem.error} />
              <Button
                type="button"
                variant="ghost"
                block
                disabled={deleteItem.isPending}
                onClick={() => {
                  if (window.confirm(`Remove ${editingItem.name} from the catalogue?`)) {
                    deleteItem.mutate({ id: editingItem.id }, { onSuccess: closeItemForm })
                  }
                }}
              >
                Remove from the catalogue
              </Button>
              <p className="xs dim">
                Refused if anything already references it. An item with history stays; let its stock
                run down instead.
              </p>
            </>
          )}
        </form>
      </Modal>
    </>
  )
}
