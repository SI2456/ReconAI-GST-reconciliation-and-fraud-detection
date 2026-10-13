import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Download, Eye, FileText, Loader2, RefreshCw, XCircle } from "lucide-react";
import { apiRequest, fetchFileObjectUrl, openProtectedFile } from "../lib/api";
import { formatIST } from "../lib/datetime";

type Money = { invoices: number; gst: number };
type SharedReport = {
  id: string;
  name: string;
  period: string;
  fileName: string;
  sentAt: string | null;
  generatedBy: string;
  summary: {
    booksInvoices?: number;
    booksGst?: number;
    itcAtRisk?: number;
    approved?: Money;
    rejected?: Money;
    pending?: Money;
  };
};

const rupees = (value: number | undefined) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Client "Reports" tab: the monthly ITC reports their tax officer has sent them. */
export default function ClientReports() {
  const [reports, setReports] = useState<SharedReport[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => {
    setError("");
    apiRequest<{ reports: SharedReport[] }>("/api/reports", { auth: true })
      .then(res => setReports(res.reports || []))
      .catch(err => { setReports(prev => prev ?? []); setError(err instanceof Error ? err.message : "Couldn't load reports."); });
  };

  useEffect(() => {
    load();
    // Pick up a report the tax officer sends while this tab is open.
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const open = (r: SharedReport) =>
    openProtectedFile(`/api/reports/${r.id}/file`).catch(err => setError(err instanceof Error ? err.message : "Couldn't open the report."));

  const download = async (r: SharedReport) => {
    setBusy(r.id);
    try {
      const url = await fetchFileObjectUrl(`/api/reports/${r.id}/file`);
      const link = document.createElement("a");
      link.href = url;
      link.download = r.fileName || `ITC_Report_${r.period}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-end gap-3">
        <div>
          <h1 className="text-lg font-bold">Reports</h1>
          <p className="text-xs text-muted-foreground">Monthly Input Tax Credit (ITC) reports from your tax officer: approved and rejected ITC, and your purchase register compared with GSTR-2B.</p>
        </div>
        <button type="button" onClick={load} className="flex items-center gap-1 text-xs border border-border bg-card hover:bg-muted px-3 py-1.5 rounded-lg shadow-sm transition-colors shrink-0">
          <RefreshCw size={13} className="text-muted-foreground" /> Refresh
        </button>
      </div>

      {error && <div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-900/60 rounded-md px-3 py-2">{error}</div>}

      {reports === null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Loading reports…</div>
      )}

      {reports !== null && reports.length === 0 && (
        <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center space-y-1">
          <FileText size={22} className="mx-auto text-muted-foreground" />
          <div className="text-sm font-medium">No reports yet</div>
          <div className="text-xs text-muted-foreground">When your tax officer sends your monthly ITC report, it will appear here and in your messages.</div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {reports?.map(r => {
          const s = r.summary || {};
          return (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 shrink-0">PDF</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">ITC report · {r.period || r.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.sentAt ? `Received ${formatIST(r.sentAt)}` : ""}{r.generatedBy ? ` · from ${r.generatedBy}` : ""}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-2">
                  <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium"><CheckCircle2 size={11} /> Approved</div>
                  <div className="font-mono font-semibold mt-0.5">{s.approved?.invoices ?? 0}</div>
                  <div className="text-muted-foreground font-mono">{rupees(s.approved?.gst)}</div>
                </div>
                <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 p-2">
                  <div className="flex items-center gap-1 text-red-700 dark:text-red-400 font-medium"><XCircle size={11} /> Rejected</div>
                  <div className="font-mono font-semibold mt-0.5">{s.rejected?.invoices ?? 0}</div>
                  <div className="text-muted-foreground font-mono">{rupees(s.rejected?.gst)}</div>
                </div>
                <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-2">
                  <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium"><Clock size={11} /> Awaiting</div>
                  <div className="font-mono font-semibold mt-0.5">{s.pending?.invoices ?? 0}</div>
                  <div className="text-muted-foreground font-mono">{rupees(s.pending?.gst)}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{s.booksInvoices ?? 0} invoices · ITC at risk <span className="font-mono text-foreground">{rupees(s.itcAtRisk)}</span></span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => open(r)} className="flex items-center gap-1 text-xs border border-border bg-card px-2.5 py-1 rounded hover:bg-muted transition-colors">
                    <Eye size={11} /> View
                  </button>
                  <button type="button" onClick={() => download(r)} disabled={busy === r.id}
                    className="flex items-center gap-1 text-xs bg-amber-500 text-white px-2.5 py-1 rounded hover:bg-amber-600 transition-colors disabled:opacity-50">
                    {busy === r.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Download
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
