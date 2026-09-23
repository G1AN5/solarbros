import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { StatTile } from '@/components/ui/StatTile'
import { useAuth } from '@/app/auth/useAuth'
import { currency, currencyCompact, date, humanize } from '@/lib/format'
import { useStock } from '@/lib/queries/inventory-finance'
import {
  type PoStatus,
  type PurchaseOrder,
  useApprovePurchaseOrder,
  useCreatePurchaseOrder,
  useMatchPurchaseOrder,
  usePurchaseOrders,
  useReceivePurchaseOrder,
  useSuppliers,
} from '@/lib/queries/procurement'
import { settingNum, useSettings } from '@/lib/queries/settings'

/* ============================================================================
   PurchasingPage — raising orders and receiving deliveries.
   ----------------------------------------------------------------------------
   The procurement half of what has to happen between a signed contract and an
   installation. It sits opposite Permits: both run in parallel, and the crew
   cannot start until both are clear.

   THE SUPPLIER IS ALSO AN EXTERNAL PARTY
   Same problem as the permits screen. The supplier's despatch clerk has no
   login here, so somebody in the warehouse records the confirmation and the
   delivery on their behalf, against the supplier's own reference number.

   RECEIVING IS THE ONLY ACTION HERE THAT MOVES STOCK
   Marking a delivery received writes a `receipt` movement per line, and the
   ledger trigger raises `on_hand` from that. Nothing in this file adds to a
   balance directly — the warehouse total stays exactly the sum of its
   movements, so a stock figure can always be traced back to the delivery that
   produced it.

   The three-way match at the end is recorded, not computed. The point of
   matching a purchase order against a delivery receipt and a supplier invoice
   is that a person compared three documents; ticking it automatically would
   record that the comparison happened when it had not.
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
  const settings = useSettings().data

  const orders = ordersQuery.data ?? []
  const suppliers = suppliersQuery.data ?? []
  const stock = stockQuery.data ?? []
  const approvalLimit = settingNum(settings, 'inventory.requisition_approval_limit', 100000)

  const createOrder = useCreatePurchaseOrder()
  const approveOrder = useApprovePurchaseOrder()
  const receiveOrder = useReceivePurchaseOrder()
  const matchOrder = useMatchPurchaseOrder()

  const [raising, setRaising] = useState(false)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])

  /* Items already at or below their reorder point. The reason somebody opens
     this page, so it goes at the top rather than behind a filter. */
  const needsReordering = stock.filter((s) => s.onHand - s.reserved <= s.reorderPoint)

  const open = orders.filter((o) => o.status !== 'received' && o.status !== 'cancelled')
  const committed = open.reduce((sum, o) => sum + o.totalAmount, 0)
  const awaitingDelivery = orders.filter((o) => o.status === 'ordered')

  function addLine(stockItemId: string) {
    const item = stock.find((s) => s.id === stockItemId)
    if (!item || lines.some((l) => l.stockItemId === stockItemId)) return
    // Default the quantity to whatever brings it back to twice the reorder
    // point — a starting figure the buyer adjusts, not a decision.
    const suggested = Math.max(1, Math.ceil(item.reorderPoint * 2 - (item.onHand - item.reserved)))
    setLines((prev) => [...prev, { stockItemId, quantity: suggested, unitCost: item.unitCost }])
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

  return (
    <>
      <PageHeader
        title="Purchasing"
        description="Raise purchase orders, record supplier confirmations and receive deliveries into stock."
        breadcrumbs={[{ label: 'Supply Chain' }, { label: 'Purchasing' }]}
        actions={
          <Button variant="primary" onClick={() => setRaising(true)}>
            + Raise a purchase order
          </Button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Open orders" value={String(open.length)} />
        <StatTile label="Committed spend" value={currencyCompact(committed)} />
        <StatTile
          label="Awaiting delivery"
          value={String(awaitingDelivery.length)}
          delta={awaitingDelivery.length ? 'Chase the supplier' : 'Nothing outstanding'}
          direction={awaitingDelivery.length ? 'up' : 'flat'}
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
                <div key={item.id} className="row row--between">
                  <div>
                    <span className="strong small">{item.name}</span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {item.sku} · {item.onHand - item.reserved} free of {item.onHand} on hand ·
                      reorder at {item.reorderPoint}
                    </span>
                  </div>
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
          <QueryState
            isLoading={ordersQuery.isLoading}
            error={ordersQuery.error as Error | null}
            isEmpty={orders.length === 0}
            emptyIcon="📦"
            emptyTitle="No purchase orders yet"
            emptyMessage="Raise one when stock runs low or a contract commits materials you do not hold."
          >
            <div className="stack stack--sm">
              {orders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    padding: 'var(--space-4)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div className="row row--between">
                    <div>
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <code>{order.poNumber}</code>
                        <Badge tone={STATUS_TONE[order.status]}>{humanize(order.status)}</Badge>
                        {order.matchedAt && <Badge tone="success">3-way matched</Badge>}
                      </div>
                      <div className="xs dim" style={{ marginTop: 2 }}>
                        {order.supplierName} · {currency(order.totalAmount)} · {order.lines.length}{' '}
                        line{order.lines.length === 1 ? '' : 's'}
                        {order.expectedAt ? ` · expected ${date(order.expectedAt)}` : ''}
                        {order.receivedAt ? ` · received ${date(order.receivedAt)}` : ''}
                      </div>
                    </div>

                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      {(order.status === 'draft' || order.status === 'pending_approval') && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={approveOrder.isPending}
                          onClick={() => approveOrder.mutate({ id: order.id, status: 'approved' })}
                        >
                          Approve
                        </Button>
                      )}
                      {order.status === 'approved' && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={approveOrder.isPending}
                          onClick={() => approveOrder.mutate({ id: order.id, status: 'ordered' })}
                        >
                          Mark as ordered
                        </Button>
                      )}
                      {order.status === 'ordered' && (
                        <Button variant="primary" size="sm" onClick={() => setReceiving(order)}>
                          Receive delivery
                        </Button>
                      )}
                      {order.status === 'received' && !order.matchedAt && (
                        <Button variant="outline" size="sm" onClick={() => setReceiving(order)}>
                          Match invoice
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
              ))}
            </div>

            <FormError error={approveOrder.error} />
          </QueryState>
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
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.leadTimeDays}-day lead time)
                </option>
              ))}
            </select>
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
                                    ? { ...l, quantity: Number(e.target.value) }
                                    : l,
                                ),
                              )
                            }
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
                                    ? { ...l, unitCost: Number(e.target.value) }
                                    : l,
                                ),
                              )
                            }
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

          {needsAdminApproval && (
            <p
              className="small"
              style={{
                padding: 'var(--space-3)',
                background: 'var(--warning-bg)',
                color: 'var(--warning-fg)',
                borderRadius: 'var(--radius)',
              }}
            >
              This is above the {currency(approvalLimit)} requisition limit, so an administrator has
              to approve it. You can still raise it — the database refuses the approval, not the
              draft.
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
              Confirm what physically arrived. Recording this writes a stock receipt for every line
              and raises the warehouse balance — so only do it once the goods are actually in.
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
                Recorded on your behalf of the supplier, so the receipt can be checked against their
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
    </>
  )
}
