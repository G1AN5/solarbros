/* ============================================================================
   DOMAIN TYPES
   ----------------------------------------------------------------------------
   The vocabulary of the whole application. Every screen speaks in these terms.

   These are hand-written for the UI phase. Once the Supabase schema exists,
   `supabase gen types typescript` will produce `src/types/database.ts`, and
   these types become thin aliases over the generated row types — so the UI
   never has to change shape.

   NOTE: we use string-union types (not TS `enum`) because the project's
   tsconfig sets `erasableSyntaxOnly`, and because unions map 1:1 onto
   Postgres CHECK constraints / enum types in Supabase.
   ========================================================================== */

/* --- Identity & access ------------------------------------------------------ */

/** The seven roles from the spec's RBAC section. Drives every route guard. */
export type UserRole =
  | 'client'
  | 'sales'
  | 'project_engineer'
  | 'inventory_manager'
  | 'accountant'
  | 'technician'
  | 'admin'

/** Roles allowed into the internal Operations Hub at /admin. */
export const STAFF_ROLES: UserRole[] = [
  'sales',
  'project_engineer',
  'inventory_manager',
  'accountant',
  'admin',
]

export interface User {
  id: string
  fullName: string
  email: string
  role: UserRole
  avatarInitials: string
}

/* --- CRM: leads & pipeline --------------------------------------------------- */

/** Sales pipeline stages. Order here IS the column order on the Kanban board. */
export type LeadStage = 'new' | 'quoted' | 'site_visit' | 'contract' | 'installed' | 'lost'

export interface Lead {
  id: string
  name: string
  email: string
  phone: string
  location: string
  /** Monthly electricity bill in PHP — the primary sizing input. */
  monthlyBill: number
  estimatedKw: number
  stage: LeadStage
  /** 0-100 heuristic used for the "lead scoring" view in the CRM. */
  score: number
  source: 'estimator' | 'quote_request' | 'referral' | 'walk_in' | 'facebook'
  assignedTo: string
  createdAt: string
}

/* --- Projects & installation milestones --------------------------------------- */

/**
 * The canonical installation lifecycle. The client Project Tracker, the admin
 * Project board and the technician Milestone Updater all render THIS list —
 * one source of truth means the customer's progress bar can never disagree
 * with what the technician ticked off in the field.
 */
export type MilestoneKey =
  | 'engineering_survey'
  | 'permitting'
  | 'structural_mounting'
  | 'dc_wiring'
  | 'ac_wiring'
  | 'commissioning'
  | 'turnover'

export type MilestoneStatus = 'pending' | 'in_progress' | 'done' | 'blocked'

export interface Milestone {
  /** Row id. Required to target an update; the key alone is not unique
   *  across projects. */
  id?: string
  key: MilestoneKey
  label: string
  status: MilestoneStatus
  completedAt?: string
  /** Which technician signed this milestone off in the field portal. */
  completedBy?: string
  note?: string
}

export type ProjectStatus = 'planning' | 'in_progress' | 'on_hold' | 'completed'

export interface Project {
  id: string
  reference: string
  clientId: string
  clientName: string
  address: string
  systemKw: number
  systemType: SystemType
  contractValue: number
  amountPaid: number
  status: ProjectStatus
  milestones: Milestone[]
  assignedEngineer: string
  startDate: string
  targetTurnover: string
}

/* --- Packages & solar system configuration -------------------------------------- */

/** The three system architectures compared on the public packages page. */
export type SystemType = 'on_grid' | 'hybrid' | 'off_grid'

export interface Package {
  id: string
  name: string
  systemType: SystemType
  sizeKw: number
  priceFrom: number
  segment: 'residential' | 'commercial'
  featured: boolean
  inclusions: string[]
  idealFor: string
}

/* --- Scheduling & dispatch --------------------------------------------------------
   ONE appointment type serves four different UIs (public booking, client portal
   scheduling, admin dispatch board, technician daily schedule). Consolidating
   these was a deliberate de-duplication of the source spec, which listed a
   "calendar scheduling system" separately under all four portals.            */

export type AppointmentType =
  'virtual_consultation' | 'site_survey' | 'installation' | 'maintenance' | 'repair'

export type AppointmentStatus = 'requested' | 'confirmed' | 'dispatched' | 'completed' | 'cancelled'

export interface Appointment {
  id: string
  type: AppointmentType
  status: AppointmentStatus
  date: string
  timeSlot: string
  clientName: string
  /** Direct line for the technician's one-tap dialler. */
  contactPhone?: string
  address: string
  /** Empty until a dispatcher assigns staff on the admin board. */
  assignedTo: string[]
  notes?: string
  /* The job a visit belongs to. Dropped by the mapper until now, which left the
     field portal's logging screens with no way to say WHICH project a serial
     number or a bag of cable belonged to. */
  projectId?: string
  clientId?: string
}

