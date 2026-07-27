/* ===== Shared domain types (mirrors validated prototype v9 data model) ===== */

export type Role = 'director' | 'bd' | 'sales' | 'pm' | 'member' | 'viewer' | 'finance';

/* ===== Post-sales workflow (v2.2 Version 1A) ===== */
/* Production track: how far the production work has got (KPIs read this). */
export type ProductionStatus = 'in_progress' | 'completion_review' | 'production_completed';
/* Commercial track: invoicing / payment (board Payment Risk reads this). */
export type CommercialStatus =
  | 'not_ready' | 'pending_invoice' | 'invoiced' | 'payment_pending' | 'payment_received' | 'overdue';

export type HandoverStatus = 'not_started' | 'submitted' | 'accepted';
export interface Handover {
  status: HandoverStatus;
  salesBrief: string; // scope / commercials brief written by Sales
  assignedPmId: string; // PM (name) the project is handed to
  submittedBy: string;
  submittedAt: number;
  briefingAt: number; // when PM accepted/was briefed
}

export type CompletionStatus = 'not_started' | 'submitted' | 'approved' | 'rejected' | 'changes_requested';
export interface CompletionReview {
  status: CompletionStatus;
  summary: string; // what was delivered (the "completion package")
  links: string; // final deliverable links / paths
  submittedBy: string;
  submittedAt: number;
  approval: { pdId: string; status: 'pending' | 'approved' | 'rejected' | 'changes_requested'; note: string; decidedAt: number };
}

export type VariationStatus = 'none' | 'pending' | 'reapproval' | 'resolved';
export interface SalesVerification {
  status: 'not_started' | 'verified' | 'variation';
  scopeMatches: boolean;
  jobOrderUpdated: boolean;
  variationStatus: VariationStatus;
  finalInvoiceAllowed: boolean;
  by: string;
  at: number;
}

export type InvoiceStatus = 'pending_finance' | 'issued' | 'cancelled';
export type PaymentStatus = 'pending' | 'partial' | 'received' | 'overdue';
export interface InvoiceClose {
  invoiceRef: string;
  issuedDate: string; // ISO
  dueDate: string; // ISO — Payment Due Date
  invoiceStatus: InvoiceStatus;
  paymentStatus: PaymentStatus;
  financeNote: string;
}

export type RiskLevel = 'none' | 'watch' | 'high';
export interface PaymentRisk {
  depositRequired: boolean;
  depositStatus: 'none' | 'pending' | 'received';
  level: RiskLevel;
  resolvedAt: number;
}

export interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
  email: string;
  position: string; // job title, e.g. "Senior PM" / "3D Artist"
  mustChangePassword?: boolean; // forced password change on next login
  disabled?: boolean; // account deactivated (e.g. departure) — cannot sign in
  avatar?: string; // dataURL of an uploaded profile photo (else initials fallback)
  pointCap?: number; // workload ceiling in points; overload shows a red warning
}

export type ScheduleStatus = 'todo' | 'wip' | 'done' | 'block';
export type ChecklistStatus =
  | 'pending'
  | 'received'
  | 'confirmed'
  | 'na'
  | 'revision'
  | 'rejected';

export interface ScheduleRow {
  id?: string; // stable key so reorder/delete don't remount the wrong DOM row
  no: string;
  phase: string;
  task: string;
  taskEn: string;
  owner: string; // role label, e.g. "Audax / Client"
  assignee: string; // individual person name
  weeks: number;
  typical: string;
  gate: string;
  freeze: boolean;
  status: ScheduleStatus;
  note: string;
  s: string; // ISO start override
  e: string; // ISO end override
  delayNote?: string; // reason for a delay/date adjustment (shows a red mark)
}

export interface ChecklistItem {
  id?: string; // stable key (survives add/remove/reorder without remounting)
  zh: string;
  en: string;
  status: ChecklistStatus;
  date: string;
  remark: string;
  shot?: string; // legacy single dataURL thumbnail (migrated into shots)
  shots?: string[]; // multiple dataURL thumbnails per item
  owner?: string; // responsible person (name), shown with an avatar
  highlight?: boolean; // mark this item's remark as important (bright colour)
  updatedAt?: number; // last time this item changed (for "last update" column)
}

export interface ChecklistGroup {
  group: string;
  groupEn: string;
  color: string;
  items: ChecklistItem[];
}

/* R5-3: a scope / quotation line for a service package (from the sales job record) */
export interface ScopeItem {
  item: string; // e.g. "Hero Shot", "Indoor Facility Views"
  qty: string; // e.g. "4" (free text so "1 No." etc. is allowed)
  note: string; // special notes: resolution, inclusions, etc.
}

export interface ServicePackage {
  svc: string;
  start: string;
  delivery: string;
  buffer: number;
  owner: string;
  status: string;
  schedule: ScheduleRow[];
  checklist: ChecklistGroup[];
  resourceLinks?: string; // free text: web links / network paths to renders, VR, drone, models
  scopeItems?: ScopeItem[]; // R5-3: deliverables breakdown (item / qty / notes)
}

export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'needinfo';

export interface DirectorUpdate {
  done: string;
  nextNodes: string;
  risks: string;
  needDirector: string;
  clientPending: string;
  budget: string;
  by: string;
  at: number;
  dDecision: string;
  dStatus: DecisionStatus;
  dDate: string;
  dBy: string;
}

export interface LogEntry {
  at: number;
  by: string;
  text: string;
}

export interface Parties {
  mainContractor: string;
  architect: string;
  landscape: string;
  interior: string;
  creative: string;
}

/* R5-2: optional contact details for a company on the project (client, main
   contractor, etc.). All fields optional — captured on create or later. */
export interface ProjectContact {
  role: string; // 客户 Client / 总包 Main Con / 建筑师 Architect / ...
  company: string;
  person: string; // contact person name
  phone: string;
  email: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard' | 'complex';

export interface Project {
  id: string;
  name: string;
  client: string;
  services: string[];
  stage: string;
  difficulty: Difficulty;
  points: number;
  owners: string[]; // PM names
  perm: string[]; // extra names with production edit permission
  start: string;
  delivery: string;
  buffer: number;
  created: number;
  invoiced?: boolean;
  archived?: boolean; // hidden from working views, kept for records/stats
  dismissedRisks?: string[]; // risk keys the team has marked handled/ignored
  updatedAt?: number; // server-injected on read; used for conflict detection
  update: DirectorUpdate;
  parties: Parties;
  contacts?: ProjectContact[]; // R5-2/R5-4: company contact directory for this project
  log: LogEntry[];
  packages: ServicePackage[];
  /* ===== v2.2 Version 1A post-sales workflow ===== */
  version?: number; // server-injected optimistic-lock counter (CAS)
  workflowVersion?: number; // schema version of the workflow blocks below (1)
  handover?: Handover;
  completionReview?: CompletionReview;
  salesVerification?: SalesVerification;
  invoiceClose?: InvoiceClose;
  paymentRisk?: PaymentRisk;
  productionStatus?: ProductionStatus; // derived server-side
  commercialStatus?: CommercialStatus; // derived server-side
}

export type Stage = 'presales' | 'handover' | 'progress' | 'complete' | 'invoice';
