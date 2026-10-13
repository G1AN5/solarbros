import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { StatTile } from '@/components/ui/StatTile'
import { useAuth } from '@/app/auth/useAuth'
import { currency, currencyCompact, date } from '@/lib/format'
import { useStock } from '@/lib/queries/inventory-finance'
import {
  type PoStatus,
  type PurchaseOrder,
  type Supplier,
  useApprovePurchaseOrder,
  useCreatePurchaseOrder,
  useMatchPurchaseOrder,
  useProjectShortfalls,
  usePurchaseOrders,
  useReceivePurchaseOrder,
  useSaveSupplier,
  useSuppliers,
} from '@/lib/queries/procurement'
import { settingNum, useSettings } from '@/lib/queries/settings'
import { stockLevel } from '@/lib/stock'

/* ============================================================================
   PurchasingPage — raising orders and receiving deliveries.
   ----------------------------------------------------------------------------
   The procurement half of what has to happen between a signed contract and an
   installation. It sits opposite Permits: both run in parallel, and the crew
   cannot start until both are clear.

   WHAT TO ORDER, FIRST
   Two lists sit at the top, because they are why anyone opens this page:
   materials signed projects are still short of (held against the contract,
   filled automatically when a delivery is received), and catalogue items at or
   below their reorder point.

   THE SUPPLIER IS ALSO AN EXTERNAL PARTY
   Same problem as the permits screen. The supplier's despatch clerk has no
   login here, so somebody in the warehouse records the confirmation and the
   delivery on their behalf, against the supplier's own reference number.

   RECEIVING IS THE ONLY ACTION HERE THAT MOVES STOCK
   Marking a delivery received writes a `receipt` movement per line, and the
   ledger trigger raises `on_hand` from that. The warehouse total stays exactly
   the sum of its movements, so a stock figure can always be traced back to the
   delivery that produced it.

   WHO DOES WHAT
   The inventory manager raises orders and keeps the supplier list; above the
   requisition limit, an order goes to an administrator to approve. The
   accountant approves within the limit and records the three-way match.
   ========================================================================== */

const STATUS_TONE: Record<PoStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  ordered: 'info',
  partially_received: 'warning',
  received: 'success',
  cancelled: 'danger',
}

const STATUS_LABEL: Record<PoStatus, string> = {
  draft: 'Draft',
  pending_approval: 'With an administrator',
  approved: 'Approved',
  ordered: 'Ordered',
  partially_received: 'Partly received',
  received: 'Received',
  cancelled: 'Cancelled',
}

interface DraftLine {
  stockItemId: string
  quantity: number
  unitCost: number
}

