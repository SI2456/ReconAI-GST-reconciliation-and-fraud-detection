import React, { useState } from "react";
import { CheckCircle2, XCircle, ShieldCheck, Lock, Clock, Loader2 } from "lucide-react";
import { apiRequest } from "../lib/api";
import { formatIST } from "../lib/datetime";

// Level 7: the tax officer's ITC decision on a tax invoice (from the API's `itc` field).
export type ItcDecision = {
  status: "approved" | "rejected";
  decidedAt: string | null;
  decidedByName: string;
  decidedByRole: string;
  reason: string;
  invoiceNo: string;
};

/** ✓ ITC Approved / ✗ ITC Rejected badge with the IST time (and reason when rejected). */
export function ItcBadge({ itc, showReason = true }: { itc?: ItcDecision | null; showReason?: boolean }) {
  if (!itc) return null;
  if (itc.status === "approved") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
        title={`Approved by ${itc.decidedByName || "tax officer"} on ${formatIST(itc.decidedAt)}`}
      >
        <CheckCircle2 size={11} /> ITC Approved · {formatIST(itc.decidedAt)}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30"
        title={`Rejected by ${itc.decidedByName || "tax officer"}: ${itc.reason}`}
      >
        <XCircle size={11} /> ITC Rejected · {formatIST(itc.decidedAt)}
      </span>
      {showReason && itc.reason && (
        <span className="text-[10px] text-red-700 dark:text-red-400 max-w-xs">Reason: {itc.reason}</span>
      )}
    </span>
  );
}

type LevelSummary = {
  levelNumber: number;
  title: string;
  status: string;
  items: { name: string; received: string; status: string }[];
};

function currentRole(): string {
  try {
    return JSON.parse(localStorage.getItem("reconai_user") || "{}").role || "";
  } catch {
    return "";
  }
}

/**
 * Level 7 panel: everything levels 1–6 found, then the tax officer's Yes / No decision.
 * Yes is offered only when levels 1–6 passed and the invoice is matched with GSTR-2B.
 */