/* --- Inventory & serialized assets --------------------------------------------- */

export type StockCategory =
  'panel' | 'inverter' | 'battery' | 'racking' | 'charge_controller' | 'accessory'

export interface StockItem {
  id: string
  sku: string
  name: string
  category: StockCategory
  brand: string
  onHand: number
  /** Reserved automatically when a contract is signed (BOM reservation logic). */
  reserved: number
  reorderPoint: number
  unitCost: number
  /** 'pc', 'm', 'set' — what one of these is counted in. */
  unit: string
  /** Panels, inverters and batteries carry serials; rails and connectors do not. */
  isSerialised: boolean
}

/** A physical, serial-numbered unit installed at a client site. */
export interface SerializedAsset {
  id: string
  serialNumber: string
  stockItemId: string
  productName: string
  projectId: string
  installedAt: string
  warrantyYears: number
  warrantyExpiresAt: string
}

/* --- Finance ------------------------------------------------------------------- */

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue'

/** Staged payment milestones from the spec: down payment → delivery → commissioning. */
export type PaymentStage = 'down_payment' | 'delivery' | 'commissioning' | 'retention'

export interface Invoice {
  id: string
  number: string
  projectId: string
  clientName: string
  /** Who to address a reminder or a receipt to. A name is not an address. */
  clientId?: string
  stage: PaymentStage
  amount: number
  amountPaid: number
  status: InvoiceStatus
  issuedAt: string
  dueAt: string
}

/** One line of a Bill of Materials, generated from the chosen package. */
export interface BomLine {
  stockItemId: string
  description: string
  quantity: number
  unitPrice: number
}

/* --- Support ticketing & warranty ------------------------------------------------ */

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketStatus = 'open' | 'in_progress' | 'awaiting_client' | 'resolved' | 'closed'

/** Named rather than inlined on Ticket, so mutations can accept it as an argument. */
export type TicketCategory = 'hardware_fault' | 'performance' | 'billing' | 'maintenance' | 'other'

export interface Ticket {
  id: string
  reference: string
  subject: string
  /* What the customer actually wrote. Dropped by the mapper until now, which
     meant the support queue showed a one-line subject and the person triaging
     it could not read the problem. */
  description: string
  clientName: string
  /** Needed to raise a service visit against the right customer. */
  clientId?: string
  projectId: string
  priority: TicketPriority
  status: TicketStatus
  category: TicketCategory
  createdAt: string
  lastUpdate: string
  /** Display name of the assignee. */
  assignedTo?: string
  /** The assignee's id — what a form needs to preselect them. */
  assignedToId?: string
  /** What was done. The customer reads this. */
  resolution?: string
  /** When it was closed out — what an average resolution time is measured on. */
  resolvedAt?: string
}

export type WarrantyRequestType = 'registration' | 'transfer'
export type WarrantyRequestStatus = 'pending' | 'approved' | 'rejected'

export interface WarrantyRequest {
  id: string
  type: WarrantyRequestType
  status: WarrantyRequestStatus
  clientName: string
  projectId: string
  /** Only populated for transfer requests (e.g. the client sold the house). */
  transferTo?: string
  submittedAt: string
}

/* --- Documents ------------------------------------------------------------------- */

export type DocumentKind =
  | 'quotation'
  | 'contract'
  | 'invoice'
  | 'receipt'
  | 'warranty_certificate'
  | 'turnover_certificate'
  | 'inspection_report'
  | 'permit'

export interface StoredDocument {
  id: string
  name: string
  kind: DocumentKind
  projectId: string
  sizeKb: number
  uploadedAt: string
  /* Where the file actually is. Dropped by the mapper until now, which is why
     the customer's Download button could only ever be a placeholder — there was
     nothing to mint a signed URL for. */
  storagePath?: string
}

/* --- Governance ------------------------------------------------------------------ */

/** Immutable audit trail entry — written for every privileged action. */
export interface AuditEntry {
  id: string
  actor: string
  actorRole: UserRole
  action: string
  entity: string
  entityId: string
  at: string
  severity: 'info' | 'warning' | 'critical'
}

/* --- Notifications ---------------------------------------------------------------- */

export interface AppNotification {
  id: string
  title: string
  body: string
  channel: 'in_app' | 'email' | 'sms'
  read: boolean
  at: string
}
