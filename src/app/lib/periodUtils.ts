// ── Shared Canonical Period Utility ──────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const MONTH_LOOKUP: Record<string, number> = {};
MONTH_NAMES.forEach((m, idx) => {
  MONTH_LOOKUP[m.toLowerCase()] = idx + 1;
  MONTH_LOOKUP[m.slice(0, 3).toLowerCase()] = idx + 1;
});

export interface ParsedMonthYear {
  month: number; // 1-12
  year: number;
}

/**
 * Parse various date/period formats into { month, year }
 * Handles: "04-2026", "2026-04", "April 2026", "Apr 2026", "2026-04-29"
 */
export function parseMonthYear(val?: string | null): ParsedMonthYear | null {
  if (!val) return null;
  const s = String(val).trim();
  if (!s || s.toUpperCase() === "ALL" || s === "All Uploaded Data") return null;

  // YYYY-MM-DD or DD-MM-YYYY
  const isoMatch = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }
  const dmyMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmyMatch) {
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }

  // MM-YYYY
  const mmYyyyMatch = s.match(/^(\d{1,2})[/-](\d{4})$/);
  if (mmYyyyMatch) {
    const month = parseInt(mmYyyyMatch[1], 10);
    const year = parseInt(mmYyyyMatch[2], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }

  // YYYY-MM
  const yyyyMmMatch = s.match(/^(\d{4})[/-](\d{1,2})$/);
  if (yyyyMmMatch) {
    const year = parseInt(yyyyMmMatch[1], 10);
    const month = parseInt(yyyyMmMatch[2], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }

  // Month YYYY (e.g. "April 2026", "Apr 2026", "April_2026")
  const textMatch = s.match(/^([A-Za-z]+)[\s_\-]+(\d{4})$/);
  if (textMatch) {
    const name = textMatch[1].toLowerCase();
    const year = parseInt(textMatch[2], 10);
    if (MONTH_LOOKUP[name]) {
      return { month: MONTH_LOOKUP[name], year };
    }
  }

  return null;
}

/**
 * Return canonical "Month Year", e.g. "April 2026"
 */
export function normalizePeriod(val?: string | null): string {
  const parsed = parseMonthYear(val);
  if (parsed) {
    return `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
  }
  return String(val || "").trim();
}

/**
 * Return "MM-YYYY", e.g. "04-2026"
 */
export function periodToMmYyyy(val?: string | null): string {
  const parsed = parseMonthYear(val);
  if (parsed) {
    return `${String(parsed.month).padStart(2, "0")}-${parsed.year}`;
  }
  return "";
}

/**
 * Expand a period string (including ranges like "April–September 2026") into month-year list
 */
export function expandPeriodRange(val?: string | null): ParsedMonthYear[] {
  if (!val) return [];
  const s = String(val).trim();
  if (!s) return [];

  const single = parseMonthYear(s);
  if (single) return [single];

  // Range with dash/en-dash: "April–September 2026" or "Apr-Sep 2026"
  const rangeMatch = s.match(/^([A-Za-z]+)\s*[\-–—~to]+\s*([A-Za-z]+)[\s_\-]+(\d{4})$/i);
  if (rangeMatch) {
    const m1Name = rangeMatch[1].toLowerCase();
    const m2Name = rangeMatch[2].toLowerCase();
    const year = parseInt(rangeMatch[3], 10);
    const m1 = MONTH_LOOKUP[m1Name];
    const m2 = MONTH_LOOKUP[m2Name];
    if (m1 && m2) {
      const results: ParsedMonthYear[] = [];
      if (m1 <= m2) {
        for (let m = m1; m <= m2; m++) results.push({ month: m, year });
      } else {
        for (let m = m1; m <= 12; m++) results.push({ month: m, year });
        for (let m = 1; m <= m2; m++) results.push({ month: m, year: year + 1 });
      }
      return results;
    }
  }

  // Comma separated list
  if (s.includes(",")) {
    const results: ParsedMonthYear[] = [];
    s.split(",").forEach(part => {
      const p = parseMonthYear(part.trim());
      if (p && !results.some(r => r.month === p.month && r.year === p.year)) {
        results.push(p);
      }
    });
    if (results.length > 0) return results;
  }

  return [];
}

/**
 * Check if two period specifications match or overlap (handles single months and ranges)
 */
export function periodsMatch(p1?: string | null, p2?: string | null): boolean {
  const s1 = String(p1 || "").trim();
  const s2 = String(p2 || "").trim();
  if (!s1 || !s2) return false;
  if (s1.toUpperCase() === "ALL" || s1 === "All Uploaded Data" || s2.toUpperCase() === "ALL" || s2 === "All Uploaded Data") {
    return true;
  }
  if (s1.toLowerCase() === s2.toLowerCase()) return true;

  const r1 = expandPeriodRange(s1);
  const r2 = expandPeriodRange(s2);

  if (r1.length > 0 && r2.length > 0) {
    return r1.some(m1 => r2.some(m2 => m1.month === m2.month && m1.year === m2.year));
  }

  return false;
}

/**
 * Check whether an upload record covers the requested selected period
 */
export function uploadMatchesPeriod(upload: any, selectedPeriod: string): boolean {
  if (!selectedPeriod || selectedPeriod.toUpperCase() === "ALL" || selectedPeriod === "All Uploaded Data") {
    return true;
  }

  const docType = String(upload.documentType || upload.category || upload.document_type || "").toUpperCase();
  if (docType === "SUPPLIER_MASTER") return true;

  // 1. Check array of taxPeriods
  const periods = upload.taxPeriods || upload.tax_periods;
  if (Array.isArray(periods) && periods.length > 0) {
    if (periods.some(p => periodsMatch(p, selectedPeriod))) return true;
  }

  // 2. Check string taxPeriod
  const pStr = upload.taxPeriod || upload.tax_period;
  if (pStr && periodsMatch(pStr, selectedPeriod)) return true;

  // 3. Check financialYear match if selectedPeriod is financial year
  const fy = upload.financialYear || upload.financial_year;
  if (fy && periodsMatch(fy, selectedPeriod)) return true;

  // 4. Check filename fallback (e.g. gstr2b_04_2026.json)
  const fname = upload.fileName || upload.file_name || "";
  const match = fname.match(/(\d{2})_(\d{4})/);
  if (match && periodsMatch(`${match[1]}-${match[2]}`, selectedPeriod)) return true;

  // If purchase register has no periods specified, it is considered all-period reference
  if (docType === "PURCHASE_REGISTER" && (!periods || (Array.isArray(periods) && periods.length === 0)) && !pStr) {
    return true;
  }

  return false;
}