export function ItcDecisionPanel({
  invoiceId,
  invoice,
  levels,
  allPassed,
  isMatched,
  decision,
  onDecided,
}: {
  invoiceId: string | null | undefined;
  invoice: { number: string; supplier: string; supplierGstin: string; taxable: string; gst: string; total: string };
  levels: LevelSummary[];
  allPassed: boolean;
  isMatched: boolean;
  decision?: ItcDecision | null;
  onDecided: () => void;
}) {
  const canDecide = ["ca", "admin"].includes(currentRole());
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const decide = async (choice: "approve" | "reject") => {
    if (!invoiceId) return;
    if (choice === "reject" && reason.trim().length < 5) {
      setError("Please write the reason for rejecting (at least 5 characters).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/invoices/${invoiceId}/itc-decision`, {
        method: "POST",
        auth: true,
        body: JSON.stringify({ decision: choice, reason: reason.trim() }),
      });
      setRejecting(false);
      setReason("");
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the decision.");
    } finally {
      setBusy(false);
    }
  };

  const approved = decision?.status === "approved";
  const rejected = decision?.status === "rejected";
  const showButtons = canDecide && !approved && invoiceId && allPassed && isMatched;

  return (
    <div className="bg-[#0D1424] border border-sky-500/40 rounded-2xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between gap-2 border-b border-[#1E293B] pb-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="px-3 py-1 rounded-lg text-xs font-black font-mono bg-sky-600/25 text-sky-400 border border-sky-500/40">LEVEL 7</span>
          <span className="text-xs font-bold text-slate-100 uppercase tracking-wide">Tax Officer ITC Decision</span>
        </div>
        {approved && <ItcBadge itc={decision} />}
        {rejected && <ItcBadge itc={decision} showReason={false} />}
      </div>

      {/* Invoice under review */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[11px]">
        {[
          ["Invoice", invoice.number],
          ["Supplier", invoice.supplier],
          ["Supplier GSTIN", invoice.supplierGstin],
          ["Taxable", invoice.taxable],
          ["ITC (GST)", invoice.gst],
          ["Total", invoice.total],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#090D18] border border-[#1E293B] rounded-lg p-2 min-w-0">
            <div className="text-slate-500">{label}</div>
            <div className="text-slate-100 font-mono font-semibold truncate" title={value}>{value || "—"}</div>
          </div>
        ))}
      </div>

      {/* Everything levels 1–6 checked */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">Levels 1–6 summary</div>
        {levels.map(level => (
          <details key={level.levelNumber} className="bg-[#090D18] border border-[#1E293B] rounded-lg">
            <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-200 font-semibold">Level {level.levelNumber} · {level.title}</span>
              <span className={`font-mono font-bold ${level.status === "PASS" ? "text-emerald-400" : "text-red-400"}`}>
                {level.status === "PASS" ? "✓ PASS" : `✗ ${level.status}`} · {level.items.length} checks
              </span>
            </summary>
            <div className="px-3 pb-2 space-y-1">
              {level.items.map((item, i) => (
                <div key={i} className="flex items-start justify-between gap-3 text-[10px] border-t border-[#1E293B] pt-1">
                  <span className="text-slate-300">{item.name}</span>
                  <span className={`text-right ${item.status === "PASS" ? "text-slate-400" : "text-amber-400"}`}>{item.received}</span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      {/* Decision */}
      {approved && (
        <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-500/40 rounded-lg p-3">
          <ShieldCheck size={16} className="shrink-0 mt-0.5" />
          <span>ITC approved by <strong>{decision!.decidedByName}</strong> on {formatIST(decision!.decidedAt)}. This invoice is locked and can't be claimed again.</span>
        </div>
      )}
      {rejected && (
        <div className="text-xs text-red-300 bg-red-950/40 border border-red-500/40 rounded-lg p-3">
          ITC rejected by <strong>{decision!.decidedByName}</strong> on {formatIST(decision!.decidedAt)}.
          <div className="mt-1"><span className="font-bold">Reason:</span> {decision!.reason}</div>
        </div>
      )}
      {!approved && !allPassed && (
        <div className="flex items-center gap-2 text-xs text-slate-400"><Lock size={14} /> The decision opens once levels 1–6 all pass.</div>
      )}
      {!approved && allPassed && !isMatched && (
        <div className="flex items-center gap-2 text-xs text-amber-300"><Clock size={14} /> Run reconciliation first: ITC can be approved only for an invoice matched with GSTR-2B.</div>
      )}
      {!approved && allPassed && isMatched && !canDecide && !rejected && (
        <div className="flex items-center gap-2 text-xs text-slate-300"><Clock size={14} /> Waiting for the tax officer's decision.</div>
      )}

      {showButtons && (
        <div className="space-y-2">
          <div className="text-xs text-slate-200 font-semibold">{rejected ? "Change the decision?" : "Approve the ITC claim for this invoice?"}</div>
          {!rejecting ? (
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => decide("approve")}
                className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={14} />} Yes, approve ITC
              </button>
              {!rejected && (
                <button type="button" disabled={busy} onClick={() => { setRejecting(true); setError(""); }}
                  className="flex items-center gap-1.5 text-xs font-bold bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg disabled:opacity-50">
                  <XCircle size={14} /> No, reject
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="Reason for rejecting this ITC claim (the client will see this)"
                className="w-full bg-[#090D18] border border-slate-700 rounded-lg p-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500/60" />
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => decide("reject")}
                  className="flex items-center gap-1.5 text-xs font-bold bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg disabled:opacity-50">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={14} />} Confirm rejection
                </button>
                <button type="button" disabled={busy} onClick={() => { setRejecting(false); setError(""); }}
                  className="text-xs text-slate-300 border border-slate-700 px-4 py-2 rounded-lg hover:bg-slate-800">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
