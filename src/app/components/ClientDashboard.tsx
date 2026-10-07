import { useState, useRef, useEffect } from "react";
import { formatIST } from "../lib/datetime";
import {
  Building2, ShieldAlert, Upload, FileText, CheckCircle2, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Send, User, Bot, Download, RefreshCw,
  Check, CircleDot, Clock, ChevronRight, X, MessageSquare, Landmark,
  HelpCircle, Settings, LogOut, Sun, Moon, Info, Calendar, Sparkles,
  ShoppingCart, Receipt, BookOpen, Users, Lock, CheckCheck, Save, Edit3, ShieldCheck,
  FileUp, Loader2
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { apiRequest } from "../lib/api";
import { periodsMatch, uploadMatchesPeriod, periodToMmYyyy, normalizePeriod, parseMonthYear } from "../lib/periodUtils";
import ErrorBoundary from "./ErrorBoundary";

interface ClientDashboardProps {
  user: {
    name: string;
    email: string;
    role: "admin" | "ca" | "client";
    firmName?: string;
    caName?: string;
    caEmail?: string;
    gstin?: string;
    gstLegalName?: string;
    gstTradeName?: string;
    gstStatus?: string;
    city?: string;
    phone?: string;
  };
  dark: boolean;
  setDark: (v: boolean) => void;
  onLogout: () => void;
}

export default function ClientDashboard({ user, dark, setDark, onLogout }: ClientDashboardProps) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "upload" | "reconciliation" | "alerts" | "chat" | "settings">("dashboard");
  const [currentUser, setCurrentUser] = useState(user);
  const [caDirectory, setCaDirectory] = useState<any[]>([]);
  const [needsCaSelection, setNeedsCaSelection] = useState(false);
  const [clientId, setClientId] = useState<number | null>(null);
  const [gstDetails, setGstDetails] = useState<any | null>(null);

  // Editable Client Profile Form State
  const [formName, setFormName] = useState(user.name || "");
  const [formEmail, setFormEmail] = useState(user.email || "");
  const [formPhone, setFormPhone] = useState(user.phone || "");
  const [formCity, setFormCity] = useState(user.city || "");
  const [formFirmName, setFormFirmName] = useState(user.firmName || "");
  const [formGstin, setFormGstin] = useState(user.gstin || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState("");

  const [showCaChangeModal, setShowCaChangeModal] = useState(false);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [myCaRequests, setMyCaRequests] = useState<any[]>([]);
  const [selectedTargetCa, setSelectedTargetCa] = useState("");
  const [selectedBarCaId, setSelectedBarCaId] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [submittingReq, setSubmittingReq] = useState(false);

  const fetchCaRequests = async () => {
    try {
      const res = await apiRequest<{ requests: any[] }>("/api/ca-change-requests", { auth: true });
      if (res?.requests) setMyCaRequests(res.requests);
    } catch { }
  };

  useEffect(() => {
    fetchCaRequests();
  }, []);

  useEffect(() => {
    setCurrentUser(user);
    if (user.name) setFormName(user.name);
    if (user.email) setFormEmail(user.email);
    if (user.phone) setFormPhone(user.phone);
    if (user.city) setFormCity(user.city);
    if (user.firmName) setFormFirmName(user.firmName);
    if (user.gstin) setFormGstin(user.gstin);

    apiRequest<{ client: any }>("/api/clients/me", { auth: true })
      .then(res => {
        if (res?.client) {
          setClientId(res.client.id || null);
          setCurrentUser(prev => ({
            ...prev,
            name: res.client.name || prev.name,
            gstin: res.client.gstin || prev.gstin,
            gstLegalName: res.client.gstLegalName,
            gstTradeName: res.client.gstTradeName,
            gstStatus: res.client.gstStatus,
            caName: res.client.caName,
            caEmail: res.client.caEmail,
            firmName: res.client.firmName,
            city: res.client.city || prev.city,
            phone: res.client.phone || prev.phone,
          }));
          if (res.client.name) setFormName(res.client.name);
          if (res.client.email) setFormEmail(res.client.email);
          if (res.client.city) setFormCity(res.client.city);
          if (res.client.firmName) setFormFirmName(res.client.firmName);
          if (res.client.gstin) setFormGstin(res.client.gstin);
          if (res.client.gstLegalName || res.client.gstTradeName || res.client.gstStatus) {
            setGstDetails(res.client);
          }
        }
      })
      .catch(() => { });
    apiRequest<{ profile: any }>("/api/client/profile", { auth: true })
      .then(res => {
        setClientId(res.profile?.clientId || null);
        setNeedsCaSelection(Boolean(res.profile?.needsCaSelection));
        if (res.profile?.ca) {
          setCurrentUser(prev => ({
            ...prev,
            caName: res.profile.ca.name,
            caEmail: res.profile.ca.email,
            firmName: res.profile.ca.firmName,
          }));
        }
        if (res.profile?.client) {
          setCurrentUser(prev => ({
            ...prev,
            name: res.profile.client.name || prev.name,
            gstin: res.profile.client.gstin || prev.gstin,
            gstLegalName: res.profile.client.gstLegalName || prev.gstLegalName,
            gstTradeName: res.profile.client.gstTradeName || prev.gstTradeName,
            gstStatus: res.profile.client.gstStatus || prev.gstStatus,
            firmName: res.profile.client.firmName || prev.firmName,
            city: res.profile.client.city || prev.city,
            phone: res.profile.client.phone || prev.phone,
          }));
          if (res.profile.client.name) setFormName(res.profile.client.name);
          if (res.profile.client.email) setFormEmail(res.profile.client.email);
          if (res.profile.client.city) setFormCity(res.profile.client.city);
          if (res.profile.client.phone) setFormPhone(res.profile.client.phone);
          if (res.profile.client.firmName) setFormFirmName(res.profile.client.firmName);
          if (res.profile.client.gstin) setFormGstin(res.profile.client.gstin);
          if (res.profile.client.gstLegalName || res.profile.client.gstTradeName || res.profile.client.gstStatus) {
            setGstDetails(res.profile.client);
          }
        }
      })
      .catch(() => { });
    apiRequest<{ cas: any[] }>("/api/ca/list", { auth: true })
      .then(res => setCaDirectory(res.cas || []))
      .catch(() => { });
  }, [user.name, user.email]);

  const clientGSTIN = currentUser.gstin || "27AAACA1234F1Z5";
  const clientName = currentUser.name || "Client Workspace";
  const verifiedGstName = currentUser.gstLegalName || currentUser.gstTradeName || gstDetails?.gstLegalName || gstDetails?.gstTradeName || "";
  const isGstinVerified = Boolean(
    (currentUser.gstStatus && currentUser.gstStatus.toLowerCase() === "active") ||
    currentUser.gstLegalName ||
    (gstDetails?.gstStatus && String(gstDetails?.gstStatus).toLowerCase() === "active") ||
    gstDetails?.gstLegalName
  );
  const managingCA = (currentUser as any).caName || ((currentUser as any).caEmail ? `Tax Officer (${(currentUser as any).caEmail})` : ((currentUser.firmName && !currentUser.firmName.includes("Audit LLP") && currentUser.firmName !== "Not assigned") ? currentUser.firmName : "Tax Officer"));
  const firmName = (currentUser as any).caFirm || ((currentUser as any).caEmail ? `Tax Office (${(currentUser as any).caEmail})` : ((currentUser as any).firmName && (currentUser as any).firmName !== "Not assigned" ? (currentUser as any).firmName : "ReconAI Tax Office LLP"));

  const [myInvoices, setMyInvoices] = useState<any[]>([]);
  const [myAlerts, setMyAlerts] = useState<any[]>([]);

  // ── Category metadata helpers ─────────────────────────────────────────────
  const CATEGORY_META: Record<string, { label: string; emoji: string; accent: string; badgeCls: string }> = {
    purchase_register: {
      label: "Purchase Register", emoji: "📒",
      accent: "emerald",
      badgeCls: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    },
    PURCHASE_REGISTER: {
      label: "Purchase Register", emoji: "📒",
      accent: "emerald",
      badgeCls: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    },
    gstr_2b: {
      label: "GSTR-2B", emoji: "🏛️",
      accent: "blue",
      badgeCls: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    },
    GSTR2B: {
      label: "GSTR-2B", emoji: "🏛️",
      accent: "blue",
      badgeCls: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    },
    invoice: {
      label: "Tax Invoice", emoji: "📄",
      accent: "amber",
      badgeCls: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    },
    TAX_INVOICE: {
      label: "Tax Invoice", emoji: "📄",
      accent: "amber",
      badgeCls: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    },
    purchase_order: {
      label: "Purchase Order (PO)", emoji: "🛒",
      accent: "sky",
      badgeCls: "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800",
    },
    PURCHASE_ORDER: {
      label: "Purchase Order (PO)", emoji: "🛒",
      accent: "sky",
      badgeCls: "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800",
    },
    supplier_master: {
      label: "Supplier Master", emoji: "🗂️",
      accent: "violet",
      badgeCls: "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    },
    SUPPLIER_MASTER: {
      label: "Supplier Master", emoji: "🗂️",
      accent: "violet",
      badgeCls: "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    },
    credit_note: {
      label: "Credit Note", emoji: "↙️",
      accent: "rose",
      badgeCls: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    },
    CREDIT_NOTE: {
      label: "Credit Note", emoji: "↙️",
      accent: "rose",
      badgeCls: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    },
    debit_note: {
      label: "Debit Note", emoji: "↗️",
      accent: "orange",
      badgeCls: "bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    },
    DEBIT_NOTE: {
      label: "Debit Note", emoji: "↗️",
      accent: "orange",
      badgeCls: "bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    },
  };

  const CATEGORY_TO_DOC_TYPE: Record<string, string> = {
    purchase_register: "PURCHASE_REGISTER",
    PURCHASE_REGISTER: "PURCHASE_REGISTER",
    gstr_2b: "GSTR2B",
    GSTR2B: "GSTR2B",
    invoice: "TAX_INVOICE",
    tax_invoice: "TAX_INVOICE",
    TAX_INVOICE: "TAX_INVOICE",
    purchase_order: "PURCHASE_ORDER",
    PURCHASE_ORDER: "PURCHASE_ORDER",
    supplier_master: "SUPPLIER_MASTER",
    SUPPLIER_MASTER: "SUPPLIER_MASTER",
    credit_note: "CREDIT_NOTE",
    CREDIT_NOTE: "CREDIT_NOTE",
    debit_note: "DEBIT_NOTE",
    DEBIT_NOTE: "DEBIT_NOTE",
  };

  const getCategoryLabel = (cat: string) => CATEGORY_META[cat]?.label ?? cat;
  const getCategoryBadge = (cat: string) => {
    const m = CATEGORY_META[cat] ?? CATEGORY_META["TAX_INVOICE"] ?? CATEGORY_META["invoice"];
    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${m?.badgeCls || ""}`}>
        {m?.emoji} {m?.label || cat}
      </span>
    );
  };

  const [reuploadRequests, setReuploadRequests] = useState<any[]>([]);
  const [activeReuploadItem, setActiveReuploadItem] = useState<any | null>(null);
  const [reuploadFile, setReuploadFile] = useState<File | null>(null);
  const [isReuploading, setIsReuploading] = useState(false);

  const fetchClientData = async () => {
    try {
      const invRes = await apiRequest<{ invoices: any[] }>("/api/invoices", { auth: true });
      if (invRes?.invoices) setMyInvoices(invRes.invoices);
      const upRes = await apiRequest<{ uploads: any[] }>("/api/ingestion/uploads", { auth: true });
      if (upRes?.uploads) {
        // One-time display correction for known legacy mislabeled sample files
        const LEGACY_CATEGORY_FIXES: Record<string, string> = {
          "purchase_register.csv": "PURCHASE_REGISTER",
          "suppliers_master.csv": "SUPPLIER_MASTER",
          "indian_tax_invoice.pdf": "TAX_INVOICE",
        };
        setUploads(upRes.uploads.map(u => {
          const rawType = u.documentType || u.category || "TAX_INVOICE";
          let correctedDocType = CATEGORY_TO_DOC_TYPE[rawType] || rawType;
          if (correctedDocType === "TAX_INVOICE") {
            const fname = (u.fileName || "").toLowerCase();
            if (fname.includes("gstr")) correctedDocType = "GSTR2B";
            else if (fname.includes("purchase_register")) correctedDocType = "PURCHASE_REGISTER";
            else if (fname.includes("supplier")) correctedDocType = "SUPPLIER_MASTER";
          }
          const taxPeriodStr = u.taxPeriod || (Array.isArray(u.taxPeriods) ? u.taxPeriods.join(", ") : "");
          const periodWarnings: string[] = Array.isArray(u.periodWarnings) ? u.periodWarnings : [];

          return {
            id: u.id,
            name: u.fileName,
            category: correctedDocType.toLowerCase(),
            documentType: correctedDocType,
            taxPeriod: taxPeriodStr,
            periodWarnings,
            parsedRows: u.parsedRows ?? 0,
            size: `${getCategoryLabel(correctedDocType)}${taxPeriodStr ? ` (${taxPeriodStr})` : ""} · ${u.parsedRows ?? 0} ${correctedDocType === "SUPPLIER_MASTER" ? "suppliers" : "rows"}`,
            date: formatIST(u.createdAt, ""),
            processedAt: u.processedAt || "",
            status: u.status,
            isReupload: Boolean(u.isReupload || u.is_reupload),
            reuploadInvoiceId: u.reuploadInvoiceId || u.reupload_invoice_id || "",
            reuploadNote: u.reuploadNote || u.reupload_note || "",
          };
        }));
      }
      const alertRes = await apiRequest<{ alerts: any[] }>("/api/fraud-alerts", { auth: true });
      if (alertRes?.alerts) setMyAlerts(alertRes.alerts);
      const reupRes = await apiRequest<{ requests: any[] }>("/api/client/reupload-requests", { auth: true });
      if (reupRes?.requests) setReuploadRequests(reupRes.requests);
      if (clientId) {
        const msgRes = await apiRequest<{ messages: any[] }>(`/api/messages?clientId=${clientId}`, { auth: true });
        if (msgRes?.messages) {
          setMessages(msgRes.messages.map(message => ({
            sender: message.senderRole === "client" ? "client" : "ca",
            text: message.text,
            time: formatIST(message.createdAt, ""),
          })));
        }
      }
    } catch { }
  };


  useEffect(() => {
    fetchClientData();
  }, [clientId]);

  const handleExecuteReupload = async (file: File, item: any) => {
    setIsReuploading(true);
    setUploadStatus(`Re-uploading replacement document for Invoice ${item.invoiceNo || item.id}...`);
    try {
      const docTypeEnum = item.documentType || item.category || "TAX_INVOICE";
      const formData = new FormData();
      formData.append("source", docTypeEnum === "GSTR2B" ? "gstr" : "books");
      formData.append("category", (item.category || "invoice").toLowerCase());
      formData.append("document_type", docTypeEnum);
      formData.append("fileType", docTypeEnum);
      formData.append("gstin", uploadGstin.trim());
      formData.append("financial_year", uploadFY);
      formData.append("tax_periods", JSON.stringify([item.taxPeriod || "06-2026"]));
      formData.append("tax_period", item.taxPeriod || "06-2026");
      formData.append("isReupload", "true");
      if (item.invoiceId) formData.append("reuploadInvoiceId", item.invoiceId);
      if (item.alertId) formData.append("reuploadAlertId", item.alertId);
      if (item.note || item.reason) formData.append("reuploadNote", item.note || item.reason);
      formData.append("file", file);

      await apiRequest<{ upload: any }>("/api/ingestion/upload", {
        method: "POST",
        auth: true,
        body: formData,
      });

      setClientNotice(`✓ Replacement document for Invoice ${item.invoiceNo || "Document"} re-uploaded successfully! Tax Officer has been notified.`);
      setUploadStatus(`✓ Replacement document for Invoice ${item.invoiceNo || "Document"} re-uploaded successfully!`);
      setActiveReuploadItem(null);
      setReuploadFile(null);
      await fetchClientData();
      setTimeout(() => setClientNotice(""), 6000);
    } catch (err) {
      setClientNotice(err instanceof Error ? err.message : "Re-upload failed. Please try again.");
      setUploadStatus(err instanceof Error ? err.message : "Re-upload failed. Please try again.");
    } finally {
      setIsReuploading(false);
    }
  };

  const clientHistoryData: any[] = [];

  // Dynamic Financial Year & Tax Period Calculations (Indian FY: April to March)
  const currentNow = new Date();
  const currentCalYear = currentNow.getFullYear();
  const currentCalMonth = currentNow.getMonth() + 1; // 1-12
  const currentFyStartYear = currentCalMonth >= 4 ? currentCalYear : currentCalYear - 1;
  const initialFy = `${currentFyStartYear}-${String(currentFyStartYear + 1).slice(-2)}`;
  const initialCurrentMonthCode = `${String(currentCalMonth).padStart(2, "0")}-${currentCalYear}`;

  // Upload Files state
  const [uploads, setUploads] = useState<any[]>([]);
  type UploadCategory = "purchase_register" | "gstr_2b" | "invoice" | "purchase_order" | "supplier_master" | "credit_note" | "debit_note";
  const [uploadCategory, setUploadCategory] = useState<UploadCategory>("purchase_register");
  const [uploadGstin, setUploadGstin] = useState(clientGSTIN);
  const [uploadFY, setUploadFY] = useState(initialFy);
  const [uploadPeriods, setUploadPeriods] = useState<string[]>([initialCurrentMonthCode]);
  const [isMultiMonthMode, setIsMultiMonthMode] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [clientNotice, setClientNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gstInputRef = useRef<HTMLInputElement>(null);

  // Option B: Overwrite vs Keep Both Modal State
  const [duplicateMatchUpload, setDuplicateMatchUpload] = useState<any | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // Real-time green progress bar state for Client upload
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadProgressText, setUploadProgressText] = useState("");
  const [uploadingFileName, setUploadingFileName] = useState("");

  // Chat State
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    if (!clientId) {
      setClientNotice("Client profile is still loading. Please try again in a moment.");
      return;
    }
    const text = chatInput.trim();
    setMessages(prev => [...prev, { sender: "client", text, time: "Just now" }]);
    setChatInput("");
    try {
      await apiRequest("/api/messages", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ clientId, text }),
      });
      fetchClientData();
    } catch (err) {
      setClientNotice(err instanceof Error ? err.message : "Message could not be sent to CA.");
    }
  };

  const handleFileSelected = (file: File) => {
    if (needsCaSelection) {
      setUploadStatus("Please select your Tax Officer before uploading documents.");
      return;
    }

    const docTypeEnum = CATEGORY_TO_DOC_TYPE[uploadCategory] || "TAX_INVOICE";
    // Check if an existing upload in the same category exists for this client
    const existing = uploads.find(u => {
      const sameDoc = (u.documentType === docTypeEnum || u.category === uploadCategory.toLowerCase());
      const sameName = u.name === file.name;
      return sameDoc && sameName;
    });

    if (existing) {
      setDuplicateMatchUpload(existing);
      setPendingUploadFile(file);
      setShowDuplicateModal(true);
      return;
    }

    uploadDocument(file);
  };

  const uploadDocument = async (file: File, overwriteUploadId?: string) => {
    if (needsCaSelection) {
      setUploadStatus("Please select your Tax Officer before uploading documents.");
      return;
    }
    const cat = uploadCategory;
    const catLabel = getCategoryLabel(cat);
    // GSTR-2B files go to the gstr parsing pipeline; everything else is books.
    const source = cat === "gstr_2b" ? "gstr" : "books";
    setIsUploading(true);
    setUploadingFileName(file.name);
    setUploadProgress(5);
    setUploadProgressText(`Initializing ${catLabel} upload for ${file.name}...`);
    setUploadStatus(`Uploading ${file.name} as ${catLabel}...`);

    if (overwriteUploadId) {
      try {
        await apiRequest(`/api/ingestion/uploads/${overwriteUploadId}`, {
          method: "DELETE",
          auth: true,
        });
      } catch (delErr) {
        console.warn("[upload overwrite] delete existing upload notice:", delErr);
      }
    }

    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev < 30) {
          setUploadProgressText("Transferring document to secure Tax Officer workspace...");
          return prev + 15;
        } else if (prev < 60) {
          setUploadProgressText(`Categorizing ${catLabel} fields & validating records...`);
          return prev + 10;
        } else if (prev < 85) {
          setUploadProgressText("Saving document to Tax Officer records...");
          return prev + 5;
        } else if (prev < 95) {
          return prev + 1;
        }
        return prev;
      });
    }, 200);

    try {
      const docTypeEnum = CATEGORY_TO_DOC_TYPE[cat] || "TAX_INVOICE";
      const formData = new FormData();
      formData.append("source", source);
      formData.append("category", cat);
      formData.append("document_type", docTypeEnum);
      formData.append("fileType", docTypeEnum);
      formData.append("gstin", uploadGstin.trim());
      formData.append("financial_year", uploadFY);
      formData.append("tax_periods", JSON.stringify(uploadPeriods));
      formData.append("tax_period", uploadPeriods.join(", "));
      formData.append("file", file);

      await apiRequest<{ upload: { fileName: string; status: string } }>("/api/ingestion/upload", {
        method: "POST",
        auth: true,
        body: formData,
      });

      clearInterval(interval);
      setUploadProgress(100);
      setUploadProgressText(`100% Complete! ${catLabel} sent to your Tax Officer.`);
      setUploadStatus(`${file.name} sent to your Tax Officer categorized as "${catLabel}". It will appear here once your Tax Officer shares it.`);
      fetchClientData();

      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
      }, 4000);
    } catch (err) {
      clearInterval(interval);
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus(err instanceof Error ? err.message : "Upload failed. Please try again.");
    }
  };

  const selectCa = async (caId: string | number) => {
    try {
      const res = await apiRequest<{ profile: any }>("/api/client/select-ca", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ caId }),
      });
      setNeedsCaSelection(false);
      if (res.profile?.ca) {
        setCurrentUser(prev => ({
          ...prev,
          caName: res.profile.ca.name,
          caEmail: res.profile.ca.email,
          firmName: res.profile.ca.firmName,
        }));
      }
      setClientNotice("Your Tax Officer has been selected.");
      fetchClientData();
    } catch (err) {
      setClientNotice(err instanceof Error ? err.message : "Could not select Tax Officer.");
    }
  };
  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingProfile(true);
    setProfileSuccessMsg("");
    try {
      const cleanGstin = (formGstin || "").trim().toUpperCase();
      const res: any = await apiRequest("/api/client/profile", {
        method: "PUT",
        auth: true,
        body: JSON.stringify({
          name: formName,
          email: formEmail,
          phone: formPhone,
          city: formCity,
          firmName: formFirmName,
          gstin: cleanGstin,
        }),
      });
      const updatedClient = res?.profile?.client || res?.client;
      if (updatedClient) {
        setCurrentUser(prev => ({
          ...prev,
          name: updatedClient.name || formName,
          email: updatedClient.email || formEmail,
          phone: updatedClient.phone || formPhone,
          city: updatedClient.city || formCity,
          firmName: updatedClient.firmName || formFirmName,
          gstin: updatedClient.gstin || cleanGstin,
        }));
        if (cleanGstin) {
          setUploadGstin(cleanGstin);
        }
        setProfileSuccessMsg("Profile details saved successfully.");
        setClientNotice("Client profile updated successfully.");
        setTimeout(() => setProfileSuccessMsg(""), 4000);
      } else {
        setProfileSuccessMsg("Profile details saved successfully.");
        setClientNotice("Client profile updated successfully.");
      }
    } catch (err) {
      setClientNotice(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const EmptyState = ({ message }: { message: string }) => (
    <div className="px-4 py-8 text-center text-xs text-muted-foreground">{message}</div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shadow-md shadow-amber-500/10">
            <Building2 size={16} className="text-slate-950 font-bold" />
          </div>
          <div>
            <span className="font-bold text-sm text-foreground tracking-tight">{clientName}</span>
            <span className="text-[10px] font-mono text-muted-foreground ml-2">GSTIN: {clientGSTIN}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDark(!dark)} className="p-2 rounded hover:bg-muted text-muted-foreground transition-colors">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
          <div className="h-6 w-px bg-border mx-2" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center text-xs font-semibold">{clientName[0]}</div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-medium text-foreground">Client Workspace</div>
              <div className="text-[9px] text-muted-foreground font-mono">Assigned to: {firmName}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-56 bg-card border-r border-border flex flex-col shrink-0">
          <nav className="flex-1 py-4 px-2.5 space-y-0.5">
            {[
              { id: "dashboard", label: "Business Dashboard", icon: Building2 },
              { id: "upload", label: "Upload Documents", icon: Upload },
              { id: "reconciliation", label: "Reconciliation Status", icon: FileText },
              { id: "alerts", label: "Fraud & Alerts", icon: ShieldAlert },
              { id: "chat", label: "Message my Tax Officer", icon: MessageSquare },
              { id: "settings", label: "Client Settings", icon: Settings },
            ].map(tab => {
              const active = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors ${active ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  <Icon size={14} className={active ? "text-amber-500" : ""} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-3 border-t border-border bg-muted/20 text-left space-y-1.5">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Your Tax Officer</div>
            <div className="text-xs font-semibold text-foreground">{managingCA}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{firmName}</div>
            <button type="button" onClick={() => setShowCaChangeModal(true)} className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-1 rounded hover:bg-amber-500/25 w-full text-center transition-colors block mt-1">
              Request Tax Officer Change
            </button>
            {myCaRequests.length > 0 && (
              <div className="text-[10px] text-muted-foreground pt-0.5">Request: <span className="font-semibold text-primary">{myCaRequests[0].status}</span></div>
            )}
          </div>

          <div className="p-2 border-t border-border">
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
            >
              <LogOut size={14} />
              <span>Log out</span>
            </button>
          </div>
        </aside>

        {/* Content Pane */}
        <main className="flex-1 overflow-y-auto bg-background/50 p-6 text-left">
          {clientNotice && (
            <div className="mb-4 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
              {clientNotice}
            </div>
          )}

          <ErrorBoundary
            fallbackTitle="Client Section Error"
            fallbackMessage="An unexpected issue occurred while rendering this section. You can switch to other tabs or retry."
            onReset={() => {
              setClientNotice("");
              fetchClientData();
            }}
          >
            {needsCaSelection && (
              <div className="mb-5 bg-card border border-amber-500/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                    <Building2 size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold">Select Your Tax Officer</div>
                    <div className="text-[11px] text-muted-foreground">Choose a tax officer to connect GST data & manage compliance</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedBarCaId}
                    onChange={e => setSelectedBarCaId(e.target.value)}
                    className="bg-muted border border-border rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="">Select Tax Officer Division...</option>
                    {caDirectory.map(ca => (
                      <option key={ca.id} value={ca.id}>
                        {ca.name} {ca.firmName ? `(${ca.firmName})` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedBarCaId) selectCa(selectedBarCaId);
                    }}
                    disabled={!selectedBarCaId}
                    className="bg-amber-500 text-slate-950 text-xs font-semibold px-3.5 py-1.5 rounded-md hover:bg-amber-400 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    Confirm Selection
                  </button>
                </div>
              </div>
            )}

            {/* Dashboard Tab */}
            {activeTab === "dashboard" && (() => {
              const totalInvoicesCount = myInvoices.length;
              const booksInvoices = myInvoices.filter(i => (i.source || "").toLowerCase() === "books");
              const gstrInvoices = myInvoices.filter(i => (i.source || "").toLowerCase() === "gstr");
              const matchedInvoices = myInvoices.filter(i => (i.status || "").toLowerCase() === "matched");
              const mismatchedInvoices = myInvoices.filter(i => (i.status || "").toLowerCase() === "mismatched" || (i.status || "").toLowerCase() === "mismatch");
              const missingInGstr = myInvoices.filter(i => (i.status || "").toLowerCase().includes("missing_in_gstr") || ((i.status || "").toLowerCase() === "missing" && (i.source || "").toLowerCase() === "books"));
              const missingInBooks = myInvoices.filter(i => (i.status || "").toLowerCase().includes("missing_in_books") || ((i.status || "").toLowerCase() === "missing" && (i.source || "").toLowerCase() === "gstr"));
              const duplicateInvoices = myInvoices.filter(i => (i.status || "").toLowerCase() === "duplicate");

              // Taxable & Tax amounts
              const totalTaxableValue = myInvoices.reduce((acc, i) => acc + (Number(i.taxable) || 0), 0);
              const totalGstValue = myInvoices.reduce((acc, i) => acc + (Number(i.gst) || (Number(i.cgst || 0) + Number(i.sgst || 0) + Number(i.igst || 0))), 0);
              const matchedGstValue = matchedInvoices.reduce((acc, i) => acc + (Number(i.gst) || (Number(i.cgst || 0) + Number(i.sgst || 0) + Number(i.igst || 0))), 0);
              const atRiskGstValue = Math.max(0, totalGstValue - matchedGstValue);

              // Compliance score
              const rawCompliance = (currentUser as any).compliance;
              const calculatedMatchRate = totalInvoicesCount > 0 ? Math.round((matchedInvoices.length / totalInvoicesCount) * 100) : 100;
              const complianceScore = (typeof rawCompliance === "number" && rawCompliance > 0) ? rawCompliance : calculatedMatchRate;

              // Fraud Alerts breakdown
              const highRiskCount = myAlerts.filter(a => Number(a.risk || 0) >= 70).length;
              const medRiskCount = myAlerts.filter(a => Number(a.risk || 0) >= 40 && Number(a.risk || 0) < 70).length;

              // Dynamic Monthly History for Chart
              const dynamicMonthlyHistory = (() => {
                const monthLabels = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];
                const monthMap: Record<string, { total: number; matched: number }> = {};
                monthLabels.forEach(m => { monthMap[m] = { total: 0, matched: 0 }; });

                myInvoices.forEach(inv => {
                  const p = parseMonthYear(inv.tax_period || inv.taxPeriod || inv.invoice_date || inv.invoiceDate);
                  if (p && p.month >= 4 && p.month <= 9) {
                    const mLabel = monthLabels[p.month - 4];
                    if (monthMap[mLabel]) {
                      monthMap[mLabel].total += 1;
                      if ((inv.status || "").toLowerCase() === "matched") monthMap[mLabel].matched += 1;
                    }
                  }
                });

                return monthLabels.map((m, idx) => {
                  const data = monthMap[m];
                  let score = 92;
                  if (data.total > 0) {
                    score = Math.round((data.matched / data.total) * 100);
                  } else {
                    score = Math.min(100, Math.max(80, Math.round(complianceScore - (5 - idx) * 1.5)));
                  }
                  return { month: m, score, invoices: data.total };
                });
              })();

              return (
                <div className="space-y-6">
                  {/* Welcome Bar */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <h1 className="text-xl font-bold flex items-center gap-2">
                        <span>Welcome back, {clientName}</span>
                        {isGstinVerified && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <ShieldCheck size={12} /> Verified GST
                          </span>
                        )}
                      </h1>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {verifiedGstName ? `Business Entity: ${verifiedGstName} · ` : ""}
                        GSTIN: <span className="font-mono font-semibold text-foreground">{clientGSTIN}</span> · Tax Officer: <span className="font-semibold text-foreground">{managingCA}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs bg-card border border-border px-3 py-1.5 rounded-lg shadow-sm font-medium">
                        <Calendar size={13} className="text-primary" />
                        <span>Active FY: <strong className="font-mono">{uploadFY}</strong></span>
                      </div>
                      <button
                        type="button"
                        onClick={() => fetchClientData()}
                        className="p-2 bg-card border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Refresh Client Data"
                      >
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Urgent Re-upload Request Action Banner */}
                  {reuploadRequests.length > 0 && (
                    <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border-2 border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-lg space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-start gap-3">
                          <div className="p-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold shrink-0">
                            <Upload size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm sm:text-base font-bold text-foreground">
                                ⚡ Action Required: Tax Officer Requested Document Re-upload ({reuploadRequests.length})
                              </h3>
                              <span className="text-[10px] bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full font-bold">
                                Action Required
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Your Tax Officer has reviewed your invoices and requested a replacement upload for the following document(s).
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        {reuploadRequests.map((req) => (
                          <div
                            key={req.id}
                            className="bg-card border border-amber-500/30 rounded-xl p-3.5 flex flex-col justify-between space-y-2.5 shadow-sm hover:border-amber-500/60 transition-colors"
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-mono font-bold text-foreground">
                                  Invoice {req.invoiceNo}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 rounded font-bold">
                                  📅 {req.taxPeriod || "06-2026"}
                                </span>
                              </div>
                              <div className="text-xs font-semibold text-foreground">{req.supplier}</div>
                              <div className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 leading-relaxed">
                                <strong>Reason from Tax Officer:</strong> {req.reason || req.note}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setActiveReuploadItem(req);
                                setReuploadFile(null);
                              }}
                              className="w-full flex items-center justify-center gap-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 py-2 rounded-xl transition-all shadow-sm"
                            >
                              <Upload size={13} />
                              <span>Re-upload Document Now</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Client Business Details & ITC Summary Card */}
                  <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Business Profile */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <Building2 size={12} className="text-primary" /> Registered Business
                        </div>
                        <div className="text-xs font-bold text-foreground truncate">{clientName}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">GSTIN: {clientGSTIN}</div>
                        {currentUser.city && <div className="text-[11px] text-muted-foreground">📍 {currentUser.city}</div>}
                      </div>

                      {/* Total ITC Claimed */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <Receipt size={12} className="text-blue-500" /> Total Input Tax Credit (ITC)
                        </div>
                        <div className="text-base font-bold font-mono text-foreground">
                          {totalGstValue > 0 ? `₹${Math.round(totalGstValue).toLocaleString("en-IN")}` : "₹0"}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Across {totalInvoicesCount} uploaded invoices
                        </div>
                      </div>

                      {/* Reconciled / Safe ITC */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 size={12} /> Reconciled & Eligible ITC
                        </div>
                        <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                          {matchedGstValue > 0 ? `₹${Math.round(matchedGstValue).toLocaleString("en-IN")}` : "₹0"}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {matchedInvoices.length} matched records
                        </div>
                      </div>

                      {/* At Risk / Under Review ITC */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertTriangle size={12} /> Disputed / At-Risk ITC
                        </div>
                        <div className="text-base font-bold font-mono text-amber-600 dark:text-amber-400">
                          {atRiskGstValue > 0 ? `₹${Math.round(atRiskGstValue).toLocaleString("en-IN")}` : "₹0"}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {mismatchedInvoices.length + missingInGstr.length} exceptions pending CA review
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Stats Widgets */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Compliance Rating */}
                    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between h-32 hover:border-border/80 transition-colors">
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Compliance Rating</span>
                        <span className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={14} />
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                          {complianceScore}%
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {complianceScore >= 75 ? "🟢 Excellent Tax Standing" : complianceScore >= 50 ? "🟡 Good Compliance" : "🔴 Action Required"}
                        </div>
                      </div>
                    </div>

                    {/* Total Invoices Uploaded */}
                    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between h-32 hover:border-border/80 transition-colors">
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Total Invoices Uploaded</span>
                        <span className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                          <FileText size={14} />
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="text-2xl font-bold font-mono text-foreground">{totalInvoicesCount}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 font-medium">
                          {booksInvoices.length} Books · {gstrInvoices.length} GSTR-2B
                        </div>
                      </div>
                    </div>

                    {/* Reconciliation Matches */}
                    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between h-32 hover:border-border/80 transition-colors">
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Reconciliation Matches</span>
                        <span className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                          <RefreshCw size={14} />
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="text-2xl font-bold font-mono text-foreground">
                          {matchedInvoices.length} <span className="text-xs text-muted-foreground font-normal">/ {totalInvoicesCount}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {calculatedMatchRate}% Reconciled · {mismatchedInvoices.length} Mismatched
                        </div>
                      </div>
                    </div>

                    {/* Tax Anomalies Flagged */}
                    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between h-32 border-amber-500/30 bg-amber-500/[0.02] hover:border-amber-500/50 transition-colors">
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Tax Anomalies Flagged</span>
                        <span className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
                          <ShieldAlert size={14} />
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="text-2xl font-bold font-mono text-red-500">{myAlerts.length}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {highRiskCount} High Risk · {medRiskCount} Medium Risk
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Chart & Alerts Summary */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Score Chart */}
                    <div className="lg:col-span-7 bg-card border border-border rounded-xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">Compliance Rating Progression</h3>
                          <p className="text-xs text-muted-foreground">Monthly reconciliation consistency & filing accuracy</p>
                        </div>
                        <span className="text-[11px] font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                          Avg: {complianceScore}%
                        </span>
                      </div>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={dynamicMonthlyHistory}>
                            <defs>
                              <linearGradient id="clientGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="rgb(16, 185, 129)" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="rgb(16, 185, 129)" stopOpacity={0.01} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis domain={[60, 100]} tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v) => [`${v}% Compliance Rating`, ""]} />
                            <Area type="monotone" dataKey="score" stroke="rgb(16, 185, 129)" fill="url(#clientGrad)" strokeWidth={2.5} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Flagged Business Anomalies */}
                    <div className="lg:col-span-5 bg-card border border-border rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">Flagged Business Anomalies</h3>
                          <p className="text-xs text-muted-foreground">ML and Rule-46 detected transaction risks</p>
                        </div>
                        <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                          {myAlerts.length} Active
                        </span>
                      </div>

                      <div className="space-y-2.5 pt-1 max-h-[250px] overflow-y-auto pr-1">
                        {myAlerts.slice(0, 5).map((a, idx) => {
                          const riskScore = Number(a.risk || 0);
                          const isHigh = riskScore >= 70;
                          const entityName = a.entity || a.supplier || a.vendor || "Supplier Discrepancy";
                          const reasonText = a.reason || a.desc || a.details || "Inconsistency detected in invoice or portal filing";
                          const alertAmount = a.amount ? `₹${Number(a.amount).toLocaleString("en-IN")}` : "";

                          return (
                            <div
                              key={a.id || idx}
                              className={`p-3 rounded-lg border text-xs space-y-1.5 transition-colors ${isHigh
                                ? "bg-red-50/60 dark:bg-red-950/20 border-red-200 dark:border-red-900/40"
                                : "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40"
                                }`}
                            >
                              <div className="flex justify-between items-center">
                                <span className="font-semibold text-foreground truncate max-w-[180px]">{entityName}</span>
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${isHigh
                                    ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
                                    : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                                    }`}
                                >
                                  {a.type || "Mismatch"}
                                </span>
                              </div>
                              <div className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{reasonText}</div>
                              <div className="flex items-center justify-between text-[10px] pt-0.5">
                                <span className="font-mono font-semibold text-foreground">{alertAmount}</span>
                                <span className="text-muted-foreground font-medium">CA Status: <strong className="text-foreground">{a.status || "Open"}</strong></span>
                              </div>
                            </div>
                          );
                        })}
                        {myAlerts.length === 0 && <EmptyState message="No flagged business anomalies found for this workspace." />}
                      </div>
                    </div>
                  </div>

                  {/* Recent Invoices Snapshot */}
                  {myInvoices.length > 0 && (
                    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">Recent Invoice Filings & Reconciliation</h3>
                          <p className="text-xs text-muted-foreground">Latest transaction records extracted from your uploaded documents</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab("reconciliation")}
                          className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                        >
                          <span>View Full Reconciliation</span>
                          <ChevronRight size={13} />
                        </button>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead>
                            <tr className="border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                              <th className="py-2 px-2">Invoice No</th>
                              <th className="py-2 px-2">Supplier</th>
                              <th className="py-2 px-2">Date</th>
                              <th className="py-2 px-2">Source</th>
                              <th className="py-2 px-2 text-right">Taxable</th>
                              <th className="py-2 px-2 text-right">GST</th>
                              <th className="py-2 px-2 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {myInvoices.slice(0, 5).map((inv, idx) => {
                              const st = (inv.status || "Pending").toLowerCase();
                              const isMatched = st === "matched";
                              const isMismatch = st.includes("mismatch");
                              const isMissing = st.includes("missing");

                              return (
                                <tr key={inv.id || idx} className="hover:bg-muted/30 transition-colors">
                                  <td className="py-2 px-2 font-mono font-medium text-foreground">{inv.invoice_no || inv.invoiceNo || "-"}</td>
                                  <td className="py-2 px-2 font-medium truncate max-w-[150px]">{inv.supplier || "-"}</td>
                                  <td className="py-2 px-2 text-muted-foreground font-mono">{inv.invoice_date || inv.invoiceDate || "-"}</td>
                                  <td className="py-2 px-2">
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase font-semibold bg-muted text-muted-foreground">
                                      {inv.source || "Books"}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-right font-mono font-medium">₹{Number(inv.taxable || 0).toLocaleString("en-IN")}</td>
                                  <td className="py-2 px-2 text-right font-mono font-bold text-foreground">₹{Number(inv.gst || 0).toLocaleString("en-IN")}</td>
                                  <td className="py-2 px-2 text-center">
                                    <span
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${isMatched
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                        : isMismatch
                                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                          : isMissing
                                            ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                                            : "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                                        }`}
                                    >
                                      {inv.status || "Pending"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Upload Tab */}
            {activeTab === "upload" && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-lg font-bold">Document Upload Center</h1>
                  <p className="text-xs text-muted-foreground">Select a document category, then upload your file for your Tax Officer to review.</p>
                </div>

                {/* Document Category Selection */}
                <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Document Category *</div>
                    <span className="text-[11px] font-mono text-primary font-medium">
                      {CATEGORY_META[uploadCategory]?.emoji} {getCategoryLabel(uploadCategory)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {/* Active Document Categories */}
                    {(["purchase_register", "gstr_2b", "invoice", "purchase_order"] as const).map(cat => {
                      const meta = CATEGORY_META[cat];
                      const selected = uploadCategory === cat;
                      const ICONS = {
                        purchase_register: <BookOpen size={17} />,
                        gstr_2b: <Landmark size={17} />,
                        invoice: <FileText size={17} />,
                        purchase_order: <ShoppingCart size={17} />,
                      };
                      const DESCRIPTIONS: Record<string, string> = {
                        purchase_register: "Your books-side purchase records for reconciliation against GSTR-2B.",
                        gstr_2b: "Your downloaded GST ITC statement from the GST portal for this tax period.",
                        invoice: "Individual supplier bills, GST B2B/B2C invoices for reconciliation & fraud audit.",
                        purchase_order: "Buyer procurement orders & PO sheets for 3-way invoice cross-matching.",
                      };
                      const ACCENT_SELECTED: Record<string, string> = {
                        purchase_register: "bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500/40",
                        gstr_2b: "bg-blue-500/10 border-blue-500 ring-1 ring-blue-500/40",
                        invoice: "bg-amber-500/10 border-amber-500 ring-1 ring-amber-500/40",
                        purchase_order: "bg-sky-500/10 border-sky-500 ring-1 ring-sky-500/40",
                      };
                      const ICON_SELECTED: Record<string, string> = {
                        purchase_register: "bg-emerald-500 text-white",
                        gstr_2b: "bg-blue-500 text-white",
                        invoice: "bg-amber-500 text-slate-950",
                        purchase_order: "bg-sky-500 text-white",
                      };
                      const BADGE_CLS: Record<string, string> = {
                        purchase_register: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400",
                        gstr_2b: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
                        invoice: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
                        purchase_order: "bg-sky-500/20 text-sky-600 dark:text-sky-400",
                      };
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setUploadCategory(cat)}
                          className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${selected
                            ? `${ACCENT_SELECTED[cat]} text-foreground shadow-sm`
                            : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            }`}
                        >
                          <div className={`p-1.5 rounded-lg shrink-0 ${selected ? ICON_SELECTED[cat] : "bg-muted text-muted-foreground"}`}>
                            {ICONS[cat]}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                              <span>{meta.label}</span>
                              {selected && <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${BADGE_CLS[cat]}`}>Selected</span>}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{DESCRIPTIONS[cat]}</div>
                          </div>
                        </button>
                      );
                    })}

                    {/* Coming Soon Categories — Supplier Master, Credit Note, Debit Note */}
                    {(["supplier_master", "credit_note", "debit_note"] as const).map(cat => {
                      const meta = CATEGORY_META[cat];
                      const ICONS = {
                        supplier_master: <Users size={17} />,
                        credit_note: <ArrowDownRight size={17} />,
                        debit_note: <ArrowUpRight size={17} />,
                      };
                      const DESCRIPTIONS: Record<string, string> = {
                        supplier_master: "Static reference list of suppliers, GSTINs, and contact details.",
                        credit_note: "Credit notes adjustment and return statement processing.",
                        debit_note: "Debit notes adjustment and supplementary tax invoice records.",
                      };
                      return (
                        <button key={cat} type="button" disabled className="p-3 rounded-xl border border-dashed border-border/60 text-left flex items-start gap-2.5 opacity-60 cursor-not-allowed">
                          <div className="p-1.5 rounded-lg shrink-0 bg-muted text-muted-foreground">
                            {ICONS[cat]}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                              <span>{meta?.label || cat}</span>
                              <span className="text-[9px] font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-semibold">Coming Soon</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{DESCRIPTIONS[cat]}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Filing Period Selection (Financial Year & Tax Period Month) */}
                {(() => {
                  const FY_MONTH_DEFS = [
                    { name: "April", short: "Apr", monthNum: 4, yearOffset: 0 },
                    { name: "May", short: "May", monthNum: 5, yearOffset: 0 },
                    { name: "June", short: "Jun", monthNum: 6, yearOffset: 0 },
                    { name: "July", short: "Jul", monthNum: 7, yearOffset: 0 },
                    { name: "August", short: "Aug", monthNum: 8, yearOffset: 0 },
                    { name: "September", short: "Sep", monthNum: 9, yearOffset: 0 },
                    { name: "October", short: "Oct", monthNum: 10, yearOffset: 0 },
                    { name: "November", short: "Nov", monthNum: 11, yearOffset: 0 },
                    { name: "December", short: "Dec", monthNum: 12, yearOffset: 0 },
                    { name: "January", short: "Jan", monthNum: 1, yearOffset: 1 },
                    { name: "February", short: "Feb", monthNum: 2, yearOffset: 1 },
                    { name: "March", short: "Mar", monthNum: 3, yearOffset: 1 },
                  ];

                  const FY_OPTIONS = [
                    { label: `FY ${currentFyStartYear}-${String(currentFyStartYear + 1).slice(-2)} (Current)`, value: `${currentFyStartYear}-${String(currentFyStartYear + 1).slice(-2)}`, startYear: currentFyStartYear },
                    { label: `FY ${currentFyStartYear - 1}-${String(currentFyStartYear).slice(-2)}`, value: `${currentFyStartYear - 1}-${String(currentFyStartYear).slice(-2)}`, startYear: currentFyStartYear - 1 },
                    { label: `FY ${currentFyStartYear - 2}-${String(currentFyStartYear - 1).slice(-2)}`, value: `${currentFyStartYear - 2}-${String(currentFyStartYear - 1).slice(-2)}`, startYear: currentFyStartYear - 2 },
                  ];

                  const selectedFyStartYear = parseInt(uploadFY.split("-")[0], 10) || currentFyStartYear;
                  const isSelectedFyCurrent = selectedFyStartYear === currentFyStartYear;

                  const fyMonths = FY_MONTH_DEFS.map(m => {
                    const actualYear = selectedFyStartYear + m.yearOffset;
                    const periodCode = `${String(m.monthNum).padStart(2, "0")}-${actualYear}`;
                    const isCurrent = actualYear === currentCalYear && m.monthNum === currentCalMonth;
                    const isFuture = isSelectedFyCurrent && (
                      actualYear > currentCalYear || (actualYear === currentCalYear && m.monthNum > currentCalMonth)
                    );
                    return {
                      ...m,
                      actualYear,
                      periodCode,
                      periodLabel: `${m.name} ${actualYear}`,
                      isCurrent,
                      isFuture,
                    };
                  });

                  const availableMonths = fyMonths.filter(m => !m.isFuture);
                  const isAllAvailableSelected = availableMonths.length > 0 && availableMonths.every(m => uploadPeriods.includes(m.periodCode));

                  // Quick quarter filters
                  const q1Months = availableMonths.filter(m => [4, 5, 6].includes(m.monthNum));
                  const q2Months = availableMonths.filter(m => [7, 8, 9].includes(m.monthNum));

                  const handleToggleMonth = (periodCode: string) => {
                    if (isMultiMonthMode) {
                      if (uploadPeriods.includes(periodCode)) {
                        setUploadPeriods(uploadPeriods.filter(p => p !== periodCode));
                      } else {
                        setUploadPeriods([...uploadPeriods, periodCode]);
                      }
                    } else {
                      setUploadPeriods([periodCode]);
                    }
                  };

                  const formattedSelection = uploadPeriods.length === 0
                    ? "None Selected"
                    : isAllAvailableSelected && availableMonths.length > 1
                      ? `All Available (${availableMonths[0]?.name} - ${availableMonths[availableMonths.length - 1]?.name} ${selectedFyStartYear})`
                      : uploadPeriods.length > 1
                        ? `${uploadPeriods.length} Months Selected (${uploadPeriods.map(p => normalizePeriod(p) || p).join(", ")})`
                        : uploadPeriods.map(p => normalizePeriod(p) || p).join(", ");

                  return (
                    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                            <Calendar size={16} />
                          </div>
                          <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Filing Period (FY & Month) *</div>
                            <div className="text-[11px] text-muted-foreground">Financial year begins in April. Future months of the current year are disabled.</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5 max-w-md truncate">
                            <span>📅 Selected:</span>
                            <span className="font-bold text-foreground truncate">{formattedSelection}</span>
                            <span className="text-muted-foreground shrink-0">({uploadFY})</span>
                          </span>
                        </div>
                      </div>

                      {/* Financial Year Selector */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                          <span>Financial Year</span>
                          <span className="text-[10px] text-muted-foreground font-normal">(Apr – Mar)</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {FY_OPTIONS.map(fy => {
                            const isSelected = uploadFY === fy.value;
                            return (
                              <button
                                key={fy.value}
                                type="button"
                                onClick={() => {
                                  setUploadFY(fy.value);
                                  if (fy.startYear === currentFyStartYear) {
                                    setUploadPeriods([initialCurrentMonthCode]);
                                  } else {
                                    setUploadPeriods([`04-${fy.startYear}`]);
                                  }
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${isSelected
                                  ? "bg-primary text-primary-foreground border-primary shadow-sm font-semibold"
                                  : "bg-muted/40 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                  }`}
                              >
                                <span>{fy.label}</span>
                                {isSelected && <Check size={13} className="stroke-[3]" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Month Selector Controls */}
                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                            <span>Tax Period Month</span>
                            <span className="text-[10px] text-muted-foreground font-normal">
                              {isSelectedFyCurrent ? `(Showing April to ${fyMonths.find(m => m.isCurrent)?.name || "Current Month"})` : "(All 12 Months Available)"}
                            </span>
                          </label>

                          {/* Multi-Month Toggle & Quick Presets */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Selection Mode Switch */}
                            <div className="inline-flex rounded-lg p-0.5 bg-muted border border-border text-[10px] font-medium">
                              <button
                                type="button"
                                onClick={() => {
                                  setIsMultiMonthMode(false);
                                  if (uploadPeriods.length > 1) {
                                    setUploadPeriods([uploadPeriods[0]]);
                                  } else if (uploadPeriods.length === 0 && availableMonths.length > 0) {
                                    setUploadPeriods([availableMonths[availableMonths.length - 1].periodCode]);
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-md transition-all ${!isMultiMonthMode
                                  ? "bg-card text-foreground font-semibold shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                                  }`}
                              >
                                Single Month
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsMultiMonthMode(true)}
                                className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${isMultiMonthMode
                                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                                  }`}
                              >
                                <CheckCheck size={11} />
                                <span>Select Multiple Months</span>
                              </button>
                            </div>

                            {/* Quick Multi-select Presets */}
                            {availableMonths.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsMultiMonthMode(true);
                                    if (isAllAvailableSelected) {
                                      setUploadPeriods([initialCurrentMonthCode]);
                                    } else {
                                      setUploadPeriods(availableMonths.map(m => m.periodCode));
                                    }
                                  }}
                                  className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-colors ${isAllAvailableSelected
                                    ? "bg-primary/20 text-primary border-primary/30"
                                    : "bg-muted text-muted-foreground border-border hover:text-foreground hover:bg-muted/80"
                                    }`}
                                >
                                  {isAllAvailableSelected ? "✓ All Selected" : `Select All (${availableMonths[0]?.short} - ${availableMonths[availableMonths.length - 1]?.short})`}
                                </button>

                                {q1Months.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsMultiMonthMode(true);
                                      setUploadPeriods(q1Months.map(m => m.periodCode));
                                    }}
                                    className="text-[10px] font-semibold px-2 py-1 rounded-md border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                  >
                                    Q1 (Apr–Jun)
                                  </button>
                                )}

                                {q2Months.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsMultiMonthMode(true);
                                      setUploadPeriods(q2Months.map(m => m.periodCode));
                                    }}
                                    className="text-[10px] font-semibold px-2 py-1 rounded-md border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                  >
                                    Q2 (Jul–Sep)
                                  </button>
                                )}

                                {uploadPeriods.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setUploadPeriods([availableMonths[availableMonths.length - 1]?.periodCode || initialCurrentMonthCode]);
                                      setIsMultiMonthMode(false);
                                    }}
                                    className="text-[10px] font-medium px-2 py-1 rounded-md text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                                  >
                                    Reset Single
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Month Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                          {fyMonths.map(m => {
                            const isSelected = uploadPeriods.includes(m.periodCode);
                            if (m.isFuture) {
                              return (
                                <div
                                  key={m.periodCode}
                                  title={`${m.name} ${m.actualYear} is an upcoming future month and not yet open for tax filing.`}
                                  className="p-2.5 rounded-lg border border-dashed border-border/40 bg-muted/10 text-muted-foreground/40 text-left flex flex-col justify-between opacity-50 cursor-not-allowed select-none"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-medium">{m.name}</span>
                                    <Lock size={11} className="text-muted-foreground/50" />
                                  </div>
                                  <div className="flex items-center justify-between mt-1 text-[9px] text-muted-foreground/40 font-mono">
                                    <span>{m.periodCode}</span>
                                    <span className="text-[8px] bg-muted/40 px-1 rounded">Upcoming</span>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <button
                                key={m.periodCode}
                                type="button"
                                onClick={() => handleToggleMonth(m.periodCode)}
                                className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between relative ${isSelected
                                  ? "bg-primary text-primary-foreground border-primary shadow-sm ring-1 ring-primary/40 font-semibold"
                                  : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                  }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`text-[11px] ${isSelected ? "text-primary-foreground font-bold" : "text-foreground font-medium"}`}>
                                    {m.name}
                                  </span>
                                  {isSelected ? (
                                    <span className="p-0.5 rounded bg-white/20 text-white flex items-center justify-center">
                                      <Check size={11} className="stroke-[3]" />
                                    </span>
                                  ) : isMultiMonthMode ? (
                                    <span className="w-3.5 h-3.5 rounded border border-muted-foreground/40 bg-background/50 flex items-center justify-center text-[9px]" />
                                  ) : m.isCurrent ? (
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Current Month" />
                                  ) : null}
                                </div>
                                <div className="flex items-center justify-between mt-1.5 text-[9px] font-mono">
                                  <span className={isSelected ? "text-primary-foreground/90" : "text-muted-foreground"}>{m.periodCode}</span>
                                  {m.isCurrent && (
                                    <span className={`text-[8px] px-1 rounded font-bold ${isSelected ? "bg-white/20 text-white" : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"}`}>
                                      Current
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Re-upload Action Banner on Upload Tab */}
                {reuploadRequests.length > 0 && (
                  <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border border-amber-500/40 rounded-xl p-4 shadow space-y-2.5 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2">
                      <Upload size={16} className="text-amber-500" />
                      <h4 className="text-xs font-bold text-foreground">
                        Tax Officer Re-upload Requests Pending ({reuploadRequests.length})
                      </h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {reuploadRequests.map((req) => (
                        <button
                          key={req.id}
                          type="button"
                          onClick={() => {
                            setActiveReuploadItem(req);
                            setReuploadFile(null);
                          }}
                          className="flex items-center gap-1.5 text-xs bg-card border border-amber-500/40 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg font-medium text-foreground transition-all shadow-xs"
                        >
                          <span className="font-mono font-bold text-primary">Invoice {req.invoiceNo}</span>
                          <span className="text-[10px] text-muted-foreground">({req.supplier})</span>
                          <span className="text-[10px] bg-amber-500 text-slate-950 font-bold px-1.5 py-0.2 rounded ml-1">Re-upload</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Upload Dropzone */}
                {(() => {
                  const meta = CATEGORY_META[uploadCategory];
                  const isGstr = uploadCategory === "gstr_2b";
                  const canUpload = !needsCaSelection;
                  const DROPZONE_ACCENT: Record<string, string> = {
                    purchase_register: "border-emerald-500/40 hover:border-emerald-500",
                    gstr_2b: "border-blue-500/40 hover:border-blue-500",
                    invoice: "border-amber-500/40 hover:border-amber-500",
                    purchase_order: "border-sky-500/40 hover:border-sky-500",
                    supplier_master: "border-violet-500/40 hover:border-violet-500",
                    credit_note: "border-rose-500/40 hover:border-rose-500",
                    debit_note: "border-orange-500/40 hover:border-orange-500",
                  };
                  const ICON_BG: Record<string, string> = {
                    purchase_register: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    gstr_2b: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                    invoice: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    purchase_order: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
                    supplier_master: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
                    credit_note: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                    debit_note: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
                  };
                  const BTN_CLS: Record<string, string> = {
                    purchase_register: "bg-emerald-500 text-white hover:bg-emerald-400",
                    gstr_2b: "bg-blue-600 text-white hover:bg-blue-500",
                    invoice: "bg-amber-500 text-slate-950 hover:bg-amber-400",
                    purchase_order: "bg-sky-500 text-white hover:bg-sky-400",
                    supplier_master: "bg-violet-500 text-white hover:bg-violet-400",
                    credit_note: "bg-rose-500 text-white hover:bg-rose-400",
                    debit_note: "bg-orange-500 text-white hover:bg-orange-400",
                  };
                  return (
                    <>
                      <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors bg-card ${DROPZONE_ACCENT[uploadCategory] ?? "border-border"}`}>
                        <div className="flex flex-col items-center gap-3">
                          <div className={`w-11 h-11 rounded-full flex items-center justify-center ${ICON_BG[uploadCategory] ?? "bg-muted text-muted-foreground"}`}>
                            <Upload size={20} />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Upload {meta.label}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {isGstr ? "JSON export from GST portal · " : "PDF, JSON, CSV, XLS, XLSX or image · "}up to 50 MB
                            </div>
                            <div className="mt-2">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold bg-muted/60 border border-border text-foreground">
                                <Calendar size={11} className="text-primary" />
                                <span>Target Filing Period:</span>
                                <strong className="text-primary">
                                  {uploadPeriods.length > 3
                                    ? `${uploadPeriods.length} Months Selected (${normalizePeriod(uploadPeriods[0])} - ${normalizePeriod(uploadPeriods[uploadPeriods.length - 1])})`
                                    : uploadPeriods.map(p => normalizePeriod(p) || p).join(", ") || "Unassigned"}{" "}
                                  ({uploadFY})
                                </strong>
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 pt-2">
                            {/* Hidden file input for general docs */}
                            <input
                              ref={fileInputRef}
                              type="file"
                              className="hidden"
                              accept=".csv,.json,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) handleFileSelected(file);
                                e.currentTarget.value = "";
                              }}
                            />
                            {/* Hidden file input for GSTR-2B JSON */}
                            <input
                              ref={gstInputRef}
                              type="file"
                              className="hidden"
                              accept=".json,.csv"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) handleFileSelected(file);
                                e.currentTarget.value = "";
                              }}
                            />
                            <button
                              type="button"
                              disabled={!canUpload}
                              onClick={() => (isGstr ? gstInputRef : fileInputRef).current?.click()}
                              className={`text-xs font-semibold px-4 py-2 rounded transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${BTN_CLS[uploadCategory] ?? "bg-primary text-primary-foreground"}`}
                            >
                              Browse {meta.label} File
                            </button>
                          </div>
                          {uploadStatus && !isUploading && <div className="text-xs text-amber-600 dark:text-amber-400 pt-1">{uploadStatus}</div>}
                        </div>
                      </div>

                      {/* Option B: Duplicate / Re-upload Confirmation Modal */}
                      {showDuplicateModal && duplicateMatchUpload && pendingUploadFile && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                          <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="p-5 border-b border-border bg-amber-500/10 flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                                  <AlertTriangle size={18} />
                                </div>
                                <div>
                                  <h3 className="text-sm font-bold text-foreground">Existing Document Detected</h3>
                                  <p className="text-[11px] text-muted-foreground">Duplicate upload confirmation (Option B)</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowDuplicateModal(false);
                                  setPendingUploadFile(null);
                                  setDuplicateMatchUpload(null);
                                }}
                                className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              >
                                <X size={16} />
                              </button>
                            </div>

                            <div className="p-5 space-y-4 text-xs">
                              <p className="text-muted-foreground leading-relaxed">
                                An existing <strong className="text-foreground">{getCategoryLabel(uploadCategory)}</strong> is already on record for this workspace:
                              </p>

                              <div className="p-3.5 bg-muted/50 border border-border rounded-xl space-y-1.5 font-mono text-[11px]">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Existing File:</span>
                                  <span className="font-semibold text-foreground truncate max-w-[200px]">{duplicateMatchUpload.name}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Tax Period:</span>
                                  <span className="text-primary font-bold">{duplicateMatchUpload.taxPeriod || "Unassigned"}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Parsed Records:</span>
                                  <span>{duplicateMatchUpload.parsedRows ?? 0} rows</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">New Upload:</span>
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold truncate max-w-[200px]">{pendingUploadFile.name}</span>
                                </div>
                              </div>

                              <p className="text-[11px] text-muted-foreground">
                                How would you like to handle this upload? You can overwrite the existing file to avoid duplicate records, or keep both as parallel datasets.
                              </p>
                            </div>

                            <div className="p-4 border-t border-border bg-muted/20 flex flex-col sm:flex-row gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowDuplicateModal(false);
                                  setPendingUploadFile(null);
                                  setDuplicateMatchUpload(null);
                                }}
                                className="px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const file = pendingUploadFile;
                                  setShowDuplicateModal(false);
                                  setPendingUploadFile(null);
                                  setDuplicateMatchUpload(null);
                                  uploadDocument(file);
                                }}
                                className="px-3 py-2 rounded-lg bg-muted text-foreground border border-border text-xs font-semibold hover:bg-muted/80 transition-colors"
                              >
                                Keep Both Documents
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const file = pendingUploadFile;
                                  const overwriteId = duplicateMatchUpload.id;
                                  setShowDuplicateModal(false);
                                  setPendingUploadFile(null);
                                  setDuplicateMatchUpload(null);
                                  uploadDocument(file, overwriteId);
                                }}
                                className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition-colors shadow-sm"
                              >
                                Overwrite Existing File
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Real-time Green Progress Bar */}
                {isUploading && (
                  <div className="bg-card border border-emerald-500/40 rounded-xl p-4 space-y-2.5 animate-in fade-in duration-200 shadow-md">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
                        <span className="text-foreground font-semibold">{uploadProgressText}</span>
                      </div>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-3 bg-muted rounded-full overflow-hidden p-0.5 border border-emerald-500/30">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-300 ease-out shadow-[0_0_12px_rgba(16,185,129,0.6)]"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                      <span>File: {uploadingFileName}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        {uploadProgress === 100 ? "✓ 100% Upload Completed" : "Uploading in Real-Time..."}
                      </span>
                    </div>
                  </div>
                )}

                {/* Uploads history */}
                <div className="bg-card border border-border rounded-xl">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ingested Document Log</h3>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {uploads.length} document{uploads.length !== 1 ? "s" : ""} on record
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {uploads.map((u, i) => {
                      const iconMap: Record<string, JSX.Element> = {
                        purchase_register: <BookOpen size={15} />,
                        PURCHASE_REGISTER: <BookOpen size={15} />,
                        gstr_2b: <Landmark size={15} />,
                        GSTR2B: <Landmark size={15} />,
                        invoice: <FileText size={15} />,
                        tax_invoice: <FileText size={15} />,
                        TAX_INVOICE: <FileText size={15} />,
                        purchase_order: <ShoppingCart size={15} />,
                        PURCHASE_ORDER: <ShoppingCart size={15} />,
                        supplier_master: <Users size={15} />,
                        SUPPLIER_MASTER: <Users size={15} />,
                      };
                      const iconBgMap: Record<string, string> = {
                        purchase_register: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        PURCHASE_REGISTER: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        gstr_2b: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                        GSTR2B: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                        invoice: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        tax_invoice: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        TAX_INVOICE: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        purchase_order: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
                        PURCHASE_ORDER: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
                        supplier_master: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
                        SUPPLIER_MASTER: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
                      };
                      const docKey = u.documentType || u.category || "TAX_INVOICE";
                      const catIcon = iconMap[docKey] ?? iconMap[u.category] ?? <FileText size={15} />;
                      const catIconBg = iconBgMap[docKey] ?? iconBgMap[u.category] ?? "bg-muted text-muted-foreground";
                      const hasPeriodWarnings = u.periodWarnings && u.periodWarnings.length > 0;

                      return (
                        <div key={i} className="px-4 py-3.5 flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 mt-0.5 ${catIconBg}`}>
                              {catIcon}
                            </div>
                            <div>
                              <div className="text-xs font-semibold font-mono flex items-center gap-2 flex-wrap">
                                <span>{u.name}</span>
                                {getCategoryBadge(docKey)}
                                {u.taxPeriod && (
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border">
                                    📅 {u.taxPeriod}
                                  </span>
                                )}
                                {u.isReupload && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                    ✨ Re-uploaded
                                  </span>
                                )}
                                {reuploadRequests.some(r => r.sourceBatchFile === u.name || r.invoiceId === u.reuploadInvoiceId) && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                    ⚠️ Re-upload Requested
                                  </span>
                                )}
                                {hasPeriodWarnings && (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                                    title={u.periodWarnings.join(" | ")}
                                  >
                                    <AlertTriangle size={10} className="text-amber-600 dark:text-amber-400" />
                                    <span>Date Mismatch ({u.periodWarnings.length})</span>
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {u.size} · Uploaded {u.date}
                                {u.processedAt && <span className="text-emerald-600 dark:text-emerald-400"> · Processed {formatIST(u.processedAt)}</span>}
                              </div>
                              {hasPeriodWarnings && (
                                <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-1.5 flex items-start gap-1.5 bg-amber-500/10 p-2 rounded-md border border-amber-500/20 max-w-xl">
                                  <Info size={12} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                                  <span>{u.periodWarnings[0]}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {reuploadRequests.find(r => r.sourceBatchFile === u.name || r.invoiceId === u.reuploadInvoiceId) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const req = reuploadRequests.find(r => r.sourceBatchFile === u.name || r.invoiceId === u.reuploadInvoiceId);
                                  if (req) {
                                    setActiveReuploadItem(req);
                                    setReuploadFile(null);
                                  }
                                }}
                                className="flex items-center gap-1 text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 px-2.5 py-1 rounded-lg font-bold transition-all shadow-xs"
                              >
                                <Upload size={11} /> Re-upload
                              </button>
                            ) : null}
                            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded font-medium">
                              <Check size={11} /> Sent to Tax Officer
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {uploads.length === 0 && <EmptyState message="No documents uploaded yet." />}
                  </div>
                </div>
              </div>
            )}


            {/* Reconciliation Status Tab */}
            {activeTab === "reconciliation" && (
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <div>
                    <h1 className="text-lg font-bold">Invoice Reconciliation Status</h1>
                    <p className="text-xs text-muted-foreground">Self-monitoring mismatch details generated by Tax Officer's audit model.</p>
                  </div>
                  <button type="button" onClick={() => setClientNotice("Client reconciliation export will be available after Tax Officer publishes a report.")} className="flex items-center gap-1 text-xs border border-border bg-card hover:bg-muted px-3 py-1.5 rounded-lg shadow-sm transition-colors">
                    <Download size={13} className="text-muted-foreground" /> Export Reports
                  </button>
                </div>

                {/* Table */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 font-medium text-muted-foreground">
                          <th className="px-4 py-3 text-left">Invoice No.</th>
                          <th className="px-4 py-3 text-left">Supplier</th>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-left">Total Value</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-left">Risk Flag</th>
                          <th className="px-4 py-3 text-left"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {myInvoices.map((inv) => {
                          const isExpanded = expandedInvoice === inv.id;
                          return (
                            <>
                              <tr
                                key={inv.id}
                                onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
                                className={`hover:bg-muted/30 cursor-pointer ${isExpanded ? "bg-muted/20" : ""}`}
                              >
                                <td className="px-4 py-3 font-mono text-primary">{inv.id}</td>
                                <td className="px-4 py-3 font-semibold">{inv.supplier}</td>
                                <td className="px-4 py-3 text-muted-foreground">{inv.date}</td>
                                <td className="px-4 py-3 font-mono font-medium">{inv.total}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium font-mono ${inv.status === "Matched"
                                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                                      }`}>
                                      {inv.status}
                                    </span>
                                    {(inv.reuploadStatus === "requested" || inv.reupload_status === "requested" || reuploadRequests.some(r => r.invoiceId === inv.id)) && (
                                      <div className="flex items-center gap-1">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 font-mono">
                                          ⚠️ Re-upload Req.
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const matchReq = reuploadRequests.find(r => r.invoiceId === inv.id) || {
                                              invoiceId: inv.id,
                                              invoiceNo: inv.id || inv.invoice_no,
                                              supplier: inv.supplier,
                                              taxPeriod: inv.taxPeriod || inv.tax_period || "06-2026",
                                              category: inv.source === "gstr" ? "GSTR2B" : "TAX_INVOICE",
                                              reason: inv.reuploadNote || inv.reupload_note || "Tax officer requested document re-upload.",
                                            };
                                            setActiveReuploadItem(matchReq);
                                            setReuploadFile(null);
                                          }}
                                          className="text-[10px] font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 px-2 py-0.5 rounded transition-colors shadow-xs"
                                        >
                                          Re-upload
                                        </button>
                                      </div>
                                    )}
                                    {(inv.reuploadStatus === "reuploaded" || inv.reupload_status === "reuploaded" || inv.isReupload || inv.is_reupload) && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-mono shadow-xs">
                                        ✨ Re-uploaded
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium font-mono ${inv.risk === "Low"
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                    : inv.risk === "Medium"
                                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                                      : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                                    }`}>
                                    {inv.risk}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <ChevronRight size={13} className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr key={`${inv.id}-detail`} className="bg-muted/10">
                                  <td colSpan={7} className="px-6 py-4 border-t border-b border-border">
                                    <div className="grid grid-cols-2 gap-8">
                                      <div>
                                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">My In-House Books Data</div>
                                        <div className="space-y-1 text-xs">
                                          <div className="flex justify-between"><span className="text-muted-foreground">GSTIN</span><span className="font-mono">{clientGSTIN}</span></div>
                                          <div className="flex justify-between"><span className="text-muted-foreground">Invoice No.</span><span className="font-mono">{inv.id}</span></div>
                                          <div className="flex justify-between"><span className="text-muted-foreground">Supplier Code</span><span className="font-mono">{inv.gstin}</span></div>
                                          <div className="flex justify-between"><span className="text-muted-foreground">Total In Books</span><span className="font-mono font-semibold">{inv.total}</span></div>
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">GST Portal GSTR-2B Registry</div>
                                        <div className="space-y-1 text-xs">
                                          <div className="flex justify-between"><span className="text-muted-foreground">Reported GSTIN</span><span className="font-mono">{clientGSTIN}</span></div>
                                          <div className="flex justify-between"><span className="text-muted-foreground">Invoice No.</span><span className="font-mono">{inv.id}</span></div>
                                          <div className="flex justify-between"><span className="text-muted-foreground">Supplier Code</span><span className="font-mono">{inv.gstin}</span></div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Total In GSTR-2B</span>
                                            <span className={`font-mono font-semibold ${inv.status === "Mismatched" ? "text-red-500 font-bold" : ""}`}>
                                              {inv.status === "Mismatched" ? "NOT FOUND / MISSING" : inv.total}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="mt-4 pt-3 border-t border-border flex justify-end gap-2">
                                      <button
                                        onClick={() => {
                                          setActiveTab("chat");
                                          setChatInput(`Regarding invoice ${inv.id} matching issue: `);
                                        }}
                                        className="text-[11px] font-semibold bg-amber-500 text-slate-950 px-3 py-1.5 rounded hover:bg-amber-400 transition-colors"
                                      >
                                        Ask Tax Officer for resolution
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                        {myInvoices.length === 0 && (
                          <tr>
                            <td colSpan={7}>
                              <EmptyState message="No invoices loaded." />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Alerts Tab */}
            {activeTab === "alerts" && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-lg font-bold">Fraud & Risk Alerts</h1>
                  <p className="text-xs text-muted-foreground">Suspicious matches flagged by ReconAI's graph neural networks and SHAP classifiers.</p>
                </div>

                <div className="space-y-4">
                  {myAlerts.map(alert => (
                    <div key={alert.id} className="bg-card border border-border rounded-xl p-5 space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="flex gap-3">
                          <div className="p-2 bg-red-50 dark:bg-red-950/20 text-red-600 rounded-lg">
                            <ShieldAlert size={18} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-muted-foreground">{alert.id}</span>
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 font-mono">
                                {alert.type}
                              </span>
                              <span className="text-xs font-semibold text-muted-foreground font-mono">Amt: {alert.amount}</span>
                            </div>
                            <h3 className="text-sm font-bold mt-1 text-foreground">{alert.details}</h3>
                            <p className="text-xs text-muted-foreground mt-1">{alert.desc}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">AI Anomaly Risk</div>
                          <div className="text-xl font-bold font-mono text-red-500">{alert.risk}/100</div>
                        </div>
                      </div>

                      <div className="border-t border-border pt-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock size={12} />
                          <span>Audit Status: <strong>{alert.status}</strong></span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setActiveTab("chat");
                              setChatInput(`I see fraud alert ${alert.id} (${alert.type}) flagged for ${alert.details}. What supporting docs are needed?`);
                            }}
                            className="text-xs font-semibold bg-amber-500 text-slate-950 px-3.5 py-1.5 rounded hover:bg-amber-400 transition-colors"
                          >
                            Clarify with Tax Officer
                          </button>
                          <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold border border-border bg-card hover:bg-muted px-3.5 py-1.5 rounded transition-colors">
                            Upload Clarification Receipt
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {myAlerts.length === 0 && (
                    <div className="bg-card border border-border rounded-xl">
                      <EmptyState message="No fraud or risk alerts loaded." />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Chat with CA Tab */}
            {activeTab === "chat" && (
              <div className="flex flex-col h-[calc(100vh-8rem)] bg-card border border-border rounded-xl overflow-hidden text-left">
                {/* Chat Header */}
                <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-muted/20">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center">
                      <User size={15} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-foreground">{managingCA}</h3>
                      <div className="text-[10px] text-emerald-600 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full" /> Advisor not connected
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono bg-card px-2.5 py-0.5 rounded border border-border">
                    Office ID: Not configured
                  </div>
                </div>

                {/* Chat Messages */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex gap-3 max-w-[80%] ${m.sender === "client" ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${m.sender === "client" ? "bg-amber-500 text-slate-950" : "bg-muted"}`}>
                        <User size={12} />
                      </div>
                      <div>
                        <div className={`p-3 rounded-lg text-xs leading-relaxed ${m.sender === "client"
                          ? "bg-amber-500 text-slate-950 font-medium"
                          : "bg-muted text-foreground border border-border"
                          }`}>
                          {m.text}
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5 font-mono px-1">
                          {m.time}
                        </div>
                      </div>
                    </div>
                  ))}
                  {messages.length === 0 && <EmptyState message="No messages yet." />}
                  <div ref={chatEndRef} />
                </div>

                {/* Input section */}
                <div className="p-3 border-t border-border bg-muted/10 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleSendMessage(); }}
                    placeholder="Ask your Tax Officer about matching reports, active anomalies, or compliance thresholds..."
                    className="flex-1 text-xs px-3.5 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="p-2.5 bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors shadow-sm"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Settings Tab */}
            {activeTab === "settings" && (
              <div className="max-w-2xl bg-card border border-border rounded-xl p-6 space-y-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h1 className="text-base font-bold flex items-center gap-2">
                      <Settings size={18} className="text-amber-500" />
                      Client Profile & Settings
                    </h1>
                    <p className="text-xs text-muted-foreground mt-0.5">Edit your organization profile, GSTIN number, and workspace preferences</p>
                  </div>
                  {profileSuccessMsg && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-semibold animate-in fade-in">
                      <CheckCheck size={14} />
                      <span>{profileSuccessMsg}</span>
                    </div>
                  )}
                </div>

                {/* 1. Editable Profile Form */}
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Edit3 size={13} className="text-amber-500" />
                      Business & Profile Information
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Authorized Person / Contact Name
                      </label>
                      <input
                        type="text"
                        value={formName}
                        onChange={e => setFormName(e.target.value)}
                        placeholder="e.g. Rajesh Sharma"
                        className="w-full text-xs px-3 py-2 bg-background border border-border rounded focus:outline-none focus:border-amber-500 font-medium"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Business / Trade Name
                      </label>
                      <input
                        type="text"
                        value={formFirmName}
                        onChange={e => setFormFirmName(e.target.value)}
                        placeholder="e.g. Bharat Tech Solutions Pvt. Ltd."
                        className="w-full text-xs px-3 py-2 bg-background border border-border rounded focus:outline-none focus:border-amber-500 font-medium"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        GSTIN Number (15 Characters)
                      </label>
                      <input
                        type="text"
                        value={formGstin}
                        maxLength={15}
                        onChange={e => setFormGstin(e.target.value.toUpperCase())}
                        placeholder="e.g. 27AADCB2230M1Z3"
                        className="w-full text-xs px-3 py-2 bg-background border border-border rounded focus:outline-none focus:border-amber-500 font-mono font-bold tracking-wider"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Contact Phone
                      </label>
                      <input
                        type="text"
                        value={formPhone}
                        onChange={e => setFormPhone(e.target.value)}
                        placeholder="e.g. +91 98765 43210"
                        className="w-full text-xs px-3 py-2 bg-background border border-border rounded focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Registered Email Address
                      </label>
                      <input
                        type="email"
                        value={formEmail}
                        onChange={e => setFormEmail(e.target.value)}
                        placeholder="e.g. client@domain.com"
                        className="w-full text-xs px-3 py-2 bg-background border border-border rounded focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Business City / Location
                      </label>
                      <input
                        type="text"
                        value={formCity}
                        onChange={e => setFormCity(e.target.value)}
                        placeholder="e.g. Mumbai, Maharashtra"
                        className="w-full text-xs px-3 py-2 bg-background border border-border rounded focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="flex items-center gap-2 text-xs font-semibold bg-amber-500 text-slate-950 px-4 py-2 rounded-lg hover:bg-amber-400 transition-colors shadow-sm disabled:opacity-50"
                    >
                      {savingProfile ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" />
                          <span>Saving Profile...</span>
                        </>
                      ) : (
                        <>
                          <Save size={13} />
                          <span>Save Profile Changes</span>
                        </>
                      )}
                    </button>
                    <span className="text-[11px] text-muted-foreground">Changes are saved to the database and persist on refresh.</span>
                  </div>
                </form>

                {/* 2. Assigned Tax Officer */}
                <div className="border-t border-border pt-4 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assigned Tax Officer</div>
                  <div className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-lg">
                    <div>
                      <div className="text-xs font-semibold">{managingCA}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{firmName}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCaChangeModal(true)}
                      className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                    >
                      Change Officer
                    </button>
                  </div>
                </div>

                {/* 3. Display Theme */}
                <div className="border-t border-border pt-4">
                  <div className="text-xs font-semibold mb-2">Display Theme</div>
                  <div className="flex gap-2">
                    {[
                      { label: "Light", val: false, icon: Sun },
                      { label: "Dark", val: true, icon: Moon }
                    ].map(themeOpt => {
                      const active = dark === themeOpt.val;
                      const Icon = themeOpt.icon;
                      return (
                        <button
                          key={themeOpt.label}
                          onClick={() => setDark(themeOpt.val)}
                          className={`flex items-center gap-2 px-4 py-2 border rounded-md text-xs font-semibold transition-colors ${active ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border hover:bg-muted"
                            }`}
                        >
                          <Icon size={13} />
                          <span>{themeOpt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </ErrorBoundary>

        </main>
      </div>

      {/* Tax Officer Change Request Modal */}
      {showCaChangeModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border text-card-foreground rounded-xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Building2 size={18} className="text-amber-500" /> Request Tax Officer Change
              </h3>
              <button onClick={() => setShowCaChangeModal(false)} className="p-1 hover:bg-muted rounded"><X size={15} /></button>
            </div>

            <p className="text-xs text-muted-foreground">
              Select a new Tax Officer. System Admin will review and allow the transfer of your client records.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1">Target Tax Officer</label>
                <select
                  value={selectedTargetCa}
                  onChange={e => setSelectedTargetCa(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">Select a Tax Officer...</option>
                  {caDirectory.map(ca => (
                    <option key={ca.id} value={ca.id}>
                      {ca.name} {ca.firmName ? `(${ca.firmName})` : ""} — {ca.email}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1">Reason for Transfer (Optional)</label>
                <textarea
                  value={changeReason}
                  onChange={e => setChangeReason(e.target.value)}
                  placeholder="State reason for changing Tax Officer..."
                  rows={3}
                  className="w-full text-xs px-3 py-2 bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCaChangeModal(false)} className="text-xs border border-border px-3 py-1.5 rounded hover:bg-muted">Cancel</button>
              <button
                onClick={async () => {
                  if (!selectedTargetCa) {
                    setClientNotice("Please select a target Tax Officer.");
                    return;
                  }
                  setSubmittingReq(true);
                  try {
                    await apiRequest("/api/ca-change-requests", {
                      method: "POST",
                      auth: true,
                      body: JSON.stringify({ requestedCaId: selectedTargetCa, reason: changeReason })
                    });
                    setClientNotice("Tax Officer Change Request submitted to System Admin for approval.");
                    setShowCaChangeModal(false);
                    fetchCaRequests();
                  } catch (err) {
                    setClientNotice(err instanceof Error ? err.message : "Request failed.");
                  } finally {
                    setSubmittingReq(false);
                  }
                }}
                disabled={submittingReq}
                className="text-xs bg-amber-500 text-slate-950 font-semibold px-4 py-1.5 rounded hover:bg-amber-400 disabled:opacity-50"
              >
                {submittingReq ? "Submitting..." : "Submit Request to Admin"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Document Re-upload Action Modal */}
      {activeReuploadItem && (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <Upload size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Re-upload Replacement Document</h3>
                  <p className="text-xs text-muted-foreground">Submit corrected file for Tax Officer review</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setActiveReuploadItem(null);
                  setReuploadFile(null);
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>

            {/* Document Context Card */}
            <div className="bg-muted/40 border border-border rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Invoice Reference:</span>
                <span className="font-mono font-bold text-foreground">
                  {activeReuploadItem.invoiceNo || activeReuploadItem.id || "N/A"}
                </span>
              </div>
              {activeReuploadItem.supplier && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Supplier / Counterparty:</span>
                  <span className="font-semibold text-foreground">{activeReuploadItem.supplier}</span>
                </div>
              )}
              {activeReuploadItem.taxPeriod && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Tax Period:</span>
                  <span className="font-mono text-primary font-bold">{activeReuploadItem.taxPeriod}</span>
                </div>
              )}
              {(activeReuploadItem.reason || activeReuploadItem.note) && (
                <div className="mt-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-[11px] text-amber-900 dark:text-amber-200">
                  <span className="font-bold block mb-0.5">⚠️ Tax Officer's Note:</span>
                  {activeReuploadItem.reason || activeReuploadItem.note}
                </div>
              )}
            </div>

            {/* File Upload Drop Area */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-foreground block">
                Select Replacement Document (PDF, Image, CSV, JSON)
              </label>
              <div
                onClick={() => {
                  const input = document.getElementById("client-reupload-file-input");
                  if (input) (input as HTMLInputElement).click();
                }}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${reuploadFile
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-border hover:border-amber-500/50 hover:bg-muted/40"
                  }`}
              >
                <input
                  id="client-reupload-file-input"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls,.json"
                  className="hidden"
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      setReuploadFile(e.target.files[0]);
                    }
                  }}
                />
                {reuploadFile ? (
                  <div className="space-y-1">
                    <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <CheckCircle2 size={20} />
                    </div>
                    <div className="text-xs font-bold text-foreground">{reuploadFile.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {(reuploadFile.size / 1024).toFixed(1)} KB · Ready to submit
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="w-10 h-10 mx-auto rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                      <FileUp size={20} />
                    </div>
                    <div className="text-xs font-semibold text-foreground">Click to browse or drop file here</div>
                    <div className="text-[10px] text-muted-foreground">
                      Supported: PDF, JPG, PNG, CSV, JSON (up to 25MB)
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setActiveReuploadItem(null);
                  setReuploadFile(null);
                }}
                className="text-xs border border-border bg-card hover:bg-muted px-4 py-2 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reuploadFile || isReuploading}
                onClick={() => {
                  if (reuploadFile && activeReuploadItem) {
                    handleExecuteReupload(reuploadFile, activeReuploadItem);
                  }
                }}
                className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2 rounded-xl shadow transition-colors disabled:opacity-50"
              >
                {isReuploading ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Uploading Replacement...</span>
                  </>
                ) : (
                  <>
                    <Upload size={13} />
                    <span>Submit Replacement Document</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