export function PurchasingPage() {
  const { user } = useAuth()
  const ordersQuery = usePurchaseOrders()
  const suppliersQuery = useSuppliers()
  const stockQuery = useStock()
  const shortfallsQuery = useProjectShortfalls()
  const settings = useSettings().data

  const orders = ordersQuery.data ?? []
  const suppliers = suppliersQuery.data ?? []
  const activeSuppliers = suppliers.filter((s) => s.isActive)
  const stock = stockQuery.data ?? []
  const shortfalls = shortfallsQuery.data ?? []
  const approvalLimit = settingNum(settings, 'inventory.requisition_approval_limit', 100000)

  const isAdmin = user?.role === 'admin'
  // Lines and suppliers are the warehouse's; the database refuses anyone else.
  const keepsStock = user?.role === 'inventory_manager' || isAdmin

  const createOrder = useCreatePurchaseOrder()
  const approveOrder = useApprovePurchaseOrder()
  const receiveOrder = useReceivePurchaseOrder()
  const matchOrder = useMatchPurchaseOrder()
  const saveSupplier = useSaveSupplier()

  const [raising, setRaising] = useState(false)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | 'new' | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])

  /* Items at or below their reorder point — the same rule the Inventory page uses. */
  const needsReordering = stock.filter((s) => {
    const level = stockLevel(s)
    return level === 'reorder' || level === 'oversold'
  })

  /* Shortfalls, one line per item, with the projects waiting on it. */
  const shortByItem = new Map<
    string,
    { name: string; sku: string; short: number; projects: string[] }
  >()
  for (const s of shortfalls) {
    const entry = shortByItem.get(s.stockItemId) ?? {
      name: s.itemName,
      sku: s.sku,
      short: 0,
      projects: [],
    }
    entry.short += s.short
    entry.projects.push(`${s.projectReference} (${s.short})`)
    shortByItem.set(s.stockItemId, entry)
  }

  const open = orders.filter((o) => o.status !== 'received' && o.status !== 'cancelled')
  const committed = open.reduce((sum, o) => sum + o.totalAmount, 0)
  const awaitingDelivery = orders.filter((o) => o.status === 'ordered')

  function addLine(stockItemId: string, quantity?: number) {
    const item = stock.find((s) => s.id === stockItemId)
    if (!item) return
    // Default to whatever brings it back to twice the reorder point — a
    // starting figure the buyer adjusts, not a decision.
    const suggested =
      quantity ?? Math.max(1, Math.ceil(item.reorderPoint * 2 - (item.onHand - item.reserved)))
    setLines((prev) =>
      prev.some((l) => l.stockItemId === stockItemId)
        ? prev.map((l) =>
            l.stockItemId === stockItemId ? { ...l, quantity: Math.max(l.quantity, suggested) } : l,
          )
        : [...prev, { stockItemId, quantity: suggested, unitCost: item.unitCost }],
    )
  }

  const draftTotal = lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0)
  const needsAdminApproval = draftTotal > approvalLimit

  function handleRaise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    createOrder.mutate(
      {
        supplierId: String(form.get('supplier')),
        expectedAt: String(form.get('expected') ?? '') || undefined,
        notes: String(form.get('notes') ?? ''),
        lines,
      },
      {
        onSuccess: () => {
          setRaising(false)
          setLines([])
        },
      },
    )
  }

  function handleReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!receiving) return
    const form = new FormData(event.currentTarget)

    receiveOrder.mutate(
      { id: receiving.id, supplierReference: String(form.get('reference') ?? '') },
      { onSuccess: () => setReceiving(null) },
    )
  }

  function handleSaveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    saveSupplier.mutate(
      {
        id: editingSupplier && editingSupplier !== 'new' ? editingSupplier.id : undefined,
        name: String(form.get('name') ?? ''),
        contactPerson: String(form.get('contact') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? ''),
        address: String(form.get('address') ?? ''),
        leadTimeDays: Number(form.get('leadTime') ?? 14),
        isActive: form.get('active') === 'on',
      },
      { onSuccess: () => setEditingSupplier(null) },
    )
  }

  function cancelOrder(order: PurchaseOrder) {
    if (
      window.confirm(`Cancel ${order.poNumber}? Tell ${order.supplierName} too, if it was sent.`)
    ) {
      approveOrder.mutate({ id: order.id, status: 'cancelled' })
    }
  }

  return (
    <>
      <PageHeader
        title="Purchasing"
        description="Raise purchase orders, record supplier confirmations and receive deliveries into stock."
        breadcrumbs={[{ label: 'Supply Chain' }, { label: 'Purchasing' }]}
        actions={
          keepsStock ? (
            <Button variant="primary" onClick={() => setRaising(true)}>
              + Raise a purchase order
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Open orders"
          value={String(open.length)}
          delta={
            awaitingDelivery.length ? `${awaitingDelivery.length} awaiting delivery` : undefined
          }
          direction="flat"
        />
        <StatTile label="Committed spend" value={currencyCompact(committed)} />
        <StatTile
          label="Short for signed projects"
          value={String(shortByItem.size)}
          delta={shortByItem.size ? 'Holding up installations' : 'Nothing waiting'}
          direction={shortByItem.size ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile
          label="Below reorder point"
          value={String(needsReordering.length)}
          delta={needsReordering.length ? 'Order these' : 'Stock healthy'}
          direction={needsReordering.length ? 'up' : 'flat'}
          invertDelta
        />
      </div>

      {/* ------------------------------------------ PROJECT SHORTFALLS */}
      {shortByItem.size > 0 && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--danger-solid)' }}>
          <CardHeader
            title={`Signed projects are waiting for (${shortByItem.size})`}
            action={<span className="xs dim">Filled automatically when a delivery arrives</span>}
          />
          <CardBody>
            <div className="stack stack--sm">
              {[...shortByItem.entries()].map(([itemId, entry]) => (
                <div key={itemId} className="row row--between row--wrap">
                  <div>
                    <span className="strong small">
                      {entry.short} × {entry.name}
                    </span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {entry.sku} · for {entry.projects.join(', ')}
                    </span>
                  </div>
                  {keepsStock && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        addLine(itemId, entry.short)
                        setRaising(true)
                      }}
                    >
                      Add to an order
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------ REORDER PROMPTS */}
      {needsReordering.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--warning-solid)' }}>
          <CardHeader
            title={`Below the reorder point (${needsReordering.length})`}
            action={
              <span className="xs dim">Thresholds are set per item in Inventory, not in code</span>
            }
          />
          <CardBody>
            <div className="stack stack--sm">
              {needsReordering.map((item) => (
                <div key={item.id} className="row row--between row--wrap">
                  <div>
                    <span className="strong small">{item.name}</span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {item.sku} · {item.onHand - item.reserved} free of {item.onHand} on hand ·
                      reorder at {item.reorderPoint}
                    </span>
                  </div>
                  {keepsStock && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        addLine(item.id)
                        setRaising(true)
                      }}
                    >
                      Add to an order
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* --------------------------------------------- ORDER LIST */}
      <Card>
        <CardHeader title="Purchase orders" />
        <CardBody>
          <FormError error={approveOrder.error} />
          <QueryState
            isLoading={ordersQuery.isLoading}
            error={ordersQuery.error as Error | null}
            isEmpty={orders.length === 0}
            emptyIcon="📦"
            emptyTitle="No purchase orders yet"
            emptyMessage="Raise one when stock runs low or a signed project is waiting for materials."
          >
            <div className="stack stack--sm">
              {orders.map((order) => {
                const overLimit = order.totalAmount > approvalLimit
                const cancellable =
                  order.status === 'draft' ||
                  order.status === 'pending_approval' ||
                  order.status === 'approved' ||
                  order.status === 'ordered'
                return (
                  <div
                    key={order.id}
                    style={{
                      padding: 'var(--space-4)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      opacity: order.status === 'cancelled' ? 0.6 : 1,
                    }}
                  >
                    <div className="row row--between row--wrap" style={{ gap: 'var(--space-3)' }}>
                      <div>
                        <div className="row" style={{ gap: 'var(--space-2)' }}>
                          <code>{order.poNumber}</code>
                          <Badge tone={STATUS_TONE[order.status]}>
                            {STATUS_LABEL[order.status]}
                          </Badge>
                          {order.matchedAt && <Badge tone="success">3-way matched</Badge>}
                        </div>
                        <div className="xs dim" style={{ marginTop: 2 }}>
                          {order.supplierName} · {currency(order.totalAmount)} ·{' '}
                          {order.lines.length} line{order.lines.length === 1 ? '' : 's'}
                          {order.expectedAt ? ` · expected ${date(order.expectedAt)}` : ''}
                          {order.receivedAt ? ` · received ${date(order.receivedAt)}` : ''}
                        </div>
                      </div>

                      <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                        {order.status === 'draft' && overLimit && !isAdmin && (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={approveOrder.isPending}
                            onClick={() =>
                              approveOrder.mutate({ id: order.id, status: 'pending_approval' })
                            }
                            title={`Above the ${currency(approvalLimit)} limit — an administrator approves it`}
                          >
                            Send to an administrator
                          </Button>
                        )}
                        {((order.status === 'draft' && (!overLimit || isAdmin)) ||
                          (order.status === 'pending_approval' && isAdmin)) && (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={approveOrder.isPending}
                            onClick={() =>
                              approveOrder.mutate({ id: order.id, status: 'approved' })
                            }
                          >
                            Approve
                          </Button>
                        )}
                        {order.status === 'pending_approval' && !isAdmin && (
                          <span className="xs dim">Waiting for an administrator</span>
                        )}
                        {order.status === 'approved' && (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={approveOrder.isPending}
                            onClick={() => approveOrder.mutate({ id: order.id, status: 'ordered' })}
                            title="The supplier has confirmed the order"
                          >
                            Mark as ordered
                          </Button>
                        )}
                        {order.status === 'ordered' && keepsStock && (
                          <Button variant="primary" size="sm" onClick={() => setReceiving(order)}>
                            Receive delivery
                          </Button>
                        )}
                        {order.status === 'received' && !order.matchedAt && (
                          <Button variant="outline" size="sm" onClick={() => setReceiving(order)}>
                            Match invoice
                          </Button>
                        )}
                        {cancellable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={approveOrder.isPending}
                            onClick={() => cancelOrder(order)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>

                    {order.lines.length > 0 && (
                      <div className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
                        {order.lines
                          .map(
                            (l) =>
                              `${l.quantity}× ${l.itemName}${
                                l.quantityReceived > 0 ? ` (${l.quantityReceived} received)` : ''
                              }`,
                          )
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </QueryState>
        </CardBody>
      </Card>

      {/* ------------------------------------------------- SUPPLIERS */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader
          title="Suppliers"
          action={
            keepsStock ? (
              <Button variant="outline" size="sm" onClick={() => setEditingSupplier('new')}>
                + Add a supplier
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {suppliers.length === 0 ? (
            <p className="small muted">
              No suppliers yet. Add the distributors you buy from before raising an order.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th className="table__num">Lead time</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id} style={{ opacity: s.isActive ? 1 : 0.6 }}>
                      <td>
                        <div className="strong small">{s.name}</div>
                        {s.address && <div className="xs dim">{s.address}</div>}
                      </td>
                      <td className="small">
                        {s.contactPerson ?? '—'}
                        <div className="xs dim">
                          {[s.phone, s.email].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="table__num small">{s.leadTimeDays} days</td>
                      <td>
                        <Badge tone={s.isActive ? 'success' : 'neutral'}>
                          {s.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>
                        {keepsStock && (
                          <Button variant="ghost" size="sm" onClick={() => setEditingSupplier(s)}>
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* --------------------------------------- RAISE AN ORDER */}
      <Modal open={raising} onClose={() => setRaising(false)} title="Raise a purchase order">
        <form className="stack" onSubmit={handleRaise}>
          <div className="field">
            <label className="field__label" htmlFor="po-supplier">
              Supplier
            </label>
            <select id="po-supplier" name="supplier" className="select" required defaultValue="">
              <option value="" disabled>
                Select a supplier…
              </option>
              {activeSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.leadTimeDays}-day lead time)
                </option>
              ))}
            </select>
            {activeSuppliers.length === 0 && (
              <span className="field__hint">Add a supplier at the bottom of this page first.</span>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="po-add-item">
              Add an item
            </label>
            <select
              id="po-add-item"
              className="select"
              value=""
              onChange={(e) => addLine(e.target.value)}
            >
              <option value="" disabled>
                Choose from the catalogue…
              </option>
              {stock.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.sku}) — {item.onHand - item.reserved} free
                </option>
              ))}
            </select>
            {stock.length === 0 && (
              <span className="field__hint">
                The catalogue is empty — add items under{' '}
                <Link to="/admin/inventory">Inventory</Link>.
              </span>
            )}
          </div>

          {lines.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="table__num">Qty</th>
                    <th className="table__num">Unit cost</th>
                    <th className="table__num">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const item = stock.find((s) => s.id === line.stockItemId)
                    return (
                      <tr key={line.stockItemId}>
                        <td className="small">{item?.name}</td>
                        <td className="table__num">
                          <input
                            className="input"
                            type="number"
                            min="1"
                            style={{ width: 80 }}
                            value={line.quantity}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.stockItemId === line.stockItemId
                                    ? { ...l, quantity: Math.max(1, Number(e.target.value) || 1) }
                                    : l,
                                ),
                              )
                            }
                            aria-label={`Quantity of ${item?.name ?? 'item'}`}
                          />
                        </td>
                        <td className="table__num">
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            style={{ width: 110 }}
                            value={line.unitCost}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.stockItemId === line.stockItemId
                                    ? { ...l, unitCost: Math.max(0, Number(e.target.value) || 0) }
                                    : l,
                                ),
                              )
                            }
                            aria-label={`Unit cost of ${item?.name ?? 'item'}`}
                          />
                        </td>
                        <td className="table__num small">
                          {currency(line.quantity * line.unitCost)}
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setLines((prev) =>
                                prev.filter((l) => l.stockItemId !== line.stockItemId),
                              )
                            }
                            aria-label={`Remove ${item?.name ?? 'item'}`}
                          >
                            ✕
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="row row--between">
            <span className="strong">Order total</span>
            <span className="num strong" style={{ fontSize: 'var(--text-xl)' }}>
              {currency(draftTotal)}
            </span>
          </div>

          {needsAdminApproval && !isAdmin && (
            <p
              className="small"
              style={{
                padding: 'var(--space-3)',
                background: 'var(--warning-bg)',
                color: 'var(--warning-fg)',
                borderRadius: 'var(--radius)',
              }}
            >
              This is above the {currency(approvalLimit)} requisition limit. Raise it, then press
              &ldquo;Send to an administrator&rdquo; on the order — they are notified and approve
              it.
            </p>
          )}

          <div className="field">
            <label className="field__label" htmlFor="po-expected">
              Expected delivery <span className="dim">(optional)</span>
            </label>
            <input id="po-expected" name="expected" className="input" type="date" />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="po-notes">
              Notes <span className="dim">(optional)</span>
            </label>
            <textarea id="po-notes" name="notes" className="textarea" rows={2} />
          </div>

          <FormError error={createOrder.error} />

          <Button
            type="submit"
            variant="primary"
            block
            disabled={createOrder.isPending || lines.length === 0}
          >
            {createOrder.isPending ? 'Raising…' : 'Raise purchase order'}
          </Button>
        </form>
      </Modal>

      {/* ------------------------------------------ RECEIVE / MATCH */}
      <Modal
        open={receiving !== null}
        onClose={() => setReceiving(null)}
        title={
          receiving?.status === 'received'
            ? `Match invoice · ${receiving.poNumber}`
            : `Receive delivery · ${receiving?.poNumber ?? ''}`
        }
      >
        {receiving && receiving.status !== 'received' && (
          <form className="stack" onSubmit={handleReceive}>
            <p className="small muted">
              Confirm what physically arrived. Recording this writes a stock receipt for every line,
              raises the warehouse balance and fills any project that was short of these items — so
              only do it once the goods are actually in.
            </p>

            <div
              style={{
                padding: 'var(--space-3)',
                background: 'var(--ink-50)',
                borderRadius: 'var(--radius)',
              }}
            >
              {receiving.lines.map((line) => (
                <div key={line.id} className="row row--between">
                  <span className="small">{line.itemName}</span>
                  <span className="small strong">{line.quantity}</span>
                </div>
              ))}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="po-ref">
                Supplier delivery reference
              </label>
              <input
                id="po-ref"
                name="reference"
                className="input"
                placeholder="Delivery receipt or waybill number"
              />
              <span className="field__hint">
                Recorded on behalf of the supplier, so the receipt can be checked against their
                paperwork later.
              </span>
            </div>

            <FormError error={receiveOrder.error} />

            <Button type="submit" variant="primary" block disabled={receiveOrder.isPending}>
              {receiveOrder.isPending ? 'Receiving…' : 'Receive into stock'}
            </Button>
          </form>
        )}

        {receiving && receiving.status === 'received' && user && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              matchOrder.mutate(
                {
                  id: receiving.id,
                  supplierInvoiceRef: String(form.get('invoice') ?? ''),
                  userId: user.id,
                },
                { onSuccess: () => setReceiving(null) },
              )
            }}
          >
            <p className="small muted">
              The three-way match: this order, the delivery that arrived, and the supplier&apos;s
              invoice. Check that all three agree on quantity and price before recording it — this
              is a statement that you compared them, and nothing here can make that check for you.
            </p>

            <div className="field">
              <label className="field__label" htmlFor="po-invoice">
                Supplier invoice number
              </label>
              <input id="po-invoice" name="invoice" className="input" required />
            </div>

            <FormError error={matchOrder.error} />

            <Button type="submit" variant="primary" block disabled={matchOrder.isPending}>
              {matchOrder.isPending ? 'Recording…' : 'Record the match'}
            </Button>
          </form>
        )}
      </Modal>

      {/* --------------------------------------------- SUPPLIER FORM */}
      <Modal
        open={editingSupplier !== null}
        onClose={() => setEditingSupplier(null)}
        title={editingSupplier === 'new' ? 'Add a supplier' : 'Edit supplier'}
      >
        {editingSupplier !== null && (
          <form
            className="stack"
            onSubmit={handleSaveSupplier}
            key={editingSupplier === 'new' ? 'new' : editingSupplier.id}
          >
            {(() => {
              const s = editingSupplier === 'new' ? null : editingSupplier
              return (
                <>
                  <div className="field">
                    <label className="field__label" htmlFor="sup-name">
                      Name
                    </label>
                    <input
                      id="sup-name"
                      name="name"
                      className="input"
                      required
                      defaultValue={s?.name ?? ''}
                    />
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor="sup-contact">
                      Contact person <span className="dim">(optional)</span>
                    </label>
                    <input
                      id="sup-contact"
                      name="contact"
                      className="input"
                      defaultValue={s?.contactPerson ?? ''}
                    />
                  </div>
                  <div className="row" style={{ gap: 'var(--space-3)' }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label className="field__label" htmlFor="sup-phone">
                        Phone
                      </label>
                      <input
                        id="sup-phone"
                        name="phone"
                        className="input"
                        type="tel"
                        defaultValue={s?.phone ?? ''}
                      />
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label className="field__label" htmlFor="sup-email">
                        Email
                      </label>
                      <input
                        id="sup-email"
                        name="email"
                        className="input"
                        type="email"
                        defaultValue={s?.email ?? ''}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor="sup-address">
                      Address <span className="dim">(optional)</span>
                    </label>
                    <input
                      id="sup-address"
                      name="address"
                      className="input"
                      defaultValue={s?.address ?? ''}
                    />
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor="sup-lead">
                      Usual lead time (days)
                    </label>
                    <input
                      id="sup-lead"
                      name="leadTime"
                      className="input"
                      type="number"
                      min={0}
                      required
                      defaultValue={s?.leadTimeDays ?? 14}
                    />
                  </div>
                  <label className="row small" style={{ gap: 'var(--space-2)' }}>
                    <input type="checkbox" name="active" defaultChecked={s?.isActive ?? true} />
                    Active — new orders can be placed with them
                  </label>
                </>
              )
            })()}
            <FormError error={saveSupplier.error} />
            <Button type="submit" variant="primary" block disabled={saveSupplier.isPending}>
              {saveSupplier.isPending ? 'Saving…' : 'Save supplier'}
            </Button>
          </form>
        )}
      </Modal>
    </>
  )
}
