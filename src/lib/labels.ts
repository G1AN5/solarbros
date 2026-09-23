/* ============================================================================
   LABELS & STATUS TONES
   ----------------------------------------------------------------------------
   Single source of truth for how every domain enum is *displayed*:
     - its human-readable label
     - which <Badge> colour ("tone") represents it

   Why centralise this: "in_progress" must look the same amber everywhere it
   appears — client portal, admin table, technician job card. Without this file
   those three screens inevitably drift apart.
   ========================================================================== */

import type {
  AppointmentStatus,
  AppointmentType,
  InvoiceStatus,
  LeadStage,
  MilestoneKey,
  MilestoneStatus,
  PaymentStage,
  ProjectStatus,
  StockCategory,
  SystemType,
  TicketPriority,
  TicketStatus,
  UserRole,
  WarrantyRequestStatus,
} from '@/types/domain'

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'

/* --- Roles ------------------------------------------------------------------- */

export const ROLE_LABEL: Record<UserRole, string> = {
  client: 'Client',
  sales: 'Sales Representative',
  project_engineer: 'Project Engineer',
  inventory_manager: 'Inventory Manager',
  accountant: 'Accountant',
  technician: 'Field Technician',
  admin: 'Administrator',
}

/* --- CRM pipeline -------------------------------------------------------------
   PIPELINE_ORDER also defines the left-to-right column order of the Kanban
   board, so adding a stage in one place updates the board automatically.   */

export const PIPELINE_ORDER: LeadStage[] = ['new', 'quoted', 'site_visit', 'contract', 'installed']

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New',
  quoted: 'Quoted',
  site_visit: 'Site Visit',
  contract: 'Contract',
  installed: 'Installed',
  lost: 'Lost',
}

export const LEAD_STAGE_TONE: Record<LeadStage, Tone> = {
  new: 'info',
  quoted: 'brand',
  site_visit: 'warning',
  contract: 'success',
  installed: 'success',
  lost: 'neutral',
}

/* --- Installation milestones ---------------------------------------------------
   MILESTONE_ORDER is the canonical stage sequence. The client progress bar is
   literally `doneCount / MILESTONE_ORDER.length`.                            */

export const MILESTONE_ORDER: MilestoneKey[] = [
  'engineering_survey',
  'permitting',
  'structural_mounting',
  'dc_wiring',
  'ac_wiring',
  'commissioning',
  'turnover',
]

export const MILESTONE_LABEL: Record<MilestoneKey, string> = {
  engineering_survey: 'Engineering Survey',
  permitting: 'Permitting & Approvals',
  structural_mounting: 'Structural Mounting',
  dc_wiring: 'DC Wiring',
  ac_wiring: 'AC Wiring & Interconnection',
  commissioning: 'Testing & Commissioning',
  turnover: 'Final Turnover',
}

export const MILESTONE_STATUS_TONE: Record<MilestoneStatus, Tone> = {
  pending: 'neutral',
  in_progress: 'warning',
  done: 'success',
  blocked: 'danger',
}

/* --- Projects ------------------------------------------------------------------ */

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
}

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  planning: 'info',
  in_progress: 'warning',
  on_hold: 'danger',
  completed: 'success',
}

/* --- System types --------------------------------------------------------------- */

export const SYSTEM_TYPE_LABEL: Record<SystemType, string> = {
  on_grid: 'On-Grid (Grid-Tied)',
  hybrid: 'Hybrid',
  off_grid: 'Off-Grid',
}

/* --- Appointments ---------------------------------------------------------------- */

export const APPOINTMENT_TYPE_LABEL: Record<AppointmentType, string> = {
  virtual_consultation: 'Virtual Consultation',
  site_survey: 'On-Site Survey',
  installation: 'Installation',
  maintenance: 'Preventive Maintenance',
  repair: 'Emergency Repair',
}

export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, Tone> = {
  requested: 'info',
  confirmed: 'brand',
  dispatched: 'warning',
  completed: 'success',
  cancelled: 'neutral',
}

/* --- Inventory --------------------------------------------------------------------- */

export const STOCK_CATEGORY_LABEL: Record<StockCategory, string> = {
  panel: 'Solar Panel',
  inverter: 'Inverter',
  battery: 'Battery',
  racking: 'Racking / Mounting',
  charge_controller: 'Charge Controller',
  accessory: 'Accessory',
}

/* --- Sales -------------------------------------------------------------------------- */

export const QUOTATION_STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  sent: 'info',
  accepted: 'success',
  rejected: 'danger',
  expired: 'neutral',
}

export const CONTRACT_STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  awaiting_client: 'warning',
  awaiting_company: 'info',
  executed: 'success',
  cancelled: 'danger',
}

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  awaiting_client: 'Awaiting customer signature',
  awaiting_company: 'Awaiting our counter-signature',
  executed: 'Executed',
  cancelled: 'Cancelled',
}

/* --- Finance ------------------------------------------------------------------------ */

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, Tone> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  overdue: 'danger',
}

export const PAYMENT_STAGE_LABEL: Record<PaymentStage, string> = {
  down_payment: 'Down Payment',
  delivery: 'Delivery Milestone',
  commissioning: 'Commissioning',
  retention: 'Retention Release',
}

/* --- Tickets -------------------------------------------------------------------------- */

export const TICKET_PRIORITY_TONE: Record<TicketPriority, Tone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
}

export const TICKET_STATUS_TONE: Record<TicketStatus, Tone> = {
  open: 'info',
  in_progress: 'warning',
  awaiting_client: 'brand',
  resolved: 'success',
  closed: 'neutral',
}

/* --- Warranty ---------------------------------------------------------------------------- */

export const WARRANTY_STATUS_TONE: Record<WarrantyRequestStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
}
