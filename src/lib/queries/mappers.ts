/* ============================================================================
   ROW → DOMAIN MAPPERS
   ----------------------------------------------------------------------------
   Postgres speaks snake_case and nullable columns. The UI speaks camelCase and
   the types in src/types/domain.ts. This file is the one place those two
   vocabularies meet.

   WHY A MAPPING LAYER RATHER THAN RENAMING EVERYTHING
   Three reasons it earns its keep:

     1. Every screen was built against `domain.ts` before the database existed.
        Mapping here means the components do not change at all as they move off
        the mocks — which makes each migration a one-line import swap that is
        easy to review and easy to revert.

     2. The database is nullable in places the UI is not. `completed_by` is null
        until a technician signs a milestone off; a component should not have to
        care. Defaults are applied once, here.

     3. It is a seam. If a column is renamed or split, one file changes instead
        of fifty components.

   The mocks in src/mocks/ already match these shapes exactly, which is what
   lets demo mode and live mode render through identical code.
   ========================================================================== */

import type {
  AppNotification,
  Appointment,
  Invoice,
  Milestone,
  Project,
  SerializedAsset,
  StoredDocument,
  Ticket,
} from '@/types/domain'
import type { Database } from '@/types/database'

type Tables = Database['public']['Tables']
type ProjectRow = Tables['projects']['Row']
type MilestoneRow = Tables['project_milestones']['Row']
type InvoiceRow = Tables['invoices']['Row']
type AppointmentRow = Tables['appointments']['Row']
type TicketRow = Tables['tickets']['Row']
type DocumentRow = Tables['documents']['Row']
type AssetRow = Tables['serialised_assets']['Row']
type NotificationRow = Tables['notifications']['Row']

/** Numeric columns arrive as strings from some drivers; normalise once. */
function num(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? n : fallback
}

/** A date column is `YYYY-MM-DD`; the UI formatters expect a full ISO string. */
function iso(value: string | null | undefined): string {
  if (!value) return ''
  return value.includes('T') ? value : `${value}T00:00:00Z`
}

export function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    status: row.status,
    completedAt: row.completed_at ?? undefined,
    // The row stores a user id; the display name is resolved by the caller when
    // it has the profile join. Falls back to the id rather than showing blank.
    completedBy: row.completed_by ?? undefined,
    note: row.note ?? undefined,
  }
}

export function toProject(row: ProjectRow, milestones: MilestoneRow[] = []): Project {
  return {
    id: row.id,
    reference: row.reference,
    clientId: row.client_id ?? '',
    // Resolved from the profile join where available; the caller overrides it.
    clientName: '',
    address: row.address,
    systemKw: num(row.system_kw),
    systemType: row.system_type,
    contractValue: num(row.contract_value),
    amountPaid: num(row.amount_paid),
    /* A cancelled project used to be shown as "On hold" — to the customer
       too — which promised a resumption nobody intended. */
    status: row.status,
    milestones: [...milestones].sort((a, b) => a.sequence - b.sequence).map(toMilestone),
    /* NEVER fall back to the raw column here. `assigned_engineer` is a uuid,
       so a caller that forgot to join profiles used to render
       "11111111-0000-4000-8000-000000000003" straight onto the customer's
       dashboard. A missing name should read as missing, not as a database id.
       Callers that join set this afterwards. */
    assignedEngineer: 'To be assigned',
    startDate: iso(row.start_date),
    targetTurnover: iso(row.target_turnover),
    assignedEngineerId: row.assigned_engineer,
    actualTurnover: row.actual_turnover,
  }
}

/** Today as YYYY-MM-DD in the browser's timezone, to compare with date columns. */
function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function toInvoice(row: InvoiceRow, clientName = ''): Invoice {
  /* An invoice past its due date is overdue the moment the date passes, not
     the next time somebody records a payment against it — which is when the
     database used to notice. The daily housekeeping job (0073) now writes it
     back too; this keeps the screen right in the hours in between. */
  const pastDue =
    row.status === 'sent' &&
    row.due_at !== null &&
    row.due_at < todayIso() &&
    num(row.amount_paid) < num(row.amount)

  return {
    id: row.id,
    number: row.invoice_number,
    projectId: row.project_id,
    clientName,
    clientId: row.client_id ?? undefined,
    stage: row.stage,
    amount: num(row.amount),
    amountPaid: num(row.amount_paid),
    // `void` exists in the database but not in the UI's status union, because
    // no screen renders it differently from a draft.
    status: row.status === 'void' ? 'draft' : pastDue ? 'overdue' : row.status,
    notes: row.notes ?? undefined,
    issuedAt: iso(row.issued_at),
    dueAt: iso(row.due_at),
  }
}

export function toAppointment(row: AppointmentRow, assignedTo: string[] = []): Appointment {
  return {
    id: row.id,
    type: row.appointment_type,
    /* Passed through. 'in_progress' used to be shown as "dispatched", so the
       office and the customer could not tell a crew on site from one that
       had not set off. */
    status: row.status,
    date: row.scheduled_date,
    timeSlot: row.time_slot,
    clientName: row.contact_name,
    contactPhone: row.contact_phone ?? undefined,
    address: row.address ?? '',
    assignedTo,
    notes: row.notes ?? undefined,
    projectId: row.project_id ?? undefined,
    clientId: row.client_id ?? undefined,
    leadId: row.lead_id ?? undefined,
    ticketId: row.ticket_id ?? undefined,
    cancelledReason: row.cancelled_reason ?? undefined,
    completedAt: row.completed_at ?? undefined,
    signoffName: row.client_signoff_name ?? undefined,
    createdAt: row.created_at,
  }
}

export function toTicket(row: TicketRow, clientName = ''): Ticket {
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    description: row.description ?? '',
    clientName,
    clientId: row.client_id ?? undefined,
    projectId: row.project_id ?? '',
    priority: row.priority,
    status: row.status,
    // 'upgrade' is a database category with no distinct UI treatment.
    category: row.category === 'upgrade' ? 'other' : row.category,
    createdAt: row.created_at,
    lastUpdate: row.updated_at,
    assignedTo: row.assigned_to ?? undefined,
    assignedToId: row.assigned_to ?? undefined,
    resolution: row.resolution ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    warrantyCovered: row.warranty_covered,
    satisfactionRating: row.satisfaction_rating,
  }
}

export function toDocument(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    name: row.name,
    /* Passed through as stored. A customer's own upload ('other') used to be
       relabelled "Quotation" in their vault, and a proof of sale an
       "Inspection report" — the mapper was squeezing the database's kinds
       into the UI's shorter list instead of the list growing to fit them. */
    kind: row.kind,
    projectId: row.project_id ?? '',
    sizeKb: row.size_kb ?? 0,
    uploadedAt: row.uploaded_at,
    storagePath: row.storage_path ?? undefined,
  }
}

export function toAsset(row: AssetRow): SerializedAsset {
  return {
    id: row.id,
    serialNumber: row.serial_number,
    stockItemId: row.stock_item_id ?? '',
    productName: row.product_name,
    projectId: row.project_id ?? '',
    installedAt: iso(row.installed_at),
    warrantyYears: row.warranty_years,
    warrantyExpiresAt: iso(row.warranty_expires_at),
    status: row.status,
  }
}

export function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    channel: row.channel,
    read: row.read,
    at: row.created_at,
    category: row.category,
    entity: row.entity ?? undefined,
    entityId: row.entity_id ?? undefined,
  }
}
