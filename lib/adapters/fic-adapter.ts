/**
 * FIC Adapter — aligned with the previous connector-hub project.
 * Fetches current-year invoices with fieldset=detailed so payments_list is available.
 * Monthly revenue is based on document date; paid is based on document-level paid amount.
 */

import type { FicCredentials } from "../config-store";
import type { FicData, FicInvoice, FicQuote, FicClient } from "../dashboard/types";

const BASE = "https://api-v2.fattureincloud.it";
const PER_PAGE = 50;
const MAX_PAGES = 40;

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ── HTTP helper ────────────────────────────────────────────
async function ficGet(creds: FicCredentials, path: string): Promise<Record<string, unknown>> {
  const token = creds.accessToken.replace(/^[^a-zA-Z0-9]+/, "");
  const url = `${BASE}/c/${creds.companyId}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FIC HTTP ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function normalizeInvoice(r: Record<string, unknown>): FicInvoice {
  let net = Number(r.amount_net ?? r.net_amount ?? 0);
  let vat = Number(r.amount_vat ?? r.vat_amount ?? 0);
  let gross = Number(r.amount_gross ?? r.gross_amount ?? 0);
  if (net === 0 && gross > 0) net = gross - vat;
  if (gross === 0 && net > 0) gross = net + vat;
  if (vat === 0 && gross > net) vat = gross - net;

  let paid = 0;
  const payments: { amount: number; paidDate: string | null; status: string | null }[] = [];
  if (Array.isArray(r.payments_list) && r.payments_list.length > 0) {
    for (const p of r.payments_list as Record<string, unknown>[]) {
      const status = String(p.status ?? "");
      const paidDate = (p.paid_date ?? p.payment_date ?? null) as string | null;
      const amount = Number(p.amount ?? p.payment_amount ?? 0);
      payments.push({ amount, paidDate, status: status || null });
      if (status === "paid" || paidDate != null) paid += amount;
    }
  }
  if (paid === 0 && Number(r.amount_paid ?? 0) > 0) paid = Number(r.amount_paid);
  if (paid === 0 && Number(r.paid_amount ?? 0) > 0) paid = Number(r.paid_amount);
  if (paid === 0 && Number(r.payments_sum ?? 0) > 0) paid = Number(r.payments_sum);
  if (paid === 0 && r.is_marked === true) paid = gross;

  const due = Math.max(gross - paid, 0);
  const date  = (r.date ?? r.issue_date ?? null) as string | null;
  const dueDateStr = (r.payment_due_date ?? r.due_date ?? null) as string | null;
  const isOverdue = !r.is_marked && dueDateStr ? new Date(dueDateStr) < new Date() : false;

  const entity = (r.entity ?? r.client ?? {}) as Record<string, unknown>;
  return {
    id: Number(r.id ?? 0),
    number: String(r.number ?? r.doc_number ?? ""),
    date,
    clientId: entity.id ? Number(entity.id) : null,
    clientName: String(entity.name ?? r.client_name ?? ""),
    amountNet: net, amountVat: vat, amountGross: gross,
    amountPaid: paid, amountDue: due,
    isPaid: due <= 0.01,
    isOverdue,
    type: String(r.type ?? "invoice"),
    subject: (r.subject ?? r.title ?? r.description ?? null) as string | null,
    payments,
  };
}

function normalizeQuote(r: Record<string, unknown>): FicQuote {
  const net   = Number(r.amount_net   ?? 0);
  const gross = Number(r.amount_gross ?? r.amount_net ?? 0);
  const entity = (r.entity ?? r.client ?? {}) as Record<string, unknown>;
  return {
    id: Number(r.id ?? 0),
    number: String(r.number ?? ""),
    date: (r.date ?? null) as string | null,
    clientId: entity.id ? Number(entity.id) : null,
    clientName: String(entity.name ?? ""),
    subject: (r.subject ?? null) as string | null,
    amountNet: net, amountGross: gross,
    status: String(r.status ?? ""),
  };
}

// ── Paginate helper ────────────────────────────────────────
async function paginateAll<T>(
  creds: FicCredentials,
  basePath: string,
  normalize: (r: Record<string, unknown>) => T
): Promise<T[]> {
  const results: T[] = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages && page <= MAX_PAGES) {
    const sep = basePath.includes("?") ? "&" : "?";
    const extra = basePath.startsWith("/issued_documents") ? "&fieldset=detailed&sort=-date" : "";
    const res = await ficGet(creds, `${basePath}${sep}per_page=${PER_PAGE}&page=${page}${extra}`);
    const raw = (res.data ?? []) as Record<string, unknown>[];
    if (page === 1) totalPages = Number(res.last_page ?? 1);
    results.push(...raw.map(normalize));
    if (raw.length < PER_PAGE) break;
    page++;
  }
  return results;
}

async function fetchIssuedDocumentsByType(
  creds: FicCredentials,
  type: "invoice" | "credit_note",
  startDate: string,
  endDate: string,
): Promise<FicInvoice[]> {
  const documents: FicInvoice[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const res = await ficGet(
      creds,
      `/issued_documents?type=${type}&per_page=${PER_PAGE}&page=${page}&sort=-date&fieldset=detailed`,
    );
    const raw = (res.data ?? []) as Record<string, unknown>[];
    if (page === 1) totalPages = Number(res.last_page ?? 1);
    let inRange = 0;
    for (const item of raw) {
      const doc = normalizeInvoice(item);
      if (doc.date && doc.date >= startDate && doc.date <= endDate) {
        documents.push(doc);
        inRange++;
      }
    }
    if (inRange === 0 || raw.length < PER_PAGE) break;
    page++;
  }

  return documents;
}

// ── Main fetch ─────────────────────────────────────────────
export async function fetchFicData(creds: FicCredentials): Promise<FicData> {
  const now = new Date();
  const yearStart = formatLocalDate(new Date(now.getFullYear(), 0, 1));
  const monthStart = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const today = formatLocalDate(now);

  const out: FicData = {
    annualRevenue: 0, annualRevenueNet: 0, annualPaid: 0, annualDue: 0,
    monthlyRevenue: 0, monthlyRevenueNet: 0,
    allInvoices: [], allClients: [], quotes: [],
    error: null, fetchedAt: new Date().toISOString(),
  };

  const allInvoices: FicInvoice[] = [];
  let creditNoteDocs: FicInvoice[] = [];

  try {
    const invoices = await fetchIssuedDocumentsByType(creds, "invoice", yearStart, today);
    allInvoices.push(...invoices);
  } catch (e) {
    out.error = `Invoices: ${e instanceof Error ? e.message : e}`;
  }

  try {
    creditNoteDocs = await fetchIssuedDocumentsByType(creds, "credit_note", yearStart, today);
  } catch (e) {
    console.log(`[FIC] Credit notes error: ${e instanceof Error ? e.message : e}`);
  }

  if (allInvoices.length === 0 && !out.error) out.error = "Invoices: nessun documento FIC disponibile";

  out.allInvoices = allInvoices;

  // Aggregates
  for (const inv of allInvoices) {
    const d = inv.date ?? "";
    if (d >= yearStart && d <= today) {
      out.annualRevenue    += inv.amountGross;
      out.annualRevenueNet += inv.amountNet;
      out.annualPaid       += inv.amountPaid;
      out.annualDue        += inv.amountDue;
    }
    if (d >= monthStart && d <= today) {
      out.monthlyRevenue    += inv.amountGross;
      out.monthlyRevenueNet += inv.amountNet;
    }
  }

  for (const note of creditNoteDocs) {
    const d = note.date ?? "";
    if (d >= yearStart && d <= today) {
      out.annualRevenue    -= note.amountGross;
      out.annualRevenueNet -= note.amountNet;
      out.annualPaid       -= note.amountPaid;
      out.annualDue        -= note.amountDue;
    }
    if (d >= monthStart && d <= today) {
      out.monthlyRevenue    -= note.amountGross;
      out.monthlyRevenueNet -= note.amountNet;
    }
  }

  console.log(`[FIC] YTD: gross=${out.annualRevenue.toFixed(0)} net=${out.annualRevenueNet.toFixed(0)} paid=${out.annualPaid.toFixed(0)}`);
  console.log(`[FIC] Credit notes: ${creditNoteDocs.length}`);

  // ── Quotes ─────────────────────────────────────────────
  try {
    const quotes = await paginateAll(creds, `/issued_documents?type=proforma`, normalizeQuote);
    out.quotes = quotes;
    console.log(`[FIC] Quotes: ${quotes.length}`);
  } catch (e) {
    console.log(`[FIC] Quotes error: ${e instanceof Error ? e.message : e}`);
  }

  // ── Clients ────────────────────────────────────────────
  try {
    const clients = await paginateAll<FicClient>(creds, `/entities/clients`, r => ({
      id: Number(r.id ?? 0),
      name: String(r.name ?? ""),
      totalRevenue: 0, invoiceCount: 0,
    }));
    // Enrich with YTD revenue
    for (const c of clients) {
      const ci = allInvoices.filter(i => i.clientId === c.id && (i.date ?? "") >= yearStart);
      const cn = creditNoteDocs.filter(i => i.clientId === c.id && (i.date ?? "") >= yearStart);
      c.totalRevenue = ci.reduce((s, i) => s + i.amountGross, 0);
      c.totalRevenue -= cn.reduce((s, i) => s + i.amountGross, 0);
      c.invoiceCount = ci.length;
    }
    out.allClients = clients.sort((a, b) => b.totalRevenue - a.totalRevenue);
    console.log(`[FIC] Clients: ${clients.length}`);
  } catch (e) {
    console.log(`[FIC] Clients error: ${e instanceof Error ? e.message : e}`);
  }

  return out;
}
