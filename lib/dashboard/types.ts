// ── FIC ──────────────────────────────────────────────────

export interface FicCredentials { accessToken: string; companyId: string; }

export interface FicInvoice {
  id: number; number: string; date: string | null;
  clientId: number | null; clientName: string;
  amountNet: number; amountVat: number; amountGross: number;
  amountPaid: number; amountDue: number;
  isPaid: boolean; isOverdue: boolean;
  type: string;
  subject: string | null;
  payments?: { amount: number; paidDate: string | null; status: string | null }[];
}

export interface FicQuote {
  id: number; number: string; date: string | null;
  clientId: number | null; clientName: string;
  subject: string | null;
  amountNet: number; amountGross: number;
  status: string;
}

export interface FicClient {
  id: number; name: string;
  totalRevenue: number; invoiceCount: number;
}

export interface FicData {
  // Year-to-date (current year)
  annualRevenue: number;
  annualRevenueNet: number;
  annualPaid: number;
  annualDue: number;
  // Current month
  monthlyRevenue: number;
  monthlyRevenueNet: number;
  // All invoices for filtering
  allInvoices: FicInvoice[];
  allClients: FicClient[];
  quotes: FicQuote[];
  error: string | null;
  fetchedAt: string;
}

// ── FLOAT ─────────────────────────────────────────────────

export interface FloatCredentials { apiKey: string; }

export interface FloatPerson {
  id: number; name: string; email: string | null;
  jobTitle: string | null; department: string | null;
  active: boolean; employeeType: number;
}

export interface FloatAccount {
  id: number;
  name: string;
  email: string | null;
  avatar: string | null;
  active: boolean;
}

export interface FloatProject {
  id: number; name: string; clientName: string | null;
  projectCode: string | null;
  active: boolean; tentative: boolean;
  budgetType: number | null; budgetTotal: number | null;
  budgetHours: number | null;
  startDate: string | null; endDate: string | null;
  projectManagerId: number | null;
  projectOwnerName: string | null;
  projectOwnerAvatar: string | null;
  hasAnnualConsultingPhase?: boolean;
}

export interface FloatAssignment {
  id: number; projectId: number; projectName: string;
  personId: number; personName: string;
  phaseId?: number | null;
  startDate: string; endDate: string;
  startTime: string | null;
  hoursPerDay: number; totalHours: number;
}

export interface ProjectHours {
  projectId: number; projectName: string; totalHours: number;
}

export interface ProjectPhaseHours {
  projectId: number;
  projectName: string;
  phaseId: number;
  totalHours: number;
}

export interface FloatCapacityRange {
  capacityHours: number;
  scheduledHours: number;
  projects: { name: string; hours: number }[];
}

export interface FloatPersonCapacity {
  personName: string;
  currentMonth: FloatCapacityRange;
  next30d: FloatCapacityRange;
}

export interface FloatCapacity {
  byPerson: FloatPersonCapacity[];
  totalCurrentMonthHours: number;
  total30dHours: number;
  error: string | null;
}

export interface FloatData {
  accounts: FloatAccount[];
  people: FloatPerson[];
  projects: FloatProject[];
  projectHours: ProjectHours[];
  projectHoursYtd: ProjectHours[];
  projectPhaseHours: ProjectPhaseHours[];
  recentProjectActivityIds: number[];
  assignments: FloatAssignment[];
  recentAssignments: FloatAssignment[];
  error: string | null;
  fetchedAt: string;
}

// ── COMMESSE ──────────────────────────────────────────────

export interface QuoteProjectMapping {
  floatProjectId: number; floatProjectName: string;
  ficClientId: number; ficClientName: string;
  mappingSource: "manual" | "automatic"; updatedAt: string;
}

export type CommissionStatus = "active" | "closing" | "completed" | "dormant";

export interface Commission {
  id: number;
  projectName: string; clientName: string | null;
  budget: number; invoiced: number;
  status: CommissionStatus;
}

// ── DASHBOARD ─────────────────────────────────────────────

export interface DashboardData {
  fic: FicData;
  float: FloatData;
  capacity: FloatCapacity;
  projectMetrics: Record<number, { scheduledHours: number }>;
  fetchedAt: string;
}
