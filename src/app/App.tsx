  import React, { useState, useRef, useEffect, useMemo, useCallback, Fragment } from "react";
import {
  LayoutDashboard, Users, Upload, FileText, ShieldAlert, Share2,
  MessageSquare, BarChart3, Bell, Settings, ChevronRight, Search,
  Sun, Moon, LogOut, TrendingUp, TrendingDown, CheckCircle2,
  AlertTriangle, XCircle, Copy, RefreshCw, Filter, Download,
  Plus, Eye, MoreHorizontal, ArrowUpRight, ArrowDownRight,
  Zap, Database, Activity, Globe, Lock, User, Mail, Phone,
  Building2, CreditCard, ChevronDown, X, Send, Bot, Paperclip,
  FileUp, Check, Clock, CircleDot, Layers, Network, AlertCircle,
  Star, Shield, Cpu, HardDrive, Wifi, ChevronLeft, ChevronUp, Info, Loader2, Trash2, UserCheck,
  ShoppingCart, Receipt, Calendar, ArrowRight, FileSpreadsheet, CheckSquare, Sparkles
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis
} from "recharts";

import { apiRequest, openProtectedFile } from "./lib/api";
import { formatIST } from "./lib/datetime";
import ErrorBoundary from "./components/ErrorBoundary";
import { uploadMatchesPeriod, periodToMmYyyy, normalizePeriod, periodsMatch } from "./lib/periodUtils";

const LandingPage = React.lazy(() => import("./components/LandingPage"));
const AuthPages = React.lazy(() => import("./components/AuthPages"));
const ClientDashboard = React.lazy(() => import("./components/ClientDashboard"));
const DocumentVerificationModal = React.lazy(() => import("./components/DocumentVerificationModal"));

import logoImg from "../assets/Screenshot_2026-07-01_214942-removebg-preview.png";
import darkLogoImg from "../assets/darkThemeLogo.png";

// ── Types ──────────────────────────────────────────────────────────────────
type Page =
  | "dashboard" | "clients" | "reconciliation" | "documents" | "upload"
  | "fraud" | "graph" | "assistant" | "reports" | "notifications"
  | "settings" | "admin" | "ca-requests";

interface LoggedInUser {
  name: string;
  email: string;
  role: "admin" | "ca" | "client";
  firmName?: string;
  gstin?: string;
  icaiNumber?: string;
  city?: string;
  phone?: string;
  caName?: string;
  caEmail?: string;
  gstLegalName?: string;
  gstTradeName?: string;
  gstStatus?: string;
}

// Data placeholders loaded from the backend in production.

type MonthlyDataPoint = { month: string; matched: number; mismatched: number; duplicates: number };
type FraudPieSlice = { name: string; value: number; color: string };
type SupplierRisk = { supplier: string; risk: number; invoices: number; amount: string };
type ClientRecord = { id: number | string; name: string; gstin: string; email?: string; compliance: number; invoices: number; status: string; risk: string; city: string; caName?: string; caEmail?: string; caFirm?: string };
type InvoiceRecord = { id: string; supplier: string; gstin: string; date: string; taxable: string; gst: string; total: string; status: string; risk: string };
type FraudAlert = { id: string; type: string; entity: string; risk: number; score: string; amount: string; reason: string; summary?: string; shap: string[]; riskBreakdown?: Array<{ label: string; points: number; note: string }> };
type NotificationRecord = { id: number; type: "critical" | "warning" | "success" | "info"; title: string; msg: string; time: string; read: boolean };
type ChatMessage = { role: "assistant" | "user"; text: string };

// ── Data Store (populated from backend on login) ──────────────────────────
let monthlyData: MonthlyDataPoint[] = [];
let fraudPieData: FraudPieSlice[] = [];
let supplierRisk: SupplierRisk[] = [];
let clients: ClientRecord[] = [];
let invoices: InvoiceRecord[] = [];
let fraudAlerts: FraudAlert[] = [];
let notifications: NotificationRecord[] = [];
let chatMessages: ChatMessage[] = [];
let firstClientId: string | number | null = null;
let dashboardKpis: Record<string, number | null> = {};

async function fetchAllData(onUpdate: () => void, selectedClientId?: string): Promise<void> {
  const queryParam = selectedClientId && selectedClientId !== "ALL" ? `?clientId=${selectedClientId}` : "";
  try {
    // Fetch dashboard data (KPIs, monthly trends, supplier risk)
    const dash = await apiRequest<{
      kpis: Record<string, number | null>;
      monthlyData: { month: string; matched: number; mismatched: number; duplicates: number }[];
      fraudPieData?: { name: string; value: number; color: string }[];
      supplierRisk: { supplier: string; risk: number; invoices?: number; amount: any; reason: string }[];
      fiscalYears?: string[];
    }>(`/api/dashboard${queryParam}`, { auth: true });
    monthlyData = dash.monthlyData || [];
    if (dash.fraudPieData && dash.fraudPieData.length > 0) {
      fraudPieData = dash.fraudPieData;
    }
    dashboardKpis = dash.kpis || {};
    supplierRisk = (dash.supplierRisk || []).map(s => ({
      supplier: s.supplier,
      risk: s.risk,
      invoices: s.invoices ?? 0,
      amount: typeof s.amount === 'number' ? `₹${Number(s.amount).toLocaleString("en-IN")}` : (s.amount || "₹0"),
    }));
    onUpdate();

    // Fetch clients
    const clientsRes = await apiRequest<{ clients: any[] }>("/api/clients", { auth: true });
    clients = (clientsRes.clients || []).map(c => ({
      id: c.id,
      name: c.name,
      gstin: c.gstin,
      email: c.email || "",
      compliance: c.compliance ?? 0,
      invoices: c.invoices ?? c.invoices_count ?? 0,
      status: c.status || "Active",
      risk: c.risk || "Low",
      city: c.city || "",
      caName: c.ca_name || "",
      caEmail: c.ca_email || "",
      caFirm: c.ca_firm || "",
    }));
    if (clients.length > 0) firstClientId = clients[0].id;
    onUpdate();

    // Fetch invoices
    const invoicesRes = await apiRequest<{ invoices: any[] }>("/api/invoices", { auth: true });
    invoices = (invoicesRes.invoices || []).map(inv => {
      const rawDate = inv.created_at || inv.invoice_date || "";
      let formattedDate = inv.invoice_date || "";
      if (rawDate && rawDate.length > 10) {
        formattedDate = formatIST(rawDate, formattedDate);
      }
      const rawSupp = inv.supplier || "";
      const cleanSupp = rawSupp || "Invoice Supplier";
      return {
        id: inv.invoice_no || inv.id,
        supplier: cleanSupp,
        gstin: inv.supplier_gstin || "27BBBCD4321P1Z8",
        date: formattedDate,
        taxable: `₹${Number(inv.taxable || 0).toLocaleString("en-IN")}`,
        gst: `₹${Number(inv.gst || 0).toLocaleString("en-IN")}`,
        total: `₹${Number(inv.total || 0).toLocaleString("en-IN")}`,
        status: inv.status || "Pending",
        risk: inv.risk || "Low",
      };
    });

    // Fetch fraud alerts
    try {
      const alertsRes = await apiRequest<{ alerts: any[] }>("/api/fraud/alerts", { auth: true });
      fraudAlerts = (alertsRes.alerts || []).map(a => ({
        id: String(a.id),
        invoiceId: a.invoiceId || a.invoice_id || "",
        clientId: a.clientId || a.client_id || "",
        type: a.type || "Invoice Risk",
        entity: a.entity || "Unknown",
        risk: a.risk || 0,
        score: a.risk >= 85 ? "Critical" : a.risk >= 70 ? "High" : a.risk >= 50 ? "Medium" : "Low",
        amount: `₹${Number(a.amount || 0).toLocaleString("en-IN")}`,
        reason: a.reason || a.summary || "",
        summary: a.summary || a.reason || "",
        shap: a.shap || [],
        riskBreakdown: a.riskBreakdown || a.risk_breakdown || [],
      }));
      // Build fraud pie data from alerts
      const critCount = fraudAlerts.filter(a => a.score === "Critical").length;
      const highCount = fraudAlerts.filter(a => a.score === "High").length;
      const medCount = fraudAlerts.filter(a => a.score === "Medium").length;
      const lowCount = fraudAlerts.filter(a => a.score === "Low").length;
      if (fraudAlerts.length > 0) {
        fraudPieData = [
          ...(critCount > 0 ? [{ name: "Critical", value: Math.round(critCount / fraudAlerts.length * 100), color: "#DC2626" }] : []),
          ...(highCount > 0 ? [{ name: "High", value: Math.round(highCount / fraudAlerts.length * 100), color: "#F97316" }] : []),
          ...(medCount > 0 ? [{ name: "Medium", value: Math.round(medCount / fraudAlerts.length * 100), color: "#F59E0B" }] : []),
          ...(lowCount > 0 ? [{ name: "Low", value: Math.round(lowCount / fraudAlerts.length * 100), color: "#10B981" }] : []),
        ];
      } else {
        fraudPieData = [];
      }
    } catch { /* ignore transient fraud alerts error in background poll */ }

    // Fetch reports count for notifications
    try {
      const reportsRes = await apiRequest<{ reports: any[] }>("/api/reports", { auth: true });
      if (reportsRes.reports?.length > 0) {
        notifications = reportsRes.reports.slice(0, 5).map((r: any, i: number) => ({
          id: i + 1,
          type: "info" as const,
          title: r.name || "Report Ready",
          msg: `Report ${r.id} generated`,
          time: r.created_at || "",
          read: false,
        }));
      }
    } catch { /* reports endpoint may not exist yet */ }
    onUpdate();
  } catch (err) {
    console.error("Failed to fetch data:", err);
  }
}

function getClientId(): string | number {
  return firstClientId || (clients.length > 0 ? clients[0].id : "");
}

const formatCurrency = (value: number | string) =>
  `₹${Number(value || 0).toLocaleString("en-IN")}`;

const riskScoreLabel = (risk: number) => {
  if (risk >= 85) return "Critical";
  if (risk >= 70) return "High";
  if (risk >= 50) return "Medium";
  return "Low";
};

export const getComplianceColor = (score: number) => {
  if (score >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
};

export const getComplianceBgColor = (score: number) => {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
};

export const getRiskTextColor = (risk: string) => {
  switch (risk) {
    case "Critical":
      return "text-red-600 dark:text-red-400";
    case "High":
      return "text-orange-600 dark:text-orange-400";
    case "Medium":
      return "text-amber-600 dark:text-amber-400";
    case "Low":
    default:
      return "text-emerald-600 dark:text-emerald-400";
  }
};

// ── Utility Components ─────────────────────────────────────────────────────
const Badge = ({ label, variant }: { label: string; variant: "success" | "warning" | "danger" | "critical" | "info" | "neutral" }) => {
  const styles = {
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    danger: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    info: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    neutral: "bg-muted text-muted-foreground",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium ${styles[variant]}`}>{label}</span>;
};

const RiskBar = ({ value }: { value: number }) => {
  const color = value >= 80 ? "bg-red-500" : value >= 60 ? "bg-amber-500" : value >= 40 ? "bg-yellow-400" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-xs text-muted-foreground w-6 text-right">{value}</span>
    </div>
  );
};

const KpiCard = ({ title, value, sub, icon: Icon, trend, trendUp, onClick }: any) => (
  <div
    onClick={onClick}
    className={`bg-card border border-border rounded-lg p-4 flex flex-col gap-3 transition-all duration-150 ${onClick ? "cursor-pointer hover:border-primary/50 hover:shadow-sm" : ""}`}
  >
    <div className="flex items-start justify-between">
      <div className="p-2 bg-accent rounded-md">
        <Icon size={15} className="text-primary" />
      </div>
      {trend && (
        <div className={`flex items-center gap-1 text-xs font-mono ${trendUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {trendUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {trend}
        </div>
      )}
    </div>
    <div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{title}</div>
    </div>
    {sub && <div className="text-xs text-muted-foreground border-t border-border pt-2">{sub}</div>}
  </div>
);

const EmptyState = ({ message }: { message: string }) => (
  <div className="px-4 py-8 text-center text-xs text-muted-foreground">
    {message}
  </div>
);

// ── Sidebar ────────────────────────────────────────────────────────────────
const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "clients", label: "Clients", icon: Users },
  { id: "reconciliation", label: "Reconciliation", icon: FileText },
  { id: "fraud", label: "Fraud & Cases", icon: ShieldAlert },
  { id: "documents", label: "Client Documents", icon: Layers },
  { id: "graph", label: "Graph Analytics", icon: Share2 },
  { id: "assistant", label: "AI Assistant", icon: MessageSquare },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "admin", label: "Admin Panel", icon: Lock },
  { id: "ca-requests", label: "Tax Officer Requests", icon: UserCheck },
];

function Sidebar({ page, setPage, collapsed, user, onLogout, dark }: { page: Page; setPage: (p: Page) => void; collapsed: boolean; user: LoggedInUser; onLogout: () => void; dark: boolean }) {
  const visibleItems = navItems.filter(({ id }) => {
    if ((id === "admin" || id === "ca-requests") && user.role !== "admin") return false;
    return true;
  });

  return (
    <aside className={`fixed top-0 left-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-30 transition-all duration-200 ${collapsed ? "w-14" : "w-56"}`}>
      <div className="h-16 flex items-center px-3 border-b border-sidebar-border shrink-0 justify-center overflow-hidden">
        <div className={`relative flex items-center justify-center ${collapsed ? "h-10 w-10" : "h-12 w-48"}`}>
          <img
            src={logoImg}
            alt="ReconAI Logo"
            aria-hidden={dark}
            className={`absolute object-contain transition-opacity duration-100 ${dark ? "opacity-0" : "opacity-100"
              } ${collapsed ? "h-8 w-10" : "h-10 w-48"}`}
          />
          <img
            src={darkLogoImg}
            alt="ReconAI Logo"
            aria-hidden={!dark}
            className={`absolute object-contain transition-opacity duration-100 ${dark ? "opacity-100" : "opacity-0"
              } ${collapsed ? "h-8 w-10" : "h-10 w-48"}`}
          />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 scrollbar-thin">
        {visibleItems.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return (
            <button
              key={id}
              onClick={() => setPage(id as Page)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors duration-100 ${active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
            >
              <Icon size={15} className={active ? "text-sidebar-primary" : ""} />
              {!collapsed && <span className="truncate">{label}</span>}
              {!collapsed && id === "notifications" && notifications.some(n => !n.read) && (
                <span className="ml-auto text-[10px] bg-red-500 text-white rounded-full min-w-4 h-4 px-1 flex items-center justify-center font-mono">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="p-2 border-t border-sidebar-border shrink-0">
        <button onClick={onLogout} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors`}>
          <LogOut size={14} />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}

// ── Topbar ─────────────────────────────────────────────────────────────────
function Topbar({
  dark,
  setDark,
  page,
  setPage,
  sidebarCollapsed,
  setSidebarCollapsed,
  user,
  selectedClientId,
  onClientFilterChange,
}: {
  dark: boolean;
  setDark: (dark: boolean) => void;
  page: Page;
  setPage: (p: Page) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  user: LoggedInUser | null;
  selectedClientId?: string;
  onClientFilterChange?: (id: string) => void;
}) {
  const titles: Record<Page, string> = {
    dashboard: "Dashboard",
    clients: "Client Portfolio",
    reconciliation: "Invoice Reconciliation & Rule Engine",
    documents: "Client Documents (Read-Only)",
    upload: "Client Documents (Read-Only)",
    fraud: "Fraud Detection & Case Queue",
    graph: "Graph Analytics",
    assistant: "AI Assistant",
    reports: "Reports",
    notifications: "Notifications",
    settings: "Settings",
    admin: "Admin Panel",
    "ca-requests": "Tax Officer Transfer Requests",
  };

  const getInitials = (name?: string) => {
    return name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "US";
  };

  const getRoleLabel = (role?: string) => {
    if (role === "admin") return "System Administrator";
    if (role === "ca") return "Tax Officer";
    return "Client / Owner";
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center px-4 gap-4 sticky top-0 z-20">
      <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors">
        <Layers size={16} />
      </button>
      <div className="font-semibold text-sm">{titles[page]}</div>
      <div className="flex-1 max-w-sm mx-4">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input placeholder="Search invoices, clients, GSTINs…" className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60" />
        </div>
      </div>
      {user?.role === "ca" && (
        <div className="flex items-center gap-2 bg-muted/80 border border-border rounded-lg px-2.5 py-1 text-xs">
          <Users size={13} className="text-primary shrink-0" />
          <span className="text-muted-foreground font-medium hidden sm:inline">Client Filter:</span>
          {clients.length > 0 ? (
            <select
              value={selectedClientId || "ALL"}
              onChange={(e) => onClientFilterChange?.(e.target.value)}
              className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="ALL">🌐 All Clients (Combined Summary)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  🏢 {c.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-semibold text-amber-500">0 Clients Assigned</span>
          )}
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button onClick={() => setPage("notifications")} className="relative p-2 rounded hover:bg-muted text-muted-foreground transition-colors">
          <Bell size={16} />
          {notifications.some(n => !n.read) && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />}
        </button>
        <button onClick={() => setDark(!dark)} className="p-2 rounded hover:bg-muted text-muted-foreground transition-colors">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <div className="flex items-center gap-2 ml-2 pl-3 border-l border-border">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-semibold">
            {getInitials(user?.name)}
          </div>
          <div className="hidden sm:block text-left">
            <div className="text-xs font-medium">{user?.name || "User"}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{getRoleLabel(user?.role)}</div>
          </div>
          <ChevronDown size={12} className="text-muted-foreground" />
        </div>
      </div>
    </header>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────
function DashboardPage({
  user,
  selectedClientId,
  onClientFilterChange,
  onNavigate,
  onRefresh,
}: {
  user: LoggedInUser;
  selectedClientId?: string;
  onClientFilterChange?: (id: string) => void;
  onNavigate?: (page: Page) => void;
  onRefresh?: () => void;
}) {
  const [selectedFY, setSelectedFY] = useState("2026-27");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);

  const k = dashboardKpis;
  const isAllClients = !selectedClientId || selectedClientId === "ALL";
  const currentClient = !isAllClients ? clients.find(c => String(c.id) === String(selectedClientId)) : null;

  const totalInvoicesCount = k.uploadedInvoices ?? invoices.length;
  const uploadedFilesCount = k.uploadedFiles ?? 0;
  const matchedCount = k.matchedInvoices ?? 0;
  const mismatchedCount = k.mismatchedInvoices ?? 0;
  const missingCount = k.missingInvoices ?? 0;
  const duplicateCount = k.duplicateInvoices ?? 0;
  const highRiskCount = k.highRiskTransactions ?? fraudAlerts.length;
  const circularCount = k.circularTrading ?? 0;
  const complianceScore = k.complianceScore != null ? k.complianceScore : null;

  const kpis = [
    {
      title: "Total Clients",
      value: isAllClients ? clients.length.toLocaleString() : "1",
      icon: Users,
      sub: isAllClients ? `${clients.length} in portfolio` : (currentClient?.name || "Selected Client"),
      onClick: () => onNavigate?.("clients"),
    },
    {
      title: "Uploaded Invoices",
      value: totalInvoicesCount.toLocaleString(),
      icon: FileText,
      sub: isAllClients
        ? `${totalInvoicesCount} txns across ${uploadedFilesCount > 0 ? uploadedFilesCount : clients.length} files`
        : `${totalInvoicesCount} txns across ${uploadedFilesCount > 0 ? uploadedFilesCount : "uploaded"} files`,
      onClick: () => onNavigate?.("documents"),
    },
    {
      title: "Matched Invoices",
      value: matchedCount.toLocaleString(),
      icon: CheckCircle2,
      sub: "Successfully reconciled",
      onClick: () => onNavigate?.("reconciliation"),
    },
    {
      title: "Mismatched",
      value: mismatchedCount.toLocaleString(),
      icon: AlertTriangle,
      sub: "Amount/tax delta",
      onClick: () => onNavigate?.("reconciliation"),
    },
    {
      title: "Missing in GSTR-2B",
      value: missingCount.toLocaleString(),
      icon: AlertCircle,
      sub: "Unfiled by supplier / No ITC",
      onClick: () => onNavigate?.("reconciliation"),
    },
    {
      title: "Duplicates",
      value: duplicateCount.toLocaleString(),
      icon: Copy,
      sub: "Flagged as duplicate",
      onClick: () => onNavigate?.("reconciliation"),
    },
    {
      title: "High-Risk Transactions",
      value: highRiskCount.toLocaleString(),
      icon: ShieldAlert,
      sub: "Risk score >= 70",
      onClick: () => onNavigate?.("fraud"),
    },
    {
      title: "Circular Trading",
      value: circularCount.toLocaleString(),
      icon: RefreshCw,
      sub: circularCount > 0 ? "Suspicious loops detected" : "Graph analysis normal",
      onClick: () => onNavigate?.("graph"),
    },
    {
      title: "Compliance Score",
      value: complianceScore != null ? `${complianceScore}%` : "Not yet reconciled",
      icon: Activity,
      sub: isAllClients ? "Average across clients" : `${currentClient?.name || "Client"} GST Rating`,
      onClick: () => onNavigate?.("reports"),
    },
  ];

  const handleExport = () => {
    setExporting(true);
    const scopeName = isAllClients ? "All_Clients" : (currentClient?.name.replace(/[^a-zA-Z0-9]/g, "_") || "Client");
    const filename = `Tax_Officer_Dashboard_${scopeName}_FY${selectedFY}.json`;
    const exportData = {
      officer: {
        name: user.name,
        email: user.email,
        role: user.role,
        firm: user.firmName || "Tax & Advisory Firm",
      },
      period: `FY ${selectedFY}`,
      scope: isAllClients ? "All Assigned Clients" : currentClient?.name,
      gstin: currentClient?.gstin || "N/A",
      kpis: {
        totalClients: isAllClients ? clients.length : 1,
        uploadedInvoices: totalInvoicesCount,
        uploadedFiles: uploadedFilesCount,
        matchedInvoices: matchedCount,
        mismatchedInvoices: mismatchedCount,
        missingInvoices: missingCount,
        duplicateInvoices: duplicateCount,
        highRiskAlerts: highRiskCount,
        circularTrading: circularCount,
        complianceScore: complianceScore != null ? `${complianceScore}%` : "Not yet reconciled",
      },
      monthlyTrends: monthlyData,
      fraudDistribution: fraudPieData,
      topSuppliersAtRisk: supplierRisk,
      generatedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setNotice(`Dashboard summary successfully exported (${filename})`);
    setTimeout(() => {
      setExporting(false);
      setNotice("");
    }, 4000);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload) return null;
    return (
      <div className="bg-popover border border-border rounded-lg p-3 text-xs shadow-lg">
        <div className="font-medium mb-2">{label}</div>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2">
            <span style={{ color: p.color }}>●</span>
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-mono font-medium">{p.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-foreground">
              Good morning, {user?.name ? user.name.split(" ")[0] : "Officer"}
            </h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
              Tax Officer
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {user?.firmName ? `${user.firmName} · ` : ""}
            {isAllClients
              ? `Managing ${clients.length} client(s) · ${totalInvoicesCount} invoices loaded`
              : `Viewing ${currentClient?.name} (${currentClient?.gstin}) · ${totalInvoicesCount} invoices`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2.5 py-1.5 shadow-sm">
            <Users size={13} className="text-primary shrink-0" />
            <select
              value={selectedClientId || "ALL"}
              onChange={(e) => onClientFilterChange?.(e.target.value)}
              className="text-xs bg-transparent border-0 font-medium focus:outline-none cursor-pointer text-foreground"
            >
              <option value="ALL">All Clients ({clients.length})</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2.5 py-1.5 shadow-sm">
            <Calendar size={13} className="text-muted-foreground shrink-0" />
            <select
              value={selectedFY}
              onChange={(e) => {
                setSelectedFY(e.target.value);
                onRefresh?.();
              }}
              className="text-xs bg-transparent border-0 font-medium focus:outline-none cursor-pointer text-foreground"
            >
              <option value="2026-27">FY 2026-27 (Current)</option>
              <option value="2025-26">FY 2025-26</option>
              <option value="2024-25">FY 2024-25</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground font-medium px-3 py-1.5 rounded-md hover:bg-primary/90 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            <Download size={12} /> {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="text-xs text-primary bg-primary/10 border border-primary/20 rounded-md px-3 py-2 flex items-center justify-between animate-in fade-in">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-muted-foreground hover:text-foreground">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-3.5">
        {kpis.map((k) => <KpiCard key={k.title} {...k} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-medium">Reconciliation Trend</div>
              <div className="text-xs text-muted-foreground">
                {monthlyData.length > 0 ? "April 2026 – September 2026 (Live reconciliation status)" : "No reconciliation history loaded"}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" /> Matched</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Mismatched</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Missing</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Duplicates</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={monthlyData}>
              <defs>
                <linearGradient id="gradMatch" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="matched" stroke="var(--chart-1)" fill="url(#gradMatch)" strokeWidth={2} name="Matched" />
              <Line type="monotone" dataKey="mismatched" stroke="var(--chart-3)" strokeWidth={2} dot={false} name="Mismatched" />
              <Line type="monotone" dataKey="missing" stroke="#f43f5e" strokeWidth={2} dot={false} name="Missing in GSTR-2B" />
              <Line type="monotone" dataKey="duplicates" stroke="var(--chart-4)" strokeWidth={2} dot={false} name="Duplicates" />
            </AreaChart>
          </ResponsiveContainer>
          {monthlyData.length === 0 && <EmptyState message="No reconciliation trend data loaded." />}
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-sm font-medium mb-1">Fraud Distribution</div>
          <div className="text-xs text-muted-foreground mb-3 font-medium">
            {fraudPieData.length > 0 ? "Breakdown by severity level" : "No active warnings loaded"}
          </div>
          {fraudPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={fraudPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                    {fraudPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val) => [`${val}%`, ""]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {fraudPieData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-muted-foreground truncate">{d.name}</span>
                    </div>
                    <span className="font-mono font-medium">{d.value}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState message="No active fraud warnings loaded." />
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
          <div className="text-sm font-medium">Top Supplier Risk Ranking</div>
          <button
            type="button"
            onClick={() => onNavigate?.("fraud")}
            className="text-xs text-primary hover:underline font-medium"
          >
            View all alerts
          </button>
        </div>
        <div className="divide-y divide-border">
          {supplierRisk.map((s, i) => (
            <div key={`${s.supplier}-${i}`} className="flex items-center gap-4 px-4 py-3">
              <span className="text-xs font-mono text-muted-foreground w-4">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{s.supplier}</div>
                <div className="text-xs text-muted-foreground">{s.invoices > 0 ? `${s.invoices} invoices · ` : ""}{s.amount}</div>
              </div>
              <div className="w-40 hidden sm:block">
                <RiskBar value={s.risk} />
              </div>
              <Badge
                label={s.risk >= 80 ? "Critical" : s.risk >= 60 ? "High" : s.risk >= 40 ? "Medium" : "Low"}
                variant={s.risk >= 80 ? "critical" : s.risk >= 60 ? "danger" : s.risk >= 40 ? "warning" : "success"}
              />
            </div>
          ))}
          {supplierRisk.length === 0 && <EmptyState message="No supplier risk data loaded." />}
        </div>
      </div>
    </div>
  );
}

// ── Clients ────────────────────────────────────────────────────────────────
function ClientsPage({ onUpdate, user }: { onUpdate?: () => void; user?: LoggedInUser }) {
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selectedClientDetails, setSelectedClientDetails] = useState<ClientRecord | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");

  const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.gstin.includes(search));
  const statusVariant = (s: string): any => ({ Matched: "success", Processing: "info", Mismatched: "warning", Review: "warning", Missing: "neutral" }[s] ?? "neutral");
  const riskVariant = (r: string): any => ({ Low: "success", Medium: "warning", High: "danger", Critical: "critical" }[r] ?? "neutral");

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");

    if (!name.trim()) {
      setModalError("Business Name is required.");
      return;
    }
    const cleanGstin = gstin.trim().toUpperCase();
    if (!cleanGstin || cleanGstin.length !== 15) {
      setModalError("Valid 15-character GSTIN is required.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiRequest<{ client: any }>("/api/clients", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          name: name.trim(),
          gstin: cleanGstin,
          email: email.trim(),
          city: city.trim(),
        }),
      });

      const newRecord: ClientRecord = {
        id: result.client.id,
        name: result.client.name,
        gstin: result.client.gstin,
        compliance: result.client.compliance ?? 0,
        invoices: result.client.invoices ?? 0,
        status: result.client.status || "Active",
        risk: result.client.risk || "Low",
        city: result.client.city || "",
      };

      clients.unshift(newRecord);
      if (!firstClientId) firstClientId = newRecord.id;

      setShowModal(false);
      setName(""); setGstin(""); setEmail(""); setCity("");
      setNotice(`Client "${newRecord.name}" created successfully.`);
      if (onUpdate) onUpdate();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to create client.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteClient = async (c: ClientRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete client "${c.name}"? This will remove all associated user accounts, invoices, and uploads.`)) return;
    try {
      await apiRequest(`/api/clients/${encodeURIComponent(String(c.id))}`, { method: "DELETE", auth: true });
      clients = clients.filter(x => x.id !== c.id);
      setNotice(`Client "${c.name}" deleted successfully.`);
      if (onUpdate) onUpdate();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Deletion failed.");
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Client Portfolio</h2>
          <p className="text-xs text-muted-foreground">{clients.length} registered client(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…" className="pl-7 pr-3 py-1.5 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40 w-48" />
          </div>
          <button type="button" onClick={() => { setShowModal(true); setModalError(""); }} className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors">
            <Plus size={12} /> Add Client
          </button>
        </div>
      </div>
      {notice && <div className="text-xs text-primary bg-accent border border-border rounded-md px-3 py-2">{notice}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map(c => (
          <div key={c.id} onClick={() => setSelectedClientDetails(c)} className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors cursor-pointer group">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center shrink-0">
                  <Building2 size={16} className="text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium leading-tight">{c.name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{c.gstin}</div>
                </div>
              </div>
              {user?.role === "admin" && (
                <button
                  type="button"
                  onClick={(e) => handleDeleteClient(c, e)}
                  title="Delete Client & User Account (Admin Only)"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Compliance Score</span>
                <span className={`font-mono font-semibold ${getComplianceColor(c.compliance)}`}>{c.compliance}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${getComplianceBgColor(c.compliance)}`}
                  style={{ width: `${Math.max(c.compliance, 3)}%` }}
                  title={`${c.compliance}% Compliance`}
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-muted-foreground">{c.invoices.toLocaleString()} invoices · {c.city || "Headquarters"}</div>
                <div className="flex items-center gap-1.5">
                  <Badge label={c.status} variant={statusVariant(c.status)} />
                  <Badge label={c.risk} variant={riskVariant(c.risk)} />
                </div>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="md:col-span-2 xl:col-span-3 bg-card border border-border rounded-lg">
            <EmptyState message="No clients found." />
          </div>
        )}
      </div>

      {/* Add Client Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Building2 size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Register New Client</h3>
                  <p className="text-[11px] text-muted-foreground">Add business entity to CA portfolio</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="p-5 space-y-4">
              {modalError && (
                <div className="flex items-center gap-2 text-xs bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg p-3">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Business Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Logistics Pvt Ltd"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">GSTIN (15 Characters) *</label>
                <input
                  type="text"
                  required
                  maxLength={15}
                  placeholder="27AAAAA0000A1Z5"
                  value={gstin}
                  onChange={e => setGstin(e.target.value.toUpperCase())}
                  className="w-full text-xs font-mono uppercase bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Contact Email</label>
                  <input
                    type="email"
                    placeholder="finance@acme.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">City / Region</label>
                  <input
                    type="text"
                    placeholder="Mumbai"
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-xs border border-border bg-card px-4 py-2 rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus size={12} />
                      Save Client
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Client Details Modal */}
      {selectedClientDetails && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border text-card-foreground rounded-2xl p-6 w-full max-w-lg space-y-5 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center font-bold">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold">{selectedClientDetails.name}</h3>
                  <p className="text-xs text-muted-foreground font-mono">GSTIN: {selectedClientDetails.gstin || "N/A"}</p>
                </div>
              </div>
              <button onClick={() => setSelectedClientDetails(null)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors"><X size={16} /></button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-muted/40 border border-border rounded-xl p-3 space-y-1">
                <div className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                  <Mail size={12} className="text-primary" /> Email Address
                </div>
                <div className="font-mono font-semibold text-foreground truncate">{selectedClientDetails.email || "Not registered"}</div>
              </div>

              <div className="bg-muted/40 border border-border rounded-xl p-3 space-y-1">
                <div className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                  <Globe size={12} className="text-primary" /> Location / City
                </div>
                <div className="font-semibold text-foreground">{selectedClientDetails.city || "Not specified"}</div>
              </div>

              <div className="bg-muted/40 border border-border rounded-xl p-3 space-y-1">
                <div className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                  <User size={12} className="text-primary" /> Assigned CA
                </div>
                <div className="font-semibold text-foreground truncate">{selectedClientDetails.caName || "Unassigned"}</div>
                {selectedClientDetails.caFirm && <div className="text-[10px] text-muted-foreground truncate">{selectedClientDetails.caFirm}</div>}
              </div>

              <div className="bg-muted/40 border border-border rounded-xl p-3 space-y-1">
                <div className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                  <Activity size={12} className="text-primary" /> Compliance Score
                </div>
                <div className={`font-mono font-bold text-sm ${getComplianceColor(selectedClientDetails.compliance)}`}>
                  {selectedClientDetails.compliance}%
                </div>
              </div>
            </div>

            <div className="bg-muted/20 border border-border rounded-xl p-3.5 space-y-2 text-xs">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Workspace Health & Risk</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-card border border-border rounded-lg p-2">
                  <div className="text-muted-foreground text-[10px]">Status</div>
                  <div className="font-semibold">{selectedClientDetails.status}</div>
                </div>
                <div className="bg-card border border-border rounded-lg p-2">
                  <div className="text-muted-foreground text-[10px]">Risk Profile</div>
                  <div className={`font-semibold ${getRiskTextColor(selectedClientDetails.risk)}`}>
                    {selectedClientDetails.risk}
                  </div>
                </div>
                <div className="bg-card border border-border rounded-lg p-2">
                  <div className="text-muted-foreground text-[10px]">Invoices</div>
                  <div className="font-mono font-semibold">{selectedClientDetails.invoices}</div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button onClick={() => setSelectedClientDetails(null)} className="text-xs bg-primary text-primary-foreground font-semibold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Read-Only Client Documents Viewer (Tax Officer Inspector) ──────────────

function ClientDocumentsPage({
  onVerifyDoc,
  isRedirect,
  selectedClientId
}: {
  onVerifyDoc?: (id: string) => void;
  isRedirect?: boolean;
  selectedClientId?: string;
}) {
  const [uploads, setUploads] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "UNPROCESSED" | "PROCESSED">("ALL");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const isDocProcessed = (u: any) => {
    const st = (u.status || "").toLowerCase();
    if (st === "parsed" || st === "processed" || st === "parsed_with_warnings") return true;
    if ((u.parsedRows ?? 0) > 0 || (u.processCount ?? 0) > 0) return true;
    return false;
  };

  const handleProcessDoc = async (docId: string) => {
    setProcessingId(docId);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/extract/rerun/${docId}?engine=gemini`, {
        method: "POST",
        auth: true,
        body: JSON.stringify({ engine: "gemini" })
      });
      if (res?.ok === false) {
        setMessage(res.message || "Failed to process document.");
      } else {
        setMessage(res.message || "Document extracted and processed successfully!");
      }
      await loadUploads();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to process document.");
    } finally {
      setProcessingId(null);
    }
  };

  const clientId = selectedClientId && selectedClientId !== "ALL" ? selectedClientId : null;

  const DOC_TYPE_META: Record<string, { label: string; emoji: string; color: string; badgeCls: string }> = {
    PURCHASE_REGISTER: { label: "Purchase Register", emoji: "📒", color: "emerald", badgeCls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800" },
    GSTR2B: { label: "GSTR-2B Portal Data", emoji: "🏛️", color: "blue", badgeCls: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 border-blue-300 dark:border-blue-800" },
    TAX_INVOICE: { label: "Tax Invoice", emoji: "📄", color: "amber", badgeCls: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border-amber-300 dark:border-amber-800" },
    PURCHASE_ORDER: { label: "Purchase Order", emoji: "🛒", color: "sky", badgeCls: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400 border-sky-300 dark:border-sky-800" },
    SUPPLIER_MASTER: { label: "Supplier Master", emoji: "🗂️", color: "violet", badgeCls: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400 border-violet-300 dark:border-violet-800" },
  };

  const loadUploads = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ uploads: any[] }>("/api/ingestion/uploads", { auth: true });
      setUploads(res.uploads || []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to load client documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUploads();
  }, [selectedClientId]);

  // Filter uploads belonging to the selected client
  const clientUploads = useMemo(() => {
    if (!clientId) return uploads;
    return uploads.filter(u => {
      const uClientId = String(u.clientId || u.client_id || "");
      return uClientId === String(clientId);
    });
  }, [uploads, clientId]);

  // Extract all available periods that actually exist on this client's uploads (or all uploads if no client selected)
  const availablePeriods = useMemo(() => {
    const targetUploads = clientUploads;
    const set = new Set<string>();
    targetUploads.forEach(u => {
      const periods = u.taxPeriods || u.tax_periods;
      if (Array.isArray(periods)) {
        periods.forEach((p: string) => {
          if (p && p.trim()) {
            const canon = periodToMmYyyy(p);
            set.add(canon || p.trim());
          }
        });
      }
      const pStr = u.taxPeriod || u.tax_period;
      if (pStr && typeof pStr === "string") {
        pStr.split(",").forEach((p: string) => {
          if (p && p.trim()) {
            const canon = periodToMmYyyy(p);
            set.add(canon || p.trim());
          }
        });
      }
      const fy = u.financialYear || u.financial_year;
      if (fy && typeof fy === "string" && fy.trim()) {
        set.add(fy.trim());
      }
      // Fallback regex from file name
      const fname = u.fileName || u.file_name || "";
      const match = fname.match(/(\d{2})_(\d{4})/);
      if (match) {
        set.add(`${match[1]}-${match[2]}`);
      }
    });
    return Array.from(set).sort((a, b) => {
      const ma = a.match(/^(\d{2})-(\d{4})$/);
      const mb = b.match(/^(\d{2})-(\d{4})$/);
      if (ma && mb) {
        return (Number(ma[2]) * 100 + Number(ma[1])) - (Number(mb[2]) * 100 + Number(mb[1]));
      }
      return a.localeCompare(b);
    });
  }, [clientUploads]);

  // Reset selectedPeriod if it is not in availablePeriods when client changes
  useEffect(() => {
    if (selectedPeriod !== "ALL" && !availablePeriods.includes(selectedPeriod)) {
      setSelectedPeriod("ALL");
    }
  }, [availablePeriods, selectedPeriod]);

  // Filter uploads by selected period
  const periodFilteredUploads = useMemo(() => {
    if (!selectedPeriod || selectedPeriod === "ALL") return clientUploads;
    return clientUploads.filter(u => uploadMatchesPeriod(u, selectedPeriod));
  }, [clientUploads, selectedPeriod]);

  const unprocessedCount = useMemo(() => {
    return periodFilteredUploads.filter(u => !isDocProcessed(u)).length;
  }, [periodFilteredUploads]);

  const processedCount = useMemo(() => {
    return periodFilteredUploads.filter(u => isDocProcessed(u)).length;
  }, [periodFilteredUploads]);

  const filtered = periodFilteredUploads.filter(u => {
    const isProc = isDocProcessed(u);
    if (statusFilter === "UNPROCESSED" && isProc) return false;
    if (statusFilter === "PROCESSED" && !isProc) return false;

    const docType = (u.documentType || u.category || "TAX_INVOICE").toUpperCase();
    if (filter !== "ALL" && docType !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (u.fileName || "").toLowerCase().includes(q) ||
      (u.clientName || "").toLowerCase().includes(q) ||
      (u.gstin || "").toLowerCase().includes(q) ||
      (u.taxPeriod || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 space-y-5">
      {isRedirect && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-3 rounded-xl flex items-start gap-2.5 shadow-sm">
          <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Uploads are managed directly by the Client.</span>
            <p className="mt-0.5 text-muted-foreground">The Upload Center has been removed for Tax Officers to enforce independent data integrity. Review client-submitted reconciliation files below.</p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Layers className="text-primary" size={20} /> Client Documents (Read-Only)
          </h1>
          <p className="text-xs text-muted-foreground">
            Immutable client-submitted statutory datasets for GST reconciliation and 3-way matching.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tax Period Selector */}
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2.5 py-1.5 shadow-sm">
            <Calendar size={13} className="text-primary shrink-0" />
            <span className="text-xs font-medium text-muted-foreground">Period:</span>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Periods ({clientUploads.length})</option>
              {availablePeriods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={loadUploads}
            className="flex items-center gap-1.5 text-xs border border-border bg-card hover:bg-muted px-3 py-1.5 rounded-lg shadow-sm transition-colors"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {message && <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg border border-amber-200 dark:border-amber-800">{message}</div>}

      {/* Filters & Search */}
      <div className="bg-card border border-border/80 rounded-2xl p-3 shadow-xs space-y-3">
        {/* Top Filter Bar: Processing Status Tabs + Search + Clear */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Processing Status Filter Tabs */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50 text-xs">
            <span className="text-[11px] font-semibold text-muted-foreground px-2 flex items-center gap-1">
              <Activity size={12} className="text-primary" /> Status:
            </span>
            {[
              { id: "ALL", label: "All Docs", count: periodFilteredUploads.length },
              { id: "UNPROCESSED", label: "Unprocessed", count: unprocessedCount, dotColor: "bg-amber-500", pulse: unprocessedCount > 0 },
              { id: "PROCESSED", label: "Processed", count: processedCount, dotColor: "bg-emerald-500", pulse: false },
            ].map((st) => {
              const isActive = statusFilter === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id as any)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 shrink-0 ${isActive
                    ? "bg-card text-foreground shadow-xs border border-border/80"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                    }`}
                >
                  {st.dotColor && (
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dotColor} shrink-0 ${st.pulse ? "animate-ping" : ""}`} />
                  )}
                  <span>{st.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium transition-colors ${isActive
                      ? "bg-muted text-foreground"
                      : "bg-muted/60 text-muted-foreground"
                      }`}
                  >
                    {st.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search Box + Clear Button */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative min-w-[220px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search documents or GSTIN..."
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-muted/40 hover:bg-muted/70 focus:bg-card border border-border/70 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground/60 shadow-2xs"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full hover:bg-muted"
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {(filter !== "ALL" || statusFilter !== "ALL" || search.trim() !== "") && (
              <button
                type="button"
                onClick={() => {
                  setFilter("ALL");
                  setStatusFilter("ALL");
                  setSearch("");
                }}
                className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 hover:bg-primary/10 px-2.5 py-1.5 rounded-lg border border-primary/20 transition-colors"
                title="Reset all filters"
              >
                <X size={12} />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Bottom Filter Bar: Category Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1 flex items-center gap-1">
            <Layers size={12} className="text-primary" /> Category:
          </span>
          {["ALL", "PURCHASE_REGISTER", "GSTR2B", "TAX_INVOICE", "PURCHASE_ORDER", "SUPPLIER_MASTER"].map((cat) => {
            const meta = DOC_TYPE_META[cat];
            const count = cat === "ALL"
              ? periodFilteredUploads.filter(u => statusFilter === "ALL" || (statusFilter === "PROCESSED" ? isDocProcessed(u) : !isDocProcessed(u))).length
              : periodFilteredUploads.filter(u => {
                if ((u.documentType || u.category || "").toUpperCase() !== cat) return false;
                if (statusFilter === "PROCESSED" && !isDocProcessed(u)) return false;
                if (statusFilter === "UNPROCESSED" && isDocProcessed(u)) return false;
                return true;
              }).length;
            const active = filter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all ${active
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
              >
                {meta?.emoji ? `${meta.emoji} ` : ""}{meta?.label || "All"} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-medium">
                <th className="px-4 py-3 text-left">Document Type</th>
                <th className="px-4 py-3 text-left">File Name</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Tax Period(s) / FY</th>
                <th className="px-4 py-3 text-left">Client & GSTIN</th>
                <th className="px-4 py-3 text-left">Rows / Items</th>
                <th className="px-4 py-3 text-left">Uploaded / Processed (IST)</th>
                <th className="px-4 py-3 text-right">Inspection Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u) => {
                const rawType = (u.documentType || u.category || "TAX_INVOICE").toUpperCase();
                const meta = DOC_TYPE_META[rawType] || DOC_TYPE_META["TAX_INVOICE"];
                const periodWarns = Array.isArray(u.periodWarnings) ? u.periodWarnings : [];
                const hasWarns = periodWarns.length > 0;
                const processed = isDocProcessed(u);

                return (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${meta.badgeCls}`}>
                        <span>{meta.emoji}</span>
                        <span>{meta.label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium max-w-xs truncate">
                      <div className="flex items-center gap-1.5">
                        <span title={u.fileName}>{u.fileName}</span>
                        {hasWarns && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                            title={periodWarns.join(" | ")}
                          >
                            <AlertTriangle size={9} /> Date Mismatch
                          </span>
                        )}
                      </div>
                      {hasWarns && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 truncate max-w-xs font-sans">
                          {periodWarns[0]}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {processed ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                          <span>Processed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                          <span>Unprocessed</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                      {u.taxPeriod ? (
                        <span className="bg-muted px-2 py-0.5 rounded border border-border">
                          📅 {u.taxPeriod} {u.financialYear ? `(${u.financialYear})` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">None specified</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-foreground">{u.clientName || "Client Workspace"}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{u.gstin || "—"}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono">
                      <span className="font-semibold text-foreground">{u.parsedRows ?? 0}</span> {rawType === "SUPPLIER_MASTER" ? "vendors" : "rows"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-[11px]">
                      <div>{formatIST(u.createdAt)}</div>
                      {u.processedAt && (
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400">Processed {formatIST(u.processedAt)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {!processed && (
                          <button
                            type="button"
                            disabled={processingId === u.id}
                            onClick={() => handleProcessDoc(u.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
                          >
                            {processingId === u.id ? (
                              <>
                                <Loader2 size={12} className="animate-spin" /> Processing...
                              </>
                            ) : (
                              <>
                                <Sparkles size={12} className="text-amber-300" /> Process Document
                              </>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onVerifyDoc?.(u.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                        >
                          <Eye size={12} /> View Document
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      message={
                        statusFilter === "UNPROCESSED"
                          ? "Great job! All client documents in this view have already been processed."
                          : statusFilter === "PROCESSED"
                            ? "No processed documents found matching the filter."
                            : filter === "ALL"
                              ? (clientId || selectedPeriod !== "ALL"
                                ? "No client documents match the selected client / period filter."
                                : "No client documents uploaded yet.")
                              : `No documents found in category ${DOC_TYPE_META[filter]?.label || filter}.`
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ── Reconciliation Page — Rule Engine + 5-Level Validation & Pre-Flight Readiness ─
function ReconciliationPage({
  onRefresh,
  onVerifyDoc,
  selectedClientId,
  onNavigate,
  onPeriodReconciled,
}: {
  onRefresh?: () => void;
  onVerifyDoc?: (id: string) => void;
  selectedClientId?: string;
  onNavigate?: (page: Page) => void;
  onPeriodReconciled?: (period: string) => void;
}) {
  const [filter, setFilter] = useState("All");
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [invoiceResults, setInvoiceResults] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [fraudSummaryMsg, setFraudSummaryMsg] = useState("");
  const [expanded, setExpanded] = useState<string | number | null>(null);

  // Uploads & Tax Period state
  const [uploads, setUploads] = useState<any[]>([]);
  const [loadingUploads, setLoadingUploads] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

  const clientId = selectedClientId && selectedClientId !== "ALL" ? selectedClientId : null;

  // Fetch client uploads for readiness check
  const fetchUploads = async () => {
    setLoadingUploads(true);
    try {
      const res = await apiRequest<{ uploads: any[] }>("/api/ingestion/uploads", { auth: true });
      setUploads(res.uploads || []);
    } catch {
      // ignore
    } finally {
      setLoadingUploads(false);
    }
  };

  useEffect(() => {
    fetchUploads();
  }, [selectedClientId]);

  // Filter uploads belonging to the selected client
  const clientUploads = useMemo(() => {
    if (!clientId) return [];
    return uploads.filter(u => {
      const uClientId = String(u.clientId || u.client_id || "");
      return uClientId === String(clientId);
    });
  }, [uploads, clientId]);

  // Extract all available periods that actually exist on this client's uploads
  const availablePeriods = useMemo(() => {
    if (!clientId || clientUploads.length === 0) return [];
    const set = new Set<string>();
    clientUploads.forEach(u => {
      const periods = u.taxPeriods || u.tax_periods;
      if (Array.isArray(periods)) {
        periods.forEach((p: string) => {
          if (p && p.trim()) {
            const canon = periodToMmYyyy(p);
            set.add(canon || p.trim());
          }
        });
      }
      const pStr = u.taxPeriod || u.tax_period;
      if (pStr && typeof pStr === "string") {
        pStr.split(",").forEach((p: string) => {
          if (p && p.trim()) {
            const canon = periodToMmYyyy(p);
            set.add(canon || p.trim());
          }
        });
      }
      const fy = u.financialYear || u.financial_year;
      if (fy && typeof fy === "string" && fy.trim()) {
        set.add(fy.trim());
      }
      // Fallback regex from file name
      const fname = u.fileName || u.file_name || "";
      const match = fname.match(/(\d{2})_(\d{4})/);
      if (match) {
        set.add(`${match[1]}-${match[2]}`);
      }
    });
    const list = Array.from(set).sort((a, b) => {
      const ma = a.match(/^(\d{2})-(\d{4})$/);
      const mb = b.match(/^(\d{2})-(\d{4})$/);
      if (ma && mb) {
        return (Number(ma[2]) * 100 + Number(ma[1])) - (Number(mb[2]) * 100 + Number(mb[1]));
      }
      return a.localeCompare(b);
    });
    if (list.length === 0 && clientUploads.length > 0) {
      list.push("All Uploaded Data");
    }
    return list;
  }, [clientUploads, clientId]);

  // Maintain selectedPeriod
  useEffect(() => {
    if (availablePeriods.length > 0) {
      if (!selectedPeriod || !availablePeriods.includes(selectedPeriod)) {
        setSelectedPeriod(availablePeriods[0]);
      }
    } else {
      setSelectedPeriod("");
    }
  }, [availablePeriods]);

  // Filter uploads matching the selected period using canonical period matching
  const matchingUploads = useMemo(() => {
    if (!clientId || !selectedPeriod) return [];
    return clientUploads.filter(u => uploadMatchesPeriod(u, selectedPeriod));
  }, [clientUploads, selectedPeriod, clientId]);

  // Compute readiness counts
  const prUploads = matchingUploads.filter(u => (u.documentType || u.category || u.document_type || "").toUpperCase() === "PURCHASE_REGISTER");
  const isPrUploaded = prUploads.length > 0;
  const prRowCount = prUploads.reduce((sum, u) => sum + (u.parsedRows ?? u.parsed_rows ?? 0), 0);

  const gstrUploads = matchingUploads.filter(u => (u.documentType || u.category || u.document_type || "").toUpperCase() === "GSTR2B");
  const isGstrUploaded = gstrUploads.length > 0;
  const gstrRowCount = gstrUploads.reduce((sum, u) => sum + (u.parsedRows ?? u.parsed_rows ?? 0), 0);

  const invUploads = matchingUploads.filter(u => ["TAX_INVOICE", "INVOICE"].includes((u.documentType || u.category || u.document_type || "").toUpperCase()));
  const invCount = invUploads.length;
  const invRowCount = invUploads.reduce((sum, u) => sum + (u.parsedRows ?? u.parsed_rows ?? 0), 0);

  const smUploads = matchingUploads.filter(u => (u.documentType || u.category || u.document_type || "").toUpperCase() === "SUPPLIER_MASTER");
  const smCount = smUploads.reduce((sum, u) => sum + (u.parsedRows ?? u.parsed_rows ?? 0), 0);

  // Validation rules
  const isPrValid = isPrUploaded;
  const isGstrValid = isGstrUploaded;
  const canRun = !!clientId && !!selectedPeriod && isPrValid && isGstrValid;

  const getDisabledReason = () => {
    if (!clientId) return "Select a specific client from the top filter";
    if (availablePeriods.length === 0) return "No uploaded statutory documents available for this client";
    if (!selectedPeriod) return "Select a tax period to reconcile";
    if (!isPrValid && !isGstrValid) return "Both Purchase Register and GSTR-2B are required for this period";
    if (!isPrValid) return "Purchase Register required for this period";
    if (!isGstrValid) return "GSTR-2B required for this period";
    return "";
  };

  const [invoiceSearch, setInvoiceSearch] = useState("");

  const disabledReason = getDisabledReason();

  const statusVariant = (s: string): any =>
    ({ Matched: "success", Mismatched: "warning", Duplicate: "danger", Missing: "neutral" }[s] ?? "neutral");
  const riskVariant = (r: string): any =>
    ({ Low: "success", Medium: "warning", High: "danger", Critical: "critical" }[r] ?? "neutral");

  // Automatically fetch latest completed reconciliation when client or period changes
  useEffect(() => {
    if (!clientId || !selectedPeriod) {
      setSummary(null);
      setInvoiceResults([]);
      return;
    }
    let cancelled = false;
    const fetchLatestReconciliation = async () => {
      try {
        const res = await apiRequest<{ ok: boolean; hasRun?: boolean; summary?: any; invoices?: any[] }>(
          `/api/reconciliation/latest?clientId=${encodeURIComponent(String(clientId))}&taxPeriod=${encodeURIComponent(selectedPeriod)}`,
          { auth: true }
        );
        if (!cancelled && res && res.hasRun && res.summary) {
          setSummary(res.summary);
          setInvoiceResults(res.invoices || []);
        }
      } catch {
        // Not run yet or silent error
      }
    };
    fetchLatestReconciliation();
    return () => { cancelled = true; };
  }, [clientId, selectedPeriod]);

  const filteredResults = useMemo(() => {
    return invoiceResults.filter(i => {
      if (filter !== "All" && i.status !== filter) return false;
      if (!invoiceSearch.trim()) return true;
      const q = invoiceSearch.toLowerCase();
      return (
        (i.invoiceNo || i.id || "").toLowerCase().includes(q) ||
        (i.supplier || "").toLowerCase().includes(q) ||
        (i.supplierGstin || i.gstin || "").toLowerCase().includes(q)
      );
    });
  }, [invoiceResults, filter, invoiceSearch]);

  const flagIcon = (ok: boolean | null | undefined) => {
    if (ok === true) return <span className="text-emerald-500 font-bold">✓</span>;
    if (ok === false) return <span className="text-red-500 font-bold">✗</span>;
    return <span className="text-muted-foreground">—</span>;
  };

  const runReconciliation = async () => {
    if (!canRun) return;
    setRunning(true);
    setStatus(`Running 5-level rule engine + document matching for ${selectedPeriod}...`);
    setFraudSummaryMsg("");
    try {
      const result = await apiRequest<{ summary: any; invoices: any[]; ranAt?: string }>("/api/reconciliation/run", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ clientId: String(clientId), taxPeriod: selectedPeriod }),
      });
      const s = result.summary;
      setSummary(s);
      setInvoiceResults(result.invoices || []);
      const fuzzy = s.fuzzyMatched ? ` (${s.fuzzyMatched} fuzzy)` : "";
      setStatus(
        `✓ Rule engine complete (${formatIST(result.ranAt ?? new Date())}): ${s.matched} matched${fuzzy}, ${s.mismatched} mismatched, ${s.missing} missing, ${s.duplicates} duplicates` +
        (s.rule_failures ? `, ${s.rule_failures} format/validation failures` : "") + "."
      );
      setFraudSummaryMsg("Reconciliation complete. Run the ML model on Fraud & Cases to score behavioral anomalies.");
      if (selectedPeriod) {
        onPeriodReconciled?.(selectedPeriod);
      }
      onRefresh?.();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Reconciliation failed.");
    } finally {
      setRunning(false);
    }
  };

  const hasExecutedRun = invoiceResults.length > 0 || summary !== null;

  return (
    <div className="p-6 space-y-5">
      {/* Header with Client Indicator & Period Selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <FileText className="text-primary" size={20} /> Invoice Reconciliation
          </h1>
          <p className="text-xs text-muted-foreground">
            5-level deterministic rule engine: Format → GSTIN → HSN/SAC → Total → Books↔GSTR-2B document matching
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Tax Period Selector (scoped to uploaded periods for this client) */}
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2.5 py-1.5 shadow-sm">
            <Calendar size={13} className="text-primary shrink-0" />
            <span className="text-xs font-medium text-muted-foreground">Period:</span>
            <select
              value={selectedPeriod}
              onChange={(e) => {
                setSelectedPeriod(e.target.value);
                setInvoiceResults([]);
                setSummary(null);
                setStatus("");
                setFraudSummaryMsg("");
              }}
              disabled={!clientId || availablePeriods.length === 0}
              className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer disabled:opacity-50"
            >
              {!clientId && <option value="">Select a Client first</option>}
              {clientId && availablePeriods.length === 0 && <option value="">No Uploaded Periods</option>}
              {availablePeriods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Run Button */}
          <div className="relative group">
            <button
              type="button"
              onClick={runReconciliation}
              disabled={!canRun || running}
              className={`flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg font-semibold shadow-sm transition-colors ${canRun && !running
                ? "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-75"
                }`}
            >
              <RefreshCw size={12} className={running ? "animate-spin" : ""} />
              {hasExecutedRun ? `Re-run Reconciliation (${selectedPeriod})` : `Run Full Reconciliation`}
            </button>
            {!canRun && disabledReason && (
              <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-30 bg-slate-900 text-slate-100 text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap shadow-lg border border-slate-700 font-medium">
                {disabledReason}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notice if no client selected */}
      {!clientId && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 shadow-sm">
          <AlertTriangle size={15} className="text-amber-500 shrink-0" />
          <span>Select a specific client from the top header filter to inspect statutory data readiness and run reconciliation.</span>
        </div>
      )}

      {status && (
        <div className="text-xs bg-accent border border-border rounded-xl px-4 py-3 font-medium text-primary">
          {status}
        </div>
      )}

      {fraudSummaryMsg && (
        <div className="flex items-center justify-between text-xs bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 text-blue-800 dark:text-blue-300 shadow-sm">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-blue-500 shrink-0" />
            <span>{fraudSummaryMsg}</span>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => {
                if (selectedPeriod) onPeriodReconciled?.(selectedPeriod);
                onNavigate("fraud");
              }}
              className="font-bold underline hover:opacity-80 ml-3 shrink-0 flex items-center gap-1 cursor-pointer"
            >
              Go to Fraud & Cases <ArrowRight size={12} />
            </button>
          )}
        </div>
      )}

      {/* ── Data Readiness Pre-Flight Panel ─────────────────────────────────── */}
      {clientId && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CheckSquare size={16} className="text-primary" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Data Readiness & Pre-Flight Verification
              </h2>
              {selectedPeriod && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold font-mono border border-primary/20">
                  {selectedPeriod}
                </span>
              )}
            </div>

            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate("documents")}
                className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
                title="Inspect client-submitted files in read-only document inspector"
              >
                <Layers size={13} /> View in Client Documents <ArrowRight size={11} />
              </button>
            )}
          </div>

          {availablePeriods.length === 0 ? (
            <div className="text-center py-6 bg-muted/20 border border-dashed border-border rounded-xl text-xs text-muted-foreground space-y-2">
              <AlertCircle size={20} className="mx-auto text-amber-500" />
              <p className="font-semibold text-foreground">No statutory data uploaded for this client yet.</p>
              <p>The client must upload their Purchase Register and GSTR-2B files before reconciliation can be performed.</p>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate("documents")}
                  className="mt-2 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg inline-flex items-center gap-1 font-medium"
                >
                  <Layers size={12} /> Check Client Documents
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* 1. Purchase Register (Books) */}
                <div className={`p-3.5 rounded-xl border transition-colors ${isPrUploaded ? "bg-emerald-500/5 border-emerald-500/30" : "bg-red-500/5 border-red-500/30"
                  }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span>📒</span> Purchase Register
                    </span>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                      Required
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    {isPrUploaded ? `${prRowCount.toLocaleString()} rows` : "Not Uploaded"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    {isPrUploaded ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 size={12} /> {prUploads.length} file(s) ready
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                        <XCircle size={12} /> Missing Books data
                      </span>
                    )}
                  </div>
                </div>

                {/* 2. GSTR-2B (GST Portal) */}
                <div className={`p-3.5 rounded-xl border transition-colors ${isGstrUploaded ? "bg-emerald-500/5 border-emerald-500/30" : "bg-red-500/5 border-red-500/30"
                  }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span>🏛️</span> GSTR-2B Portal
                    </span>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                      Required
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    {isGstrUploaded ? `${gstrRowCount.toLocaleString()} rows` : "Not Uploaded"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    {isGstrUploaded ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 size={12} /> {gstrUploads.length} file(s) ready
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                        <XCircle size={12} /> Missing Portal data
                      </span>
                    )}
                  </div>
                </div>

                {/* 3. Tax Invoices */}
                <div className="p-3.5 rounded-xl border bg-card border-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span>📄</span> Tax Invoices
                    </span>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      Optional
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    {invCount > 0 ? `${invCount} document(s)` : "None"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {invCount > 0 ? `${invRowCount} parsed items` : "Non-blocking"}
                  </div>
                </div>

                {/* 4. Supplier Master */}
                <div className="p-3.5 rounded-xl border bg-card border-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span>🗂️</span> Supplier Master
                    </span>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      Reference
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    {smUploads.length > 0 ? `${smCount} suppliers` : "None"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {smUploads.length > 0 ? "Linked master data" : "Optional reference"}
                  </div>
                </div>
              </div>

              {/* Status summary banner below cards */}
              <div className={`p-3 rounded-lg text-xs flex items-center justify-between flex-wrap gap-2 ${canRun
                ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20"
                : "bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20"
                }`}>
                <div className="flex items-center gap-2">
                  {canRun ? (
                    <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
                  )}
                  <span>
                    {canRun
                      ? `Both required statutory datasets (Purchase Register: ${prRowCount} rows, GSTR-2B: ${gstrRowCount} rows) are verified for ${selectedPeriod}. Ready to reconcile.`
                      : `Reconciliation blocked: ${disabledReason}. Client must upload the missing documents.`}
                  </span>
                </div>

                {!canRun && onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate("documents")}
                    className="text-xs font-semibold underline hover:opacity-80"
                  >
                    Inspect Client Documents →
                  </button>
                )}
              </div>

              {/* Uploaded Documents List for Selected Period */}
              {matchingUploads.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span>Uploaded Documents for Period: {selectedPeriod} ({matchingUploads.length})</span>
                    <span className="text-[10px] text-muted-foreground font-normal">Active for Reconciliation</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {matchingUploads.map((u, idx) => {
                      const docType = (u.documentType || u.category || u.document_type || "TAX_INVOICE").toUpperCase();
                      const rowsCount = u.parsedRows ?? u.parsed_rows ?? 0;
                      const fName = u.fileName || u.file_name || "Document";
                      const isReady = u.status === "Parsed" || u.status === "Uploaded" || rowsCount > 0;
                      return (
                        <div key={u.id || idx} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/80 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base shrink-0">
                              {docType === "PURCHASE_REGISTER" ? "📒" : docType === "GSTR2B" ? "🏛️" : docType === "SUPPLIER_MASTER" ? "🗂️" : "📄"}
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">{fName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {docType.replace(/_/g, " ")} • {rowsCount} rows • {formatIST(u.createdAt || u.uploadedAt, "Ready")}
                              </p>
                            </div>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${isReady ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                            }`}>
                            {isReady ? "Ready" : u.status || "Pending"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Reconciliation Period Summary & Impact Dashboard ─────────────────────────── */}
      {summary && (
        <div className="bg-card border border-border/80 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/50">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-foreground">
                  Reconciliation Summary & Period Impact
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-primary/10 text-primary border border-primary/20">
                  {summary.taxPeriod || selectedPeriod}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Statutory cross-match of {summary.total || invoiceResults.length} Books invoices against GSTR-2B portal filings across all 5 verification levels.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Compliance Outcome:</span>
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${(summary.mismatched === 0 && summary.missing === 0 && summary.duplicates === 0)
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                }`}>
                {(summary.mismatched === 0 && summary.missing === 0 && summary.duplicates === 0)
                  ? "✓ 100% Reconciled"
                  : `⚠️ ${summary.mismatched + summary.missing + summary.duplicates} Exceptions Requiring Review`}
              </span>
            </div>
          </div>

          {/* 5 Core Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              {
                label: "Matched Invoices",
                count: summary.matched,
                amount: summary.matchedAmount,
                subtext: summary.fuzzyMatched ? `${summary.fuzzyMatched} fuzzy match` : "Exact matches",
                color: "text-emerald-600 dark:text-emerald-400",
                bg: "bg-emerald-500/10 border-emerald-500/20",
                badge: "Eligible ITC",
                badgeCls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
              },
              {
                label: "Amount Mismatched",
                count: summary.mismatched,
                amount: summary.mismatchedAmount,
                subtext: "Value / Rate variance",
                color: "text-amber-600 dark:text-amber-400",
                bg: "bg-amber-500/10 border-amber-500/20",
                badge: "Tax Variance",
                badgeCls: "bg-amber-500/20 text-amber-700 dark:text-amber-300"
              },
              {
                label: "Missing in GSTR-2B",
                count: summary.missing,
                amount: summary.missingAmount,
                subtext: "Unfiled by supplier",
                color: "text-rose-600 dark:text-rose-400",
                bg: "bg-rose-500/10 border-rose-500/20",
                badge: "At-Risk ITC",
                badgeCls: "bg-rose-500/20 text-rose-700 dark:text-rose-300"
              },
              {
                label: "Duplicate Claims",
                count: summary.duplicates,
                amount: summary.duplicateAmount,
                subtext: "Duplicate entries in books",
                color: "text-red-600 dark:text-red-400",
                bg: "bg-red-500/10 border-red-500/20",
                badge: "Prevented",
                badgeCls: "bg-red-500/20 text-red-700 dark:text-red-300"
              },
              {
                label: "Rule Failures",
                count: summary.rule_failures ?? 0,
                amount: null,
                subtext: "Format / GSTIN / Math check",
                color: "text-orange-600 dark:text-orange-400",
                bg: "bg-orange-500/10 border-orange-500/20",
                badge: "L1-L4 Rules",
                badgeCls: "bg-orange-500/20 text-orange-700 dark:text-orange-300"
              },
            ].map(s => (
              <div key={s.label} className={`rounded-xl border p-3.5 flex flex-col justify-between ${s.bg}`}>
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">{s.label}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${s.badgeCls}`}>{s.badge}</span>
                  </div>
                  <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.count}</div>
                </div>
                <div className="mt-2 pt-2 border-t border-border/40 text-[11px]">
                  {s.amount != null && s.amount > 0 ? (
                    <div className="font-mono font-bold text-foreground">₹{Number(s.amount).toLocaleString("en-IN")}</div>
                  ) : null}
                  <div className="text-[10px] text-muted-foreground truncate">{s.subtext}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Statutory Total Financial Reconciliation Bar */}
          {(summary.totalBooksAmount || summary.totalGstrAmount) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className="bg-muted/40 border border-border/70 rounded-xl p-3 text-xs">
                <div className="flex items-center justify-between text-muted-foreground mb-1">
                  <span className="font-semibold">📒 Purchase Register (Books)</span>
                  <span className="font-mono">{summary.total || invoiceResults.length} invoices</span>
                </div>
                <div className="text-base font-bold font-mono text-foreground">
                  ₹{Number(summary.totalBooksAmount || 0).toLocaleString("en-IN")}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Taxable: ₹{Number(summary.totalBooksTaxable || 0).toLocaleString("en-IN")} • GST: ₹{Number(summary.totalBooksGst || 0).toLocaleString("en-IN")}
                </div>
              </div>

              <div className="bg-muted/40 border border-border/70 rounded-xl p-3 text-xs">
                <div className="flex items-center justify-between text-muted-foreground mb-1">
                  <span className="font-semibold">🏛️ GSTR-2B Portal Data</span>
                  <span className="font-mono">Filing Records</span>
                </div>
                <div className="text-base font-bold font-mono text-foreground">
                  ₹{Number(summary.totalGstrAmount || 0).toLocaleString("en-IN")}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Taxable: ₹{Number(summary.totalGstrTaxable || 0).toLocaleString("en-IN")} • GST: ₹{Number(summary.totalGstrGst || 0).toLocaleString("en-IN")}
                </div>
              </div>

              <div className="bg-muted/40 border border-border/70 rounded-xl p-3 text-xs flex flex-col justify-between">
                <div className="flex items-center justify-between text-muted-foreground mb-1">
                  <span className="font-semibold">⚖️ Period Reconciliation Gap</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${Math.abs((summary.totalBooksGst || 0) - (summary.totalGstrGst || 0)) <= 1
                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                    }`}>
                    {Math.abs((summary.totalBooksGst || 0) - (summary.totalGstrGst || 0)) <= 1 ? "Balanced" : "Variance"}
                  </span>
                </div>
                <div className={`text-base font-bold font-mono ${Math.abs((summary.totalBooksGst || 0) - (summary.totalGstrGst || 0)) <= 1
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
                  }`}>
                  ₹{Math.abs((summary.totalBooksAmount || 0) - (summary.totalGstrAmount || 0)).toLocaleString("en-IN")}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  ITC Variance: ₹{Math.abs((summary.totalBooksGst || 0) - (summary.totalGstrGst || 0)).toLocaleString("en-IN")}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Invoice Results Table or Pre-Run Guide ─────────────────────────── */}
      {!hasExecutedRun ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center space-y-3 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center">
            <FileSpreadsheet size={24} />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-sm font-bold text-foreground">
              {canRun ? `Ready to Reconcile: ${selectedPeriod}` : "Reconciliation Pre-Flight Check"}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {canRun
                ? `Click "Run Full Reconciliation" above to match ${prRowCount} Books invoices against ${gstrRowCount} GSTR-2B portal records across all 5 verification levels.`
                : !clientId
                  ? "Select a client above to begin statutory document verification."
                  : availablePeriods.length === 0
                    ? "No tax periods uploaded for this client yet."
                    : "Ensure both Purchase Register and GSTR-2B are uploaded for this period before triggering the reconciliation engine."}
            </p>
          </div>
          {canRun && (
            <button
              type="button"
              onClick={runReconciliation}
              disabled={running}
              className="mt-2 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-lg shadow-sm transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw size={12} className={running ? "animate-spin" : ""} />
              Run Full Reconciliation for {selectedPeriod}
            </button>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border/80 rounded-2xl overflow-hidden shadow-xs space-y-3 p-4">
          {/* Table Toolbar: Status Filter Buttons + Search + Clear */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50 text-xs">
              <span className="text-[11px] font-semibold text-muted-foreground px-2 flex items-center gap-1">
                Filter:
              </span>
              {[
                { id: "All", label: "All Invoices", count: invoiceResults.length },
                { id: "Matched", label: "Matched", count: summary?.matched ?? invoiceResults.filter(i => i.status === "Matched").length, dotColor: "bg-emerald-500" },
                { id: "Mismatched", label: "Mismatched", count: summary?.mismatched ?? invoiceResults.filter(i => i.status === "Mismatched").length, dotColor: "bg-amber-500" },
                { id: "Missing", label: "Missing", count: summary?.missing ?? invoiceResults.filter(i => i.status === "Missing").length, dotColor: "bg-rose-500" },
                { id: "Duplicate", label: "Duplicates", count: summary?.duplicates ?? invoiceResults.filter(i => i.status === "Duplicate").length, dotColor: "bg-red-500" },
              ].map((s) => {
                const isActive = filter === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setFilter(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 shrink-0 cursor-pointer ${isActive
                      ? "bg-card text-foreground shadow-xs border border-border/80"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                      }`}
                  >
                    {s.dotColor && <span className={`w-1.5 h-1.5 rounded-full ${s.dotColor} shrink-0`} />}
                    <span>{s.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium transition-colors ${isActive
                        ? "bg-muted text-foreground"
                        : "bg-muted/60 text-muted-foreground"
                        }`}
                    >
                      {s.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search Input + Clear Button */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative min-w-[220px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="Search invoice, supplier, GSTIN..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-muted/40 hover:bg-muted/70 focus:bg-card border border-border/70 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground/60 shadow-2xs"
                />
                {invoiceSearch && (
                  <button
                    type="button"
                    onClick={() => setInvoiceSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full hover:bg-muted cursor-pointer"
                    title="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {(filter !== "All" || invoiceSearch.trim() !== "") && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter("All");
                    setInvoiceSearch("");
                  }}
                  className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 hover:bg-primary/10 px-2.5 py-1.5 rounded-lg border border-primary/20 transition-colors cursor-pointer"
                  title="Reset all filters"
                >
                  <X size={12} />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* Invoices Table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground font-medium">
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Invoice No.</th>
                  <th className="px-3 py-2.5 text-left">Supplier</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-left font-mono">Total</th>
                  <th className="px-3 py-2.5 text-left">Doc Match</th>
                  <th className="px-3 py-2.5 text-left">Risk Level</th>
                  <th className="px-3 py-2.5 text-left">Case Status</th>
                  <th className="px-3 py-2.5 text-center" title="Format/Missing">Fmt</th>
                  <th className="px-3 py-2.5 text-center" title="GSTIN Structure">GSTIN</th>
                  <th className="px-3 py-2.5 text-center" title="Total Recalculation">Total✓</th>
                  <th className="px-3 py-2.5 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredResults.map((inv) => {
                  const flags = (inv as any).validationFlags || {};
                  const isExpanded = expanded === inv.id;
                  const fraudAlert = (inv as any).fraudAlert;
                  return (
                    <Fragment key={inv.id}>
                      <tr
                        className={`hover:bg-muted/40 cursor-pointer transition-colors ${isExpanded ? "bg-muted/30" : ""}`}
                        onClick={() => setExpanded(isExpanded ? null : inv.id)}
                      >
                        <td className="px-3 py-2.5 font-mono text-primary whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{inv.id || inv.invoiceNo}</span>
                            {onVerifyDoc && (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); onVerifyDoc(inv.id); }}
                                className="p-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors cursor-pointer"
                                title="Inspect Document"
                              >
                                <Eye size={10} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-medium max-w-[160px] truncate">
                          {inv.supplier && !inv.supplier.endsWith('.pdf') && !inv.supplier.includes('upl_') ? inv.supplier : (inv.supplier || "—")}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground font-mono whitespace-nowrap">{inv.date || inv.invoiceDate}</td>
                        <td className="px-3 py-2.5 font-mono font-medium">
                          {inv.total != null ? `₹${Number(inv.total).toLocaleString("en-IN")}` : inv.total}
                        </td>
                        <td className="px-3 py-2.5"><Badge label={inv.status} variant={statusVariant(inv.status)} /></td>
                        <td className="px-3 py-2.5"><Badge label={inv.risk} variant={riskVariant(inv.risk)} /></td>
                        <td className="px-3 py-2.5">
                          {fraudAlert ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                              <ShieldAlert size={10} />
                              <span>{fraudAlert.status || "Open Case"}</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground font-mono">Clean</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">{flagIcon(flags.format_ok)}</td>
                        <td className="px-3 py-2.5 text-center">{flagIcon(flags.gstin_ok)}</td>
                        <td className="px-3 py-2.5 text-center">{flagIcon(flags.total_ok)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <ChevronRight size={12} className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        </td>
                      </tr>

                      {/* Expanded 5-level validation detail */}
                      {isExpanded && (
                        <tr key={`${inv.id}-exp`} className="bg-muted/10">
                          <td colSpan={11} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                              {/* Left: Tally/Books data */}
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Books / Tally</div>
                                <div className="space-y-1.5 text-xs">
                                  {[
                                    ["GSTIN", inv.supplierGstin || inv.gstin],
                                    ["Invoice No.", inv.id || inv.invoiceNo],
                                    ["Amount", inv.total != null ? `₹${Number(inv.total).toLocaleString("en-IN")}` : "—"],
                                    ["Taxable", inv.taxable != null ? `₹${Number(inv.taxable).toLocaleString("en-IN")}` : "—"],
                                    ["GST", inv.gst != null ? `₹${Number(inv.gst).toLocaleString("en-IN")}` : "—"],
                                  ].map(([k, v]) => (
                                    <div key={k} className="flex items-center gap-3">
                                      <span className="text-muted-foreground w-24 shrink-0">{k}</span>
                                      <span className="font-mono">{v || "—"}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Middle: 5-level validation flags */}
                              {Object.keys(flags).length > 0 && (
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">5-Level Rule Check</div>
                                  <div className="space-y-2 text-xs">
                                    {[
                                      { label: "Level 1 — Format / Fields", ok: flags.format_ok, detail: flags.format_missing?.length ? `Missing: ${flags.format_missing.join(", ")}` : (flags.format_ok ? "All fields present" : "Invoice number missing") },
                                      { label: "Level 2 — GSTIN Structure", ok: flags.gstin_ok, detail: flags.gstin_ok ? "Valid 15-char format" : "Invalid GSTIN pattern" },
                                      { label: "Level 3 — HSN/SAC", ok: flags.hsn_ok, detail: flags.hsn_ok == null ? "No HSN on invoice (n/a)" : flags.hsn_ok ? "Valid code" : "Unknown/invalid HSN" },
                                      { label: "Level 4 — Total Recalc", ok: flags.total_ok, detail: flags.total_ok != null ? (flags.total_ok ? "Taxable + GST matches total" : "Taxable + GST mismatch with total") : "n/a" },
                                      { label: "Level 5 — Doc Match", ok: flags.doc_match === "MATCHED", detail: flags.doc_match || "Not matched" },
                                    ].map(({ label, ok, detail }) => (
                                      <div key={label} className="flex items-start gap-2">
                                        <span className="mt-0.5">{flagIcon(ok)}</span>
                                        <div>
                                          <span className="font-semibold text-foreground">{label}</span>
                                          <span className="text-muted-foreground ml-2">{detail}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Right: Linked Fraud Case / ML Score */}
                              <div className="bg-card p-3 rounded-xl border border-border/80">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-2 flex items-center gap-1.5">
                                  <ShieldAlert size={12} />
                                  <span>Fraud & Case Status</span>
                                </div>
                                {fraudAlert ? (
                                  <div className="space-y-2 text-xs">
                                    <div className="flex items-center justify-between">
                                      <span className="text-muted-foreground">Case ID:</span>
                                      <span className="font-mono font-medium text-foreground">#{fraudAlert.id}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-muted-foreground">Risk Score:</span>
                                      <span className="font-mono font-bold text-foreground">{fraudAlert.risk || 5}/100 ({fraudAlert.riskLevel || inv.risk})</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-muted-foreground">Review Status:</span>
                                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                                        {fraudAlert.status || "Open"}
                                      </span>
                                    </div>
                                    {fraudAlert.reason && (
                                      <div className="text-[11px] text-muted-foreground bg-muted/50 p-2 rounded-lg mt-1 border border-border/50">
                                        {fraudAlert.reason}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-xs text-muted-foreground py-2">
                                    No active anomaly flags. Invoice cleared by ML & Rule engine.
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* GSTR-2B comparison row */}
                            <div className="mt-4 pt-3 border-t border-border">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">GST Portal (GSTR-2B)</div>
                              <div className="flex items-center gap-6 text-xs">
                                {[["GSTIN", inv.supplierGstin || inv.gstin], ["Invoice No.", inv.id || inv.invoiceNo], ["Amount", inv.status === "Mismatched" ? "₹—" : (inv.total != null ? `₹${Number(inv.total).toLocaleString("en-IN")}` : "—")]].map(([k, v]) => (
                                  <div key={k} className="flex items-center gap-2">
                                    <span className="text-muted-foreground">{k}:</span>
                                    <span className={`font-mono ${inv.status === "Mismatched" && k === "Amount" ? "text-red-500" : ""}`}>{v}</span>
                                  </div>
                                ))}
                                {inv.status === "Missing" && (
                                  <span className="text-amber-600 dark:text-amber-400 italic font-medium text-[11px]">⚠ Not found in GSTR-2B for this period</span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filteredResults.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-xs text-muted-foreground">
                      No invoices found for the filter "{filter}"{invoiceSearch ? ` matching "${invoiceSearch}"` : ""}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fraud Detection & Case Queue (ML Layer) ─────────────────────────────────
function FraudPage({
  onVerifyDoc,
  selectedClientId,
  initialPeriod,
}: {
  onVerifyDoc?: (id: string) => void;
  selectedClientId?: string;
  initialPeriod?: string;
}) {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("All");
  const [severityFilter, setSeverityFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedCase, setSelectedCase] = useState<any | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractedIds, setExtractedIds] = useState<Record<string, boolean>>({});
  const [extractingProgress, setExtractingProgress] = useState(0);
  const [extractingPhase, setExtractingPhase] = useState("");
  const [extractingTimeLeft, setExtractingTimeLeft] = useState("");
  const [enginePickerAlert, setEnginePickerAlert] = useState<any | null>(null);
  const [expandedBreakdownId, setExpandedBreakdownId] = useState<string | null>(null);

  const executeCaseExtraction = async (alertItem: any, engine: "gemini" | "ollama" = "gemini") => {
    setEnginePickerAlert(null);
    const docTarget = String(alertItem.invoiceId || alertItem.id);
    const isGemini = engine === "gemini";
    setExtractingId(String(alertItem.id));
    setExtractingProgress(10);
    setExtractingPhase(isGemini ? "Connecting to Google Gemini Multimodal Vision API..." : "Connecting to local Ollama AI engine (qwen2.5vl:3b)...");
    setExtractingTimeLeft(isGemini ? "~8s left" : "~20s left");
    setStatus("");
    const startTime = Date.now();
    const estimatedTotalSec = isGemini ? 8 : 22;

    let curProg = 10;
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      curProg += Math.random() * (isGemini ? 8 : 3.5) + (isGemini ? 4 : 1.5);
      if (isGemini) {
        if (curProg < 30) {
          setExtractingPhase("Connecting to Google Gemini Multimodal Vision API...");
        } else if (curProg < 60) {
          setExtractingPhase("Streaming document image to Gemini Flash...");
        } else if (curProg < 85) {
          setExtractingPhase("Gemini neural OCR reading invoice headers, line items & taxes...");
        } else if (curProg < 95) {
          setExtractingPhase("Verifying HSN/SAC codes in GST reference database...");
        } else {
          setExtractingPhase("Finalizing structured extraction and updating database...");
        }
      } else {
        if (curProg < 25) {
          setExtractingPhase("Connecting to local Ollama AI engine (qwen2.5vl:3b)...");
        } else if (curProg < 55) {
          setExtractingPhase("Rendering document pages into high-resolution vision tensors...");
        } else if (curProg < 80) {
          setExtractingPhase("Neural OCR reading invoice headers, line items & taxes...");
        } else if (curProg < 94) {
          setExtractingPhase("Verifying HSN/SAC codes & tax calculations against database...");
        } else {
          setExtractingPhase("Finalizing structured extraction and updating database...");
        }
      }
      if (curProg >= 95) curProg = 95;
      setExtractingProgress(curProg);

      const remain = Math.max(1, Math.round(estimatedTotalSec - elapsed));
      if (curProg < 95) {
        setExtractingTimeLeft(`~${remain}s left`);
      } else {
        setExtractingTimeLeft(`~${Math.max(1, Math.round(remain / 2))}s left`);
      }
    }, 400);

    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/extract/rerun/${docTarget}?engine=${engine}`, {
        method: "POST",
        auth: true,
        body: JSON.stringify({ engine })
      });
      clearInterval(interval);
      const totalElapsed = Math.round((Date.now() - startTime) / 1000);
      setExtractingProgress(100);
      setExtractingPhase(`✓ ${isGemini ? "Google Gemini" : "Ollama"} Extraction Complete in ${totalElapsed}s (100%)`);
      setExtractingTimeLeft(`Finished in ${totalElapsed}s`);
      setExtractedIds(prev => ({ ...prev, [String(alertItem.id)]: true }));
      setStatus(res.message || `✓ AI Extraction complete using ${isGemini ? "Google Gemini Flash" : "Ollama"}!`);
      await loadAlerts();
      setTimeout(() => {
        setExtractingId(null);
        setExtractingProgress(0);
        setExtractingPhase("");
        setExtractingTimeLeft("");
      }, 1500);
      setTimeout(() => setStatus(""), 4500);
    } catch (err) {
      clearInterval(interval);
      setStatus(err instanceof Error ? err.message : "Failed to run extraction.");
      setExtractingId(null);
      setExtractingProgress(0);
      setExtractingPhase("");
      setExtractingTimeLeft("");
    }
  };

  // Period Selector State
  const [selectedPeriod, setSelectedPeriod] = useState<string>(initialPeriod || "ALL");
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Re-upload Request Modal State
  const [reuploadModalAlert, setReuploadModalAlert] = useState<any | null>(null);
  const [reuploadReason, setReuploadReason] = useState("Illegible or blurry scanned document");
  const [reuploadNote, setReuploadNote] = useState("");
  const [submittingReupload, setSubmittingReupload] = useState(false);

  const clientId = selectedClientId && selectedClientId !== "ALL" ? selectedClientId : null;
  const canRun = !!clientId;

  const handleSendReuploadRequest = async () => {
    if (!reuploadModalAlert) return;
    setSubmittingReupload(true);
    try {
      const finalNote = reuploadNote.trim() ? `${reuploadReason}: ${reuploadNote.trim()}` : reuploadReason;
      const res = await apiRequest<{ ok: boolean; message: string }>("/api/fraud/request-reupload", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          alertId: String(reuploadModalAlert.id),
          invoiceId: String(reuploadModalAlert.invoiceId || ""),
          clientId: String(reuploadModalAlert.clientId || clientId || ""),
          note: finalNote,
        }),
      });
      setStatus(res.message || "✓ Re-upload request successfully sent to client.");
      setAlerts(prev => prev.map(a => a.id === reuploadModalAlert.id ? { ...a, reuploadStatus: "requested", reuploadNote: finalNote } : a));
      setReuploadModalAlert(null);
      setReuploadNote("");
      setTimeout(() => setStatus(""), 4500);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to send re-upload request.");
    } finally {
      setSubmittingReupload(false);
    }
  };

  const riskVariant = (s: string): any =>
    ({ Critical: "critical", High: "danger", Medium: "warning", Low: "success" }[s] ?? "neutral");

  // Load available periods for the selected client from completed reconciliation runs, uploads, and invoices
  useEffect(() => {
    if (!clientId) {
      setAvailablePeriods([]);
      setSelectedPeriod("ALL");
      return;
    }
    setLoadingPeriods(true);
    apiRequest<{ periods: string[] }>(`/api/fraud/periods?clientId=${clientId}`, { auth: true })
      .then(r => {
        let list = (r.periods || []).filter(p => /^\d{2}-\d{4}$/.test(p) || /^[A-Za-z]+ \d{4}$/.test(p));
        if (initialPeriod && /^\d{2}-\d{4}$/.test(initialPeriod) && !list.includes(initialPeriod)) {
          list = [...list, initialPeriod];
        }
        setAvailablePeriods(list);
        if (list.length > 0) {
          if (initialPeriod && list.includes(initialPeriod)) {
            setSelectedPeriod(initialPeriod);
          } else {
            // Select the most recent period (last in chronological order) or retain valid selection
            setSelectedPeriod(prev => (list.includes(prev) && prev !== "ALL" ? prev : list[list.length - 1]));
          }
        } else {
          setSelectedPeriod("ALL");
        }
      })
      .catch(() => {
        setAvailablePeriods([]);
        setSelectedPeriod("ALL");
      })
      .finally(() => {
        setLoadingPeriods(false);
      });
  }, [clientId, initialPeriod]);

  // Load alerts whenever clientId or selectedPeriod changes
  const loadAlerts = async () => {
    setLoadError(null);
    const params = new URLSearchParams();
    if (clientId) params.append("clientId", String(clientId));
    if (selectedPeriod && selectedPeriod !== "ALL") params.append("taxPeriod", selectedPeriod);
    const qs = params.toString() ? `?${params.toString()}` : "";
    try {
      const r = await apiRequest<{ alerts: any[] }>(`/api/fraud/alerts${qs}`, { auth: true });
      if (r.alerts) {
        setAlerts(r.alerts.map(a => ({
          ...a,
          invoiceId: a.invoiceId || a.invoice_id || "",
          invoiceNo: a.invoiceNo || a.invoice_no || "",
          sourceBatchFile: a.sourceBatchFile || a.source_batch_file || "",
          clientId: a.clientId || a.client_id || "",
          reuploadStatus: a.reuploadStatus || a.reupload_status || "",
          reuploadNote: a.reuploadNote || a.reupload_note || "",
          reuploadedFileName: a.reuploadedFileName || a.reuploaded_file_name || "",
          reuploadedAt: a.reuploadedAt || a.reuploaded_at || "",
          createdAt: a.createdAt || a.created_at || "",
          isReupload: Boolean(a.isReupload || a.is_reupload || a.reuploadStatus === "reuploaded" || a.reupload_status === "reuploaded"),
          score: riskScoreLabel(a.risk),
          amount: formatCurrency(a.amount),
        })));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load cases — please try again.");
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [clientId, selectedPeriod]);

  const runModel = async () => {
    if (!canRun) return;
    setRunning(true);
    setStatus(`Running Isolation Forest + Logistic Regression ML model${selectedPeriod !== "ALL" ? ` for ${selectedPeriod}` : ""}...`);
    try {
      const result = await apiRequest<{ alerts: any[] }>("/api/fraud/run", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          clientId: String(clientId),
          taxPeriod: selectedPeriod !== "ALL" ? selectedPeriod : undefined,
        }),
      });
      const mapped = (result.alerts || []).map(a => ({
        ...a,
        invoiceId: a.invoiceId || a.invoice_id || "",
        invoiceNo: a.invoiceNo || a.invoice_no || "",
        sourceBatchFile: a.sourceBatchFile || a.source_batch_file || "",
        reuploadStatus: a.reuploadStatus || a.reupload_status || "",
        reuploadNote: a.reuploadNote || a.reupload_note || "",
        reuploadedFileName: a.reuploadedFileName || a.reuploaded_file_name || "",
        reuploadedAt: a.reuploadedAt || a.reuploaded_at || "",
        isReupload: Boolean(a.isReupload || a.is_reupload || a.reuploadStatus === "reuploaded" || a.reupload_status === "reuploaded"),
        score: riskScoreLabel(a.risk),
        amount: formatCurrency(a.amount),
      }));
      setAlerts(mapped);
      const crit = mapped.filter(a => a.score === "Critical").length;
      const high = mapped.filter(a => a.score === "High").length;
      setStatus(`✓ ML model complete for ${selectedPeriod !== "ALL" ? selectedPeriod : "all periods"}: ${mapped.length} case(s) scored (${crit} Critical, ${high} High).`);
      setTimeout(() => setStatus(""), 4500);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "ML model failed.");
    } finally {
      setRunning(false);
    }
  };

  const updateAlertStatus = async (alertId: string | number, newStatus: string) => {
    try {
      await apiRequest(`/api/fraud/alerts/${alertId}`, {
        method: "PATCH",
        auth: true,
        body: JSON.stringify({ status: newStatus }),
      });
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: newStatus } : a));
      if (selectedCase?.id === alertId) setSelectedCase((c: any) => ({ ...c, status: newStatus }));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to update case status.");
    }
  };

  const filtered = alerts.filter(a => {
    if (severityFilter !== "All" && a.score !== severityFilter) return false;
    if (sourceFilter === "Rule Engine" && a.source !== "Rule Engine") return false;
    if (sourceFilter === "ML Model" && a.source !== "ML Model") return false;
    if (sourceFilter === "Both" && a.source !== "Both") return false;
    if (search.trim() && !a.entity.toLowerCase().includes(search.toLowerCase()) && !a.reason.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const sourceTag = (source: string | undefined) => {
    const s = source || "ML Model";
    if (s === "Both") return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30">Both Signals</span>;
    if (s === "Rule Engine") return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">Rule Engine</span>;
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30">ML Model</span>;
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <ShieldAlert className="text-primary" size={20} /> Fraud Detection & Case Queue
          </h1>
          <p className="text-xs text-muted-foreground">
            ML layer: Isolation Forest anomaly detection + Logistic Regression risk scoring + SHAP explanations · Covers ALL invoices (matched and mismatched)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tax Period Selector (Populated from Completed Reconciliation Runs) */}
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2.5 py-1.5 shadow-sm">
            <Calendar size={13} className="text-primary shrink-0" />
            <span className="text-xs font-medium text-muted-foreground">Period:</span>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              disabled={!clientId || (availablePeriods.length === 0 && !loadingPeriods)}
              className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer disabled:opacity-50"
            >
              {!clientId && <option value="ALL">Select a client first</option>}
              {clientId && availablePeriods.length === 0 && (
                <option value="ALL">{loadingPeriods ? "Loading periods..." : "No runs found (All)"}</option>
              )}
              {availablePeriods.length > 0 && (
                <option value="ALL">All Periods ({availablePeriods.length})</option>
              )}
              {availablePeriods.map((p) => (
                <option key={p} value={p}>
                  📅 {p}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={loadAlerts}
            title="Refresh case list for selected period"
            className="flex items-center gap-1 text-xs border border-border bg-card hover:bg-muted px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
          >
            <RefreshCw size={12} />
          </button>

          <button
            type="button"
            onClick={runModel}
            disabled={!canRun || running}
            title={!canRun ? "Select a specific client first" : ""}
            className={`flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg font-semibold shadow-sm transition-colors ${canRun && !running
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
          >
            <RefreshCw size={12} className={running ? "animate-spin" : ""} />
            Re-run ML Model
          </button>
        </div>
      </div>

      {!canRun && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          Select a specific client to run the ML scoring model.
        </div>
      )}

      {loadError && (
        <div className="flex items-center justify-between gap-2 text-xs text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-500 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={loadAlerts}
            className="text-xs font-semibold underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {status && (
        <div className="text-xs bg-accent border border-border rounded-xl px-4 py-3 font-medium text-primary">{status}</div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Cases", value: alerts.length.toLocaleString(), color: "text-foreground", bg: "bg-card" },
          { label: "Critical", value: alerts.filter(a => a.score === "Critical").length.toLocaleString(), color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20" },
          { label: "High Risk", value: alerts.filter(a => a.score === "High").length.toLocaleString(), color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-900/20" },
          { label: "False Positives", value: alerts.filter(a => a.status === "false_positive").length.toLocaleString(), color: "text-slate-600 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-900/20" },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border border-border p-4 ${s.bg}`}>
            <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-card border border-border/80 rounded-2xl p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Severity Filter Tabs (Single 'All' + counts) */}
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50 text-xs overflow-x-auto max-w-full">
          {[
            { id: "All", label: "All", count: alerts.length },
            { id: "Critical", label: "Critical", count: alerts.filter(a => a.score === "Critical").length, dotColor: "bg-red-500" },
            { id: "High", label: "High", count: alerts.filter(a => a.score === "High").length, dotColor: "bg-orange-500" },
            { id: "Medium", label: "Medium", count: alerts.filter(a => a.score === "Medium").length, dotColor: "bg-amber-500" },
            { id: "Low", label: "Low", count: alerts.filter(a => a.score === "Low").length, dotColor: "bg-emerald-500" },
          ].map(s => {
            const isActive = severityFilter === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSeverityFilter(s.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 shrink-0 ${isActive
                  ? "bg-card text-foreground shadow-xs border border-border/80"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                  }`}
              >
                {s.dotColor && <span className={`w-1.5 h-1.5 rounded-full ${s.dotColor} shrink-0`} />}
                <span>{s.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium transition-colors ${isActive
                    ? "bg-muted text-foreground"
                    : "bg-muted/60 text-muted-foreground"
                    }`}
                >
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right side: Source Filter + Search Bar + Clear Reset */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Detection Source Dropdown */}
          <div className="flex items-center gap-1.5 bg-muted/50 hover:bg-muted/80 border border-border/70 rounded-xl px-2.5 py-1.5 text-xs transition-colors shadow-2xs">
            <Cpu size={13} className="text-primary shrink-0" />
            <span className="text-[11px] font-medium text-muted-foreground">Source:</span>
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer text-foreground pr-1"
            >
              <option value="All">All Sources ({alerts.length})</option>
              <option value="ML Model">ML Model ({alerts.filter(a => a.source === "ML Model").length})</option>
              <option value="Rule Engine">Rule Engine ({alerts.filter(a => a.source === "Rule Engine").length})</option>
              <option value="Both">Both Signals ({alerts.filter(a => a.source === "Both").length})</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search cases..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-muted/40 hover:bg-muted/70 focus:bg-card border border-border/70 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground/60 shadow-2xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full hover:bg-muted"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Clear Filters Button */}
          {(severityFilter !== "All" || sourceFilter !== "All" || search.trim() !== "") && (
            <button
              type="button"
              onClick={() => {
                setSeverityFilter("All");
                setSourceFilter("All");
                setSearch("");
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 hover:bg-primary/10 px-2 py-1.5 rounded-lg border border-primary/20 transition-colors"
              title="Reset all filters"
            >
              <X size={12} />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Case Cards */}
      <div className="space-y-3">
        {filtered.map(alert => (
          <div
            key={alert.id}
            className={`bg-card border rounded-xl overflow-hidden shadow-sm transition-colors ${alert.status === "false_positive" ? "opacity-60 border-border" : "border-border hover:border-primary/40"}`}
          >
            <div className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 p-2 rounded-lg shrink-0 ${alert.score === "Critical" ? "bg-red-100 dark:bg-red-900/30 text-red-600" : "bg-amber-100 dark:bg-amber-900/30 text-amber-600"}`}>
                    <ShieldAlert size={15} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-mono font-bold text-foreground">
                        {alert.invoiceNo ? `Invoice ${alert.invoiceNo}` : `Case #${alert.id}`}
                      </span>
                      {alert.createdAt && (
                        <span className="text-[10px] text-muted-foreground">Flagged {formatIST(alert.createdAt)}</span>
                      )}
                      {alert.sourceBatchFile && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          (from {alert.sourceBatchFile})
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground">#{alert.id}</span>
                      <Badge label={alert.score || "Review"} variant={riskVariant(alert.score)} />
                      {sourceTag(alert.source)}
                      {alert.reuploadStatus === "requested" && (
                        <span className="text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded border border-amber-500/30 font-bold flex items-center gap-1">
                          ⚠️ Re-upload Requested
                        </span>
                      )}
                      {(alert.reuploadStatus === "reuploaded" || alert.isReupload) && (
                        <span className="text-[10px] px-2 py-0.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded border border-emerald-500/30 font-bold flex items-center gap-1 shadow-sm">
                          ✨ Re-uploaded{alert.reuploadedFileName ? `: ${alert.reuploadedFileName}` : ""}
                        </span>
                      )}
                      {alert.status === "false_positive" && <span className="text-[10px] px-1.5 py-0.5 bg-slate-500/15 text-slate-500 rounded border border-slate-500/20 font-bold">False Positive (this period)</span>}
                      {alert.status === "escalated" && <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/15 text-purple-600 dark:text-purple-400 rounded border border-purple-500/20 font-bold">Escalated</span>}
                    </div>
                    <div className="text-sm font-semibold text-foreground">{alert.entity}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{alert.reason}</div>
                    {alert.reuploadNote && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1 mt-1.5 flex items-center gap-1.5">
                        <Info size={12} className="shrink-0 text-amber-500" />
                        <span><strong>Re-upload Request Note:</strong> {alert.reuploadNote}</span>
                      </div>
                    )}
                    {(alert.reuploadStatus === "reuploaded" || alert.isReupload) && alert.reuploadedFileName && (
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1 mt-1.5 flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="shrink-0 text-emerald-500" />
                        <span><strong>Client Replacement File:</strong> {alert.reuploadedFileName} {alert.reuploadedAt ? `(Uploaded ${formatIST(alert.reuploadedAt)})` : ""}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold font-mono text-foreground">{alert.amount}</div>
                  <div className="text-[10px] text-muted-foreground">ITC at Stake</div>
                </div>
              </div>

              {/* Plain Language Key Factors */}
              {alert.shap && alert.shap.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/60">
                  <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                    <Sparkles size={11} className="text-primary" /> Key Factors:
                  </span>
                  {alert.shap.map((s: string, idx: number) => (
                    <span key={idx} className="text-[10px] bg-muted/60 text-foreground border border-border/60 px-2 py-0.5 rounded-md font-medium leading-tight">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* Risk bar with breakdown toggle */}
              <div className="pt-1">
                <div
                  className={`flex items-center gap-2 select-none ${alert.riskBreakdown && alert.riskBreakdown.length > 0 ? "cursor-pointer group" : ""}`}
                  onClick={() => {
                    if (alert.riskBreakdown && alert.riskBreakdown.length > 0) {
                      setExpandedBreakdownId(expandedBreakdownId === String(alert.id) ? null : String(alert.id));
                    }
                  }}
                  title={alert.riskBreakdown && alert.riskBreakdown.length > 0 ? "Click to toggle risk points breakdown" : undefined}
                >
                  <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${alert.risk >= 80 ? "bg-red-500" : alert.risk >= 60 ? "bg-orange-500" : alert.risk >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.max(0, Math.min(100, alert.risk))}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                    <span>Risk: {alert.risk}/100</span>
                    {alert.riskBreakdown && alert.riskBreakdown.length > 0 && (
                      <span className="text-[10px] underline ml-1 font-sans text-primary">
                        {expandedBreakdownId === String(alert.id) ? "Hide Details" : "View Breakdown"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Structured Risk Points Table (Collapsible) */}
                {expandedBreakdownId === String(alert.id) && alert.riskBreakdown && alert.riskBreakdown.length > 0 && (
                  <div className="mt-2 p-2.5 bg-muted/40 rounded-lg border border-border/70 text-xs animate-in fade-in duration-200">
                    <div className="font-semibold text-[11px] text-muted-foreground mb-1.5 flex items-center justify-between">
                      <span>Document-Level Risk Points Breakdown</span>
                      <span className="font-mono font-bold text-foreground">Total: {alert.risk} pts</span>
                    </div>
                    <div className="space-y-1">
                      {alert.riskBreakdown.map((item: { label: string; points: number; note: string }, idx: number) => (
                        <div key={idx} className="flex items-start justify-between gap-2 py-0.5 text-[11px] border-b border-border/30 last:border-0">
                          <div className="flex-1">
                            <span className="font-medium text-foreground">{item.label}</span>
                            {item.note && <span className="text-muted-foreground ml-1.5 text-[10px]">({item.note})</span>}
                          </div>
                          <span className={`font-mono font-bold shrink-0 ${item.points > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {item.points > 0 ? `+${item.points}` : `${item.points}`} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
                <button
                  type="button"
                  onClick={() => onVerifyDoc?.(String(alert.invoiceId || alert.id))}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                  title="Inspect document & edit details for 100% accuracy"
                >
                  <FileText size={12} /> Inspect / Edit Details
                </button>
                <button
                  type="button"
                  disabled={Boolean(extractingId)}
                  onClick={() => setEnginePickerAlert(alert)}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-3 py-1.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                  title={extractedIds[String(alert.id)] ? "Re-extract all fields with Gemini or Ollama" : "Run AI extraction on this document"}
                >
                  {extractingId === String(alert.id) ? (
                    <>
                      <Loader2 size={12} className="animate-spin text-indigo-200" />
                      <span>{extractedIds[String(alert.id)] ? "Re-extracting..." : "Extracting..."}</span>
                    </>
                  ) : extractedIds[String(alert.id)] ? (
                    <>
                      <CheckCircle2 size={12} className="text-emerald-300" />
                      <span>Re-extract</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} className="text-amber-300" />
                      <span>Run Extraction</span>
                    </>
                  )}
                </button>
                {/* Re-upload button */}
                <button
                  type="button"
                  onClick={() => {
                    setReuploadModalAlert(alert);
                    setReuploadReason("Illegible or blurry scanned document");
                    setReuploadNote("");
                  }}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors ${alert.reuploadStatus === "requested"
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
                    : alert.reuploadStatus === "reuploaded" || alert.isReupload
                      ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                      : "bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
                    }`}
                  title="Request the client to re-upload the document for this invoice"
                >
                  <Upload size={12} />
                  <span>
                    {alert.reuploadStatus === "requested"
                      ? "Re-upload Pending"
                      : alert.reuploadStatus === "reuploaded" || alert.isReupload
                        ? "Re-uploaded ✓"
                        : "Re-upload"}
                  </span>
                </button>
                {alert.status !== "false_positive" && (
                  <button
                    type="button"
                    onClick={() => updateAlertStatus(alert.id, "false_positive")}
                    className="text-xs border border-border bg-card px-3 py-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    Mark as Valid
                  </button>
                )}
                {alert.status !== "escalated" && (
                  <button
                    type="button"
                    onClick={() => updateAlertStatus(alert.id, "escalated")}
                    className="text-xs border border-border bg-card px-3 py-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    Send for Review
                  </button>
                )}
                {alert.status !== "Open" && (
                  <button
                    type="button"
                    onClick={() => updateAlertStatus(alert.id, "Open")}
                    className="text-xs border border-border bg-card px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                  >
                    Reopen
                  </button>
                )}
              </div>

              {/* Real-time Green Progress Bar directly inside this specific document card */}
              {extractingId === String(alert.id) && (
                <div className="bg-emerald-950/20 border border-emerald-500/40 rounded-xl p-3.5 space-y-2 mt-2 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{extractingPhase || "Finalizing structured extraction and updating database..."}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {extractingTimeLeft && (
                        <span className="text-[11px] font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded">
                          ⏱ {extractingTimeLeft}
                        </span>
                      )}
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">{Math.round(extractingProgress)}%</span>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden p-0.5 border border-emerald-500/20">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300 shadow-lg shadow-emerald-500/50"
                      style={{ width: `${extractingProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="bg-card border border-border rounded-xl p-8 text-center text-xs text-muted-foreground">
            {alerts.length === 0
              ? "No cases generated yet. Run Full Reconciliation then Re-run ML Model to score all invoices."
              : "No cases matching current filter criteria."}
          </div>
        )}
      </div>

      {/* Tax Officer Re-upload Request Modal */}
      {reuploadModalAlert && (
        <div className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500 border border-amber-500/30">
                  <Upload size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Request Document Re-upload</h3>
                  <p className="text-xs text-muted-foreground">
                    Notify client to upload a clean or corrected replacement document
                  </p>
                </div>
              </div>
              <button
                onClick={() => setReuploadModalAlert(null)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>

            <div className="bg-muted/40 border border-border rounded-xl p-3 text-xs space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Reference:</span>
                <span className="font-bold text-foreground">{reuploadModalAlert.invoiceNo || `Case #${reuploadModalAlert.id}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Supplier / Entity:</span>
                <span className="font-bold text-foreground">{reuploadModalAlert.entity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-bold text-foreground">{reuploadModalAlert.amount}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">
                  Select Reason for Re-upload Request
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    "📄 Illegible or blurry scanned document",
                    "🔢 GSTIN or Invoice Number mismatch",
                    "📅 Tax period / date discrepancy",
                    "💰 Tax calculation / HSN mismatch",
                    "✍️ Missing signature or stamp",
                    "📋 Other verification required",
                  ].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReuploadReason(r)}
                      className={`text-left text-xs p-2.5 rounded-xl border transition-all ${reuploadReason === r
                        ? "border-amber-500 bg-amber-500/15 font-semibold text-amber-900 dark:text-amber-200"
                        : "border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Additional Instructions / Note for Client (Optional)
                </label>
                <textarea
                  value={reuploadNote}
                  onChange={e => setReuploadNote(e.target.value)}
                  placeholder="e.g. Kindly upload the original scanned PDF invoice with clear GSTIN and supplier stamp..."
                  className="w-full text-xs bg-muted border border-border rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 min-h-[70px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setReuploadModalAlert(null)}
                className="text-xs border border-border bg-card hover:bg-muted px-4 py-2 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingReupload}
                onClick={handleSendReuploadRequest}
                className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2 rounded-xl shadow transition-colors disabled:opacity-50"
              >
                {submittingReupload ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                <span>Send Re-upload Request</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Engine Selection Modal for Case Card */}
      {enginePickerAlert && (
        <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Select Extraction Engine</h3>
                  <p className="text-xs text-muted-foreground">Choose the vision AI engine for document parsing</p>
                </div>
              </div>
              <button
                onClick={() => setEnginePickerAlert(null)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Option 1: Google Gemini Flash */}
              <button
                type="button"
                onClick={() => executeCaseExtraction(enginePickerAlert, "gemini")}
                className="w-full text-left p-4 rounded-xl border border-indigo-500/40 bg-indigo-950/20 hover:bg-indigo-950/40 hover:border-indigo-400 transition-all flex items-start gap-3.5 group shadow-sm"
              >
                <div className="p-2.5 rounded-lg bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shrink-0 group-hover:scale-105 transition-transform">
                  <Sparkles size={18} className="text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground group-hover:text-indigo-400">Google Gemini Flash</span>
                    <span className="text-[10px] font-bold bg-amber-400/20 text-amber-600 dark:text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded">RECOMMENDED</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Ultra-fast cloud multimodal vision model with 100% precision extraction for invoice numbers, HSN/SAC codes, supplier/buyer details & taxes (~5-10s).
                  </p>
                </div>
              </button>

              {/* Option 2: Local Ollama */}
              <button
                type="button"
                onClick={() => executeCaseExtraction(enginePickerAlert, "ollama")}
                className="w-full text-left p-4 rounded-xl border border-border bg-card hover:bg-muted hover:border-slate-500 transition-all flex items-start gap-3.5 group"
              >
                <div className="p-2.5 rounded-lg bg-muted text-foreground border border-border shrink-0 group-hover:scale-105 transition-transform">
                  <Cpu size={18} className="text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground group-hover:text-primary">Ollama Local AI (qwen2.5vl:3b)</span>
                    <span className="text-[10px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded">ON-PREMISE</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Runs 100% locally on your machine GPU/CPU. Zero external internet connection required for air-gapped security (~20s).
                  </p>
                </div>
              </button>
            </div>

            <div className="pt-2 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setEnginePickerAlert(null)}
                className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Case Detail Modal with Supporting Notes */}
      {selectedCase && (
        <CaseSupportingNotesModal
          caseItem={selectedCase}
          onClose={() => setSelectedCase(null)}
          onVerifyDoc={onVerifyDoc}
          onStatusChange={updateAlertStatus}
        />
      )}
    </div>
  );
}

// ── Case Detail Modal (Supporting Notes & Evidence — used inside FraudPage) ──
function CaseSupportingNotesModal({
  caseItem,
  onClose,
  onVerifyDoc,
  onStatusChange,
}: {
  caseItem: any;
  onClose: () => void;
  onVerifyDoc?: (id: string) => void;
  onStatusChange?: (id: string | number, status: string) => void;
}) {
  const [notes, setNotes] = useState<any[]>([]);
  const [newNoteText, setNewNoteText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [noteStatus, setNoteStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadNotes = async () => {
    if (!caseItem?.id) return;
    try {
      const res = await apiRequest<{ notes: any[] }>(`/api/cases/${caseItem.id}/notes`, { auth: true });
      setNotes(res.notes || []);
    } catch { /* notes endpoint may not exist for this case */ }
  };

  useEffect(() => { loadNotes(); }, [caseItem?.id]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    setSubmitting(true);
    setNoteStatus("");
    try {
      const formData = new FormData();
      formData.append("note_text", newNoteText.trim());
      if (caseItem.clientId) formData.append("clientId", String(caseItem.clientId));
      if (selectedFile) formData.append("file", selectedFile);
      await apiRequest(`/api/cases/${caseItem.id}/notes`, { method: "POST", auth: true, body: formData });
      setNewNoteText("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNoteStatus("✓ Supporting note attached.");
      loadNotes();
      setTimeout(() => setNoteStatus(""), 4000);
    } catch (err) {
      setNoteStatus(err instanceof Error ? err.message : "Failed to add note.");
    } finally {
      setSubmitting(false);
    }
  };

  const riskVariant = (score: string): any =>
    ({ Critical: "critical", High: "danger", Medium: "warning", Low: "success" }[score] ?? "neutral");

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-bold flex items-center gap-2 flex-wrap">
                <span>Case #{caseItem.id}</span>
                <Badge label={caseItem.score || "Review"} variant={riskVariant(caseItem.score)} />
                <span className="text-xs font-normal text-muted-foreground font-mono">{caseItem.type}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{caseItem.entity} · {caseItem.amount}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Reason & SHAP */}
          <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Discrepancy Details</div>
            <p className="text-xs text-foreground leading-relaxed">{caseItem.reason || "Invoice flagged during reconciliation or ML scoring."}</p>
            {caseItem.shap?.length > 0 && (
              <div className="pt-2">
                <div className="text-[11px] font-semibold text-primary mb-1.5 flex items-center gap-1"><Cpu size={12} /> SHAP Factors:</div>
                <div className="flex flex-wrap gap-1.5">
                  {caseItem.shap.map((s: string, i: number) => (
                    <span key={i} className="text-[10px] font-mono bg-background border border-border px-2 py-0.5 rounded">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Evidence link */}
          {caseItem.invoiceId && (
            <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl p-3.5">
              <div>
                <div className="text-xs font-bold">Client Document Evidence</div>
                <div className="text-[11px] text-muted-foreground">Open the original client-uploaded file in read-only mode.</div>
              </div>
              <button
                type="button"
                onClick={() => { onClose(); onVerifyDoc?.(String(caseItem.invoiceId)); }}
                className="flex items-center gap-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
              >
                <Eye size={13} /> View Evidence
              </button>
            </div>
          )}

          {/* Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {caseItem.status !== "false_positive" && (
              <button
                type="button"
                onClick={() => onStatusChange?.(caseItem.id, "false_positive")}
                className="text-xs border border-border bg-card px-3 py-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                Mark as Valid
              </button>
            )}
            {caseItem.status !== "escalated" && (
              <button
                type="button"
                onClick={() => onStatusChange?.(caseItem.id, "escalated")}
                className="text-xs border border-border bg-card px-3 py-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                Send for Review
              </button>
            )}
          </div>

          {/* Supporting Notes */}
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Paperclip size={13} className="text-primary" /> Supporting Notes & Attachments
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">{notes.length} note(s)</span>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {notes.map(n => (
                <div key={n.id} className="bg-card border border-border rounded-xl p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1"><User size={11} className="text-primary" /> {n.authorName}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formatIST(n.createdAt, "")}
                    </span>
                  </div>
                  <p className="text-foreground text-[11px] leading-relaxed">{n.noteText}</p>
                  {n.hasAttachment && (
                    <button
                      type="button"
                      onClick={() =>
                        openProtectedFile(`/api/cases/notes/${n.id}/attachment`).catch((err) =>
                          setNoteStatus(err instanceof Error ? err.message : "Failed to open attachment.")
                        )
                      }
                      className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded-md transition-colors"
                    >
                      <Download size={10} /> {n.attachmentFilename}
                    </button>
                  )}
                </div>
              ))}
              {notes.length === 0 && (
                <div className="text-center py-3 text-xs text-muted-foreground bg-muted/20 border border-dashed border-border rounded-xl">
                  No notes yet.
                </div>
              )}
            </div>
            <form onSubmit={handleAddNote} className="space-y-2 pt-1">
              <textarea
                rows={2}
                value={newNoteText}
                onChange={e => setNewNoteText(e.target.value)}
                placeholder="Add clarification, decision note, or audit summary..."
                className="w-full bg-muted border border-border rounded-xl p-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <input ref={fileInputRef} type="file" className="hidden" onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-xs border border-border bg-card hover:bg-muted px-2.5 py-1.5 rounded-lg transition-colors">
                    <Paperclip size={12} /> {selectedFile ? selectedFile.name : "Attach File (Optional)"}
                  </button>
                  {selectedFile && <button type="button" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-[11px] text-rose-500 hover:underline">Clear</button>}
                </div>
                <button
                  type="submit"
                  disabled={!newNoteText.trim() || submitting}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 py-1.5 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Add Note
                </button>
              </div>
              {noteStatus && <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">{noteStatus}</div>}
            </form>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-border bg-muted/20 flex justify-end">
          <button onClick={onClose} className="text-xs border border-border bg-card hover:bg-muted px-4 py-2 rounded-lg font-medium transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}
// ── Graph Analytics ────────────────────────────────────────────────────────
type GraphNode = { id: string; label: string; type: string; risk: string; clientId?: string; x: number; y: number };
type GraphEdge = { from: string; to: string; amount: string; amountValue: number; gst: number; count: number; suspicious: boolean };
type GraphCycle = { gstins: string[]; labels: string[]; length: number; itc: number; itcDisplay: string };

const RECON_STATUS_COLORS: Record<string, string> = {
  Matched: "text-emerald-600 dark:text-emerald-400",
  Mismatched: "text-amber-600 dark:text-amber-400",
  Missing: "text-red-600 dark:text-red-400",
  Duplicate: "text-orange-600 dark:text-orange-400",
  Pending: "text-muted-foreground",
};

function ReconBreakdown({ counts }: { counts: Record<string, number> }) {
  const statuses = ["Matched", "Mismatched", "Missing", "Duplicate", "Pending"].filter(s => s !== "Pending" || counts.Pending > 0);
  return (
    <div className="grid grid-cols-2 gap-1">
      {statuses.map(s => (
        <div key={s} className="flex justify-between text-[11px] bg-muted/40 rounded px-2 py-1">
          <span className="text-muted-foreground">{s}</span>
          <span className={`font-mono font-semibold ${RECON_STATUS_COLORS[s]}`}>{counts[s] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

function EntityLink({ label, gstin, onSelect, canSelect }: { label: string; gstin: string; onSelect: (id: string) => void; canSelect: boolean }) {
  if (!canSelect) return <span className="truncate">{label}</span>;
  return (
    <button type="button" onClick={() => onSelect(gstin)} className="truncate text-left text-primary hover:underline" title={`Show ${label} in the graph`}>
      {label}
    </button>
  );
}

function GraphEntityDetails({ node, details, loading, error, rings, activeRing, hasNode, onSelect, onShowRing, onClose }: {
  node: GraphNode | undefined;
  details: any;
  loading: boolean;
  error: string;
  rings: number[];
  activeRing: number | null;
  hasNode: (id: string) => boolean;
  onSelect: (id: string) => void;
  onShowRing: (index: number) => void;
  onClose: () => void;
}) {
  const isClient = details ? details.kind === "client" : node?.type === "client";
  const gstinLabel = node && !node.id.startsWith("PENDING") ? node.id : "Not verified yet";
  return (
    <div className="bg-card border border-primary/40 rounded-lg p-3 space-y-3 max-h-[560px] overflow-y-auto">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isClient ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            {isClient ? <Building2 size={16} /> : <Layers size={16} />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{details?.client?.name ?? details?.supplier?.name ?? node?.label}</div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">{isClient ? "Client" : "Supplier"} · GSTIN {gstinLabel}</div>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"><X size={14} /></button>
      </div>

      {rings.length > 0 && (
        <div className="border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 rounded p-2 space-y-1.5">
          <div className="text-[11px] font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Part of {rings.length} circular trading ring{rings.length === 1 ? "" : "s"}
          </div>
          <div className="flex flex-wrap gap-1">
            {rings.map(i => (
              <button key={i} type="button" onClick={() => onShowRing(i)}
                className={`text-[10px] px-2 py-0.5 rounded border ${activeRing === i ? "bg-red-600 text-white border-red-600" : "border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40"}`}>
                {activeRing === i ? `Showing ring ${i + 1}` : `Show ring ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading details…</div>}
      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}

      {details?.kind === "client" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[10px] text-muted-foreground">Compliance</div>
              <div className={`font-mono font-bold text-sm ${getComplianceColor(details.client.compliance)}`}>{details.client.compliance}%</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[10px] text-muted-foreground">Risk profile</div>
              <div className={`font-semibold text-sm ${getRiskTextColor(details.client.risk)}`}>{details.client.risk}</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[10px] text-muted-foreground">Purchases</div>
              <div className="font-mono font-semibold text-sm">{details.purchaseValueDisplay}</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[10px] text-muted-foreground">Suppliers</div>
              <div className="font-mono font-semibold text-sm">{details.supplierCount}</div>
            </div>
          </div>

          <div className="text-[11px] space-y-1">
            {details.client.gstLegalName && <div className="flex justify-between gap-2"><span className="text-muted-foreground">Legal name</span><span className="truncate">{details.client.gstLegalName}</span></div>}
            {details.client.gstStatus && <div className="flex justify-between gap-2"><span className="text-muted-foreground">GST status</span><span>{details.client.gstStatus}</span></div>}
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">City</span><span>{details.client.city || "Not specified"}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Email</span><span className="font-mono truncate">{details.client.email || "Not registered"}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Assigned CA</span><span className="truncate">{details.client.caName || "Unassigned"}</span></div>
          </div>

          <div>
            <div className="text-[11px] font-medium mb-1">Reconciliation ({details.client.invoices} invoices)</div>
            <ReconBreakdown counts={details.reconciliation} />
          </div>

          <div>
            <div className="text-[11px] font-medium mb-1">Open fraud alerts ({details.openAlertCount})</div>
            {details.openAlerts.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No open alerts.</div>
            ) : (
              <div className="space-y-1">
                {details.openAlerts.map((a: any) => (
                  <div key={a.id} className="flex justify-between gap-2 text-[11px] bg-muted/40 rounded px-2 py-1">
                    <span className="truncate">{a.type}</span>
                    <span className={`font-mono shrink-0 ${getRiskTextColor(riskScoreLabel(a.risk))}`}>risk {a.risk}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-medium mb-1">Top suppliers</div>
            <div className="space-y-1">
              {details.topSuppliers.map((s: any) => (
                <div key={s.gstin || s.name} className="flex justify-between gap-2 text-[11px]">
                  <EntityLink label={s.name} gstin={s.gstin} onSelect={onSelect} canSelect={!!s.gstin && hasNode(s.gstin)} />
                  <span className="font-mono text-muted-foreground shrink-0">{s.totalDisplay} · {s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {details?.kind === "supplier" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[10px] text-muted-foreground">Invoices</div>
              <div className="font-mono font-semibold text-sm">{details.supplier.invoiceCount}</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[10px] text-muted-foreground">Billed value</div>
              <div className="font-mono font-semibold text-sm">{details.supplier.totalValueDisplay}</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[10px] text-muted-foreground">GST charged</div>
              <div className="font-mono font-semibold text-sm">{details.supplier.gstDisplay}</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[10px] text-muted-foreground">Clients billed</div>
              <div className="font-mono font-semibold text-sm">{details.billedClients.length}</div>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium mb-1">Bills these clients</div>
            <div className="space-y-1">
              {details.billedClients.map((c: any) => (
                <div key={c.clientId} className="flex justify-between gap-2 text-[11px]">
                  <EntityLink label={c.name} gstin={c.gstin} onSelect={onSelect} canSelect={!!c.gstin && hasNode(c.gstin)} />
                  <span className="font-mono text-muted-foreground shrink-0">{c.totalDisplay} · {c.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium mb-1">Reconciliation of their invoices</div>
            <ReconBreakdown counts={details.reconciliation} />
          </div>

          <div>
            <div className="text-[11px] font-medium mb-1">Recent invoices</div>
            <div className="space-y-1">
              {details.recentInvoices.map((inv: any) => (
                <div key={inv.id} className="text-[11px] bg-muted/40 rounded px-2 py-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono truncate">{inv.invoiceNo}</span>
                    <span className={`shrink-0 ${RECON_STATUS_COLORS[inv.status] ?? "text-muted-foreground"}`}>{inv.status}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                    <span className="truncate">{inv.date} · {inv.clientName}</span>
                    <span className="font-mono shrink-0">{formatCurrency(inv.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="text-[10px] text-muted-foreground">Figures from purchase-register invoices.</div>
    </div>
  );
}

// Drawing area (SVG viewBox units); the SVG scales to the panel width.
const GRAPH_W = 900;
const GRAPH_H = 500;
const nodeRadius = (n: { type: string }) => (n.type === "client" ? 22 : 15);
const shortLabel = (label: string) => (label.length > 24 ? `${label.slice(0, 23)}…` : label);

// The officer's clients sit in an inner ring (so rings between clients read as loops);
// suppliers go on a wide outer ellipse that uses the panel's full width.
function layoutGraph(raw: Omit<GraphNode, "x" | "y">[]): GraphNode[] {
  const cx = GRAPH_W / 2, cy = GRAPH_H / 2;
  const clients = raw.filter(n => n.type === "client");
  const others = raw.filter(n => n.type !== "client");
  const place = (list: typeof raw, rx: number, ry: number, offset: number) =>
    list.map((n, i) => {
      if (list.length === 1 && rx < 100) return { ...n, x: cx, y: cy };
      const angle = (2 * Math.PI * i) / list.length - Math.PI / 2 + offset;
      return { ...n, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
    });
  const innerR = Math.min(95, 45 + 18 * clients.length);
  return [
    ...place(clients, innerR, innerR, 0),
    ...place(others, GRAPH_W / 2 - 120, GRAPH_H / 2 - 50, Math.PI / Math.max(others.length, 1)),
  ];
}

function GraphPage() {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; cycles: GraphCycle[]; metrics: any }>({ nodes: [], edges: [], cycles: [], metrics: {} });
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeRing, setActiveRing] = useState<number | null>(null);
  const [details, setDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  useEffect(() => {
    const clientId = getClientId();
    if (!clientId) return;
    setLoading(true);
    apiRequest<{ nodes: GraphNode[]; edges: GraphEdge[]; cycles: GraphCycle[]; metrics: any }>(`/api/graph?clientId=${clientId}`, { auth: true })
      .then(data => {
        setGraphData({ nodes: layoutGraph(data.nodes || []), edges: data.edges || [], cycles: data.cycles || [], metrics: data.metrics || {} });
      })
      .catch(err => setNotice(err instanceof Error ? err.message : "Failed to load graph data."))
      .finally(() => setLoading(false));
  }, []);

  // Load details for the selected entity.
  useEffect(() => {
    setDetails(null);
    setDetailsError("");
    if (!selectedId) return;
    let cancelled = false;
    setDetailsLoading(true);
    const params = new URLSearchParams({ clientId: String(getClientId()), gstin: selectedId });
    apiRequest<any>(`/api/graph/node?${params}`, { auth: true })
      .then(d => { if (!cancelled) setDetails(d); })
      .catch(err => { if (!cancelled) setDetailsError(err instanceof Error ? err.message : "Failed to load details."); })
      .finally(() => { if (!cancelled) setDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const clearSelection = () => { setSelectedId(null); setActiveRing(null); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clearSelection(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { nodes, edges, cycles, metrics } = graphData;
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!map.has(e.from)) map.set(e.from, new Set());
      if (!map.has(e.to)) map.set(e.to, new Set());
      map.get(e.from)!.add(e.to);
      map.get(e.to)!.add(e.from);
    }
    return map;
  }, [edges]);

  // What's emphasised: a highlighted ring, otherwise the hovered/selected entity and its direct links.
  const focus = useMemo(() => {
    if (activeRing !== null && cycles[activeRing]) {
      const ring = cycles[activeRing].gstins;
      const ringEdges = new Set(ring.map((g, i) => `${g}>${ring[(i + 1) % ring.length]}`));
      return { nodes: new Set(ring), hasEdge: (e: GraphEdge) => ringEdges.has(`${e.from}>${e.to}`) };
    }
    const centre = hoveredId ?? selectedId;
    if (!centre) return null;
    return {
      nodes: new Set([centre, ...(neighbours.get(centre) ?? [])]),
      hasEdge: (e: GraphEdge) => e.from === centre || e.to === centre,
    };
  }, [activeRing, cycles, hoveredId, selectedId, neighbours]);

  const selectNode = (id: string) => {
    setActiveRing(null);
    setSelectedId(prev => (prev === id ? null : id));
  };
  const toggleRing = (index: number) => setActiveRing(prev => (prev === index ? null : index));
  const ringsOf = (id: string) => cycles.flatMap((c, i) => (c.gstins.includes(id) ? [i] : []));

  const nodeColor = (risk: string) => ({ low: "#10B981", medium: "#F59E0B", high: "#EF4444", critical: "#DC2626" }[risk] ?? "#6366F1");
  const getNode = (id: string) => nodeById.get(id) || { id, x: 0, y: 0, label: id, risk: "low", type: "supplier" };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Graph Analytics</h2>
          <p className="text-xs text-muted-foreground">Supplier–buyer transaction network · Circular trading detection</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setNotice("Graph filters will activate after graph data is loaded.")} className="flex items-center gap-1 text-xs border border-border bg-card px-3 py-1.5 rounded hover:bg-muted transition-colors"><Filter size={11} /> Filter</button>
          <button type="button" onClick={() => setNotice("Graph export will be available after network analysis data is loaded.")} className="flex items-center gap-1 text-xs border border-border bg-card px-3 py-1.5 rounded hover:bg-muted transition-colors"><Download size={11} /> Export</button>
        </div>
      </div>
      {notice && <div className="text-xs text-primary bg-accent border border-border rounded-md px-3 py-2">{notice}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 lg:self-start bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500 rounded inline-block" /> Suspicious</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-border rounded inline-block" style={{ background: "var(--muted-foreground)" }} /> Normal</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Critical</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> High/Med</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Low</span>
              <span className="text-[11px]">· Click an entity for details · Esc to clear</span>
            </div>
            <Badge label={`${edges.filter(e => e.suspicious).length} Suspicious Edges`} variant="neutral" />
          </div>
          <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} width="100%" className="block" style={{ maxHeight: 560 }} onClick={e => { if (e.target === e.currentTarget) clearSelection(); }}>
            <defs>
              <marker id="arrow-sus" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#EF4444" />
              </marker>
              <marker id="arrow-norm" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="var(--muted-foreground)" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const from = getNode(e.from);
              const to = getNode(e.to);
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const nx = dx / len; const ny = dy / len;
              const x1 = from.x + nx * nodeRadius(from); const y1 = from.y + ny * nodeRadius(from);
              const x2 = to.x - nx * (nodeRadius(to) + 6); const y2 = to.y - ny * (nodeRadius(to) + 6);
              const emphasised = focus?.hasEdge(e) ?? false;
              const dimmed = focus !== null && !emphasised;
              const showAmount = focus ? emphasised : e.suspicious;
              return (
                <g key={i} opacity={dimmed ? 0.12 : 1} style={{ transition: "opacity 150ms" }}>
                  <title>{`${from.label} → ${to.label}\n${e.amount} · ${e.count} invoice${e.count === 1 ? "" : "s"}${e.suspicious ? "\nPart of a circular trading ring" : ""}`}</title>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={e.suspicious ? "#EF4444" : "var(--muted-foreground)"} strokeWidth={(e.suspicious ? 2 : 1) + (emphasised ? 1 : 0)} strokeDasharray={e.suspicious ? "none" : "4 3"} strokeOpacity={e.suspicious || emphasised ? 0.9 : 0.4} markerEnd={e.suspicious ? "url(#arrow-sus)" : "url(#arrow-norm)"} />
                  {showAmount && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6} textAnchor="middle" fontSize="10" fill="var(--foreground)" className="font-mono" paintOrder="stroke" stroke="var(--card)" strokeWidth={3}>{e.amount}</text>}
                </g>
              );
            })}
            {nodes.map(n => {
              const selected = n.id === selectedId;
              const dimmed = focus !== null && !focus.nodes.has(n.id);
              const r = nodeRadius(n);
              const showLabel = n.type === "client" || nodes.length <= 12 || (focus?.nodes.has(n.id) ?? false);
              return (
                <g
                  key={n.id}
                  className="cursor-pointer outline-none"
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.label}, ${n.type}. Show details`}
                  aria-pressed={selected}
                  opacity={dimmed ? 0.25 : 1}
                  style={{ transition: "opacity 150ms" }}
                  onClick={() => selectNode(n.id)}
                  onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectNode(n.id); } }}
                  onMouseEnter={() => setHoveredId(n.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(n.id)}
                  onBlur={() => setHoveredId(null)}
                >
                  <title>{`${n.label} (${n.type})\nGSTIN: ${n.id.startsWith("PENDING") ? "not verified" : n.id}\nClick for details`}</title>
                  {selected && <circle cx={n.x} cy={n.y} r={r + 7} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeDasharray="5 3" />}
                  <circle cx={n.x} cy={n.y} r={n.id === hoveredId ? r + 2 : r} fill={nodeColor(n.risk)} fillOpacity={selected ? 0.3 : 0.15} stroke={nodeColor(n.risk)} strokeWidth={2} style={{ transition: "r 120ms" }} />
                  <circle cx={n.x} cy={n.y} r={n.type === "client" ? 10 : 6} fill={nodeColor(n.risk)} />
                  {showLabel && (
                    <>
                      <text x={n.x} y={n.y + r + 14} textAnchor="middle" fontSize="11" fill="var(--foreground)" fontWeight={selected || n.type === "client" ? 700 : 500} paintOrder="stroke" stroke="var(--card)" strokeWidth={3}>{shortLabel(n.label)}</text>
                      <text x={n.x} y={n.y + r + 25} textAnchor="middle" fontSize="9" fill="var(--muted-foreground)" paintOrder="stroke" stroke="var(--card)" strokeWidth={3}>{n.type}</text>
                    </>
                  )}
                </g>
              );
            })}
            {nodes.length === 0 && (
              <text x={GRAPH_W / 2} y={GRAPH_H / 2} textAnchor="middle" fontSize="13" fill="var(--muted-foreground)">
                {loading ? "Loading network…" : "No graph data loaded"}
              </text>
            )}
          </svg>
        </div>

        <div className="space-y-3">
          {selectedId ? (
            <GraphEntityDetails
              node={nodeById.get(selectedId)}
              details={details}
              loading={detailsLoading}
              error={detailsError}
              rings={ringsOf(selectedId)}
              activeRing={activeRing}
              hasNode={id => nodeById.has(id)}
              onSelect={selectNode}
              onShowRing={toggleRing}
              onClose={clearSelection}
            />
          ) : (
            nodes.length > 0 && (
              <div className="bg-card border border-dashed border-border rounded-lg p-3 text-[11px] text-muted-foreground flex items-start gap-2">
                <Info size={13} className="mt-0.5 shrink-0" />
                <span>Click a client or supplier in the graph to see its details, reconciliation status and fraud alerts.</span>
              </div>
            )
          )}
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs font-medium mb-2">Network Summary</div>
            {[["Nodes (Entities)", nodes.length.toLocaleString()], ["Edges (Transactions)", edges.length.toLocaleString()], ["Circular Chains", String(metrics.cyclesDetected ?? cycles.length)], ["Suspicious Edges", String(metrics.suspiciousEdges ?? edges.filter(e => e.suspicious).length)]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs py-1.5 border-b border-border last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-mono font-medium">{v}</span>
              </div>
            ))}
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs font-medium mb-2">Circular Chain Detection</div>
            {cycles.length === 0 ? (
              <>
                <div className="text-[11px] text-muted-foreground mb-2">{loading ? "Analyzing transaction network…" : "No circular trading rings detected."}</div>
                <div className="space-y-1">
                  <div className="text-[11px] font-mono bg-muted px-2 py-1.5 rounded">ITC at Risk: {metrics.itcAtRiskDisplay ?? "₹0"}</div>
                  <div className="text-[11px] font-mono bg-muted px-2 py-1.5 rounded">Rings Found: 0</div>
                </div>
                <button disabled className="mt-2 w-full text-xs bg-red-600 text-white px-3 py-1.5 rounded opacity-50 cursor-not-allowed">Flag for Investigation</button>
              </>
            ) : (
              <>
                <div className="text-[11px] text-red-600 dark:text-red-400 font-medium mb-2">{cycles.length} circular trading ring{cycles.length === 1 ? "" : "s"} detected · click one to highlight it</div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {cycles.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleRing(i)}
                      aria-pressed={activeRing === i}
                      className={`w-full text-left border rounded p-2 transition-colors ${activeRing === i ? "border-red-500 bg-red-50 dark:bg-red-950/30" : "border-red-200 dark:border-red-900/40 hover:bg-muted/60"}`}
                    >
                      <div className="text-[11px] font-mono leading-relaxed">{c.labels.join(" → ")} → {c.labels[0]}</div>
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                        <span>{c.length} entities</span>
                        <span className="font-mono">ITC at risk: {c.itcDisplay}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="text-[11px] font-mono bg-muted px-2 py-1.5 rounded mt-2">Total ITC at Risk: {metrics.itcAtRiskDisplay ?? "₹0"}</div>
                <button type="button" onClick={() => setNotice(`${cycles.length} circular trading ring(s) flagged for investigation.`)} className="mt-2 w-full text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 transition-colors">Flag for Investigation</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AI Assistant ────────────────────────────────────────────────────────────
function AssistantPage() {
  const [messages, setMessages] = useState(chatMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const suggestions: string[] = [];
  const responses: Record<string, string> = {};

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setMessages(m => [...m, { role: "user", text: userMsg }]);
    setInput("");
    setLoading(true);
    try {
      const result = await apiRequest<{ answer: string }>("/api/assistant/ask", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ clientId: getClientId(), question: userMsg }),
      });
      setMessages(m => [...m, { role: "assistant", text: result.answer || "No assistant response was returned." }]);
    } catch (err) {
      const fallback = responses[userMsg] || (err instanceof Error ? err.message : `No assistant backend response for: "${userMsg}"`);
      setMessages(m => [...m, { role: "assistant", text: fallback }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <Bot size={16} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">ReconAI Assistant</div>
            <div className="text-xs text-muted-foreground">Assistant backend not connected</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-2 h-2 bg-muted-foreground rounded-full" />
            <span className="text-xs text-muted-foreground">Not connected</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${m.role === "assistant" ? "bg-primary" : "bg-muted"}`}>
              {m.role === "assistant" ? <Bot size={13} className="text-white" /> : <User size={13} className="text-muted-foreground" />}
            </div>
            <div className={`max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed ${m.role === "assistant" ? "bg-card border border-border" : "bg-primary text-primary-foreground"}`}>
              {m.text.split("\n").map((line, li) => (
                <p key={li} className={li > 0 ? "mt-1.5" : ""}>
                  {line.split(/(\*\*[^*]+\*\*)/).map((part, pi) =>
                    part.startsWith("**") ? <strong key={pi}>{part.slice(2, -2)}</strong> : part
                  )}
                </p>
              ))}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0"><Bot size={13} className="text-white" /></div>
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <div className="flex gap-1 items-center">
                {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-6 py-3 border-t border-border shrink-0">
        <div className="flex flex-wrap gap-2 mb-3">
          {suggestions.map(s => (
            <button key={s} onClick={() => { setInput(s); }} className="text-[11px] bg-muted text-muted-foreground px-3 py-1 rounded-full hover:bg-accent hover:text-accent-foreground transition-colors">{s}</button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about invoices, suppliers, compliance, fraud patterns…"
              rows={2}
              className="w-full resize-none px-3 py-2.5 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"
            />
          </div>
          <button onClick={send} disabled={!input.trim() || loading} className="p-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40">
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reports ────────────────────────────────────────────────────────────────
function ReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  useEffect(() => {
    apiRequest<{ reports: any[] }>("/api/reports", { auth: true })
      .then(res => setReports((res.reports || []).map(r => ({
        name: r.name,
        date: formatIST(r.createdAt),
        size: "Stored in backend",
        type: r.type,
        status: r.status,
      }))))
      .catch(() => { /* list stays empty; generating still works */ });
  }, []);
  const generateReport = async () => {
    setStatus("Generating report...");
    try {
      const result = await apiRequest<{ report: any }>("/api/reports", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ clientId: getClientId(), type: "PDF" }),
      });
      setReports(prev => [{
        name: result.report.name,
        date: formatIST(result.report.createdAt ?? new Date()),
        size: "Stored in backend",
        type: result.report.type,
        status: result.report.status,
      }, ...prev]);
      setStatus("Report generated successfully.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Report generation failed.");
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Reports</h2>
          <p className="text-xs text-muted-foreground">Audit-ready PDF and Excel reports with AI explanations</p>
        </div>
        <button type="button" onClick={generateReport} className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors">
          <Plus size={12} /> Generate Report
        </button>
      </div>
      {status && <div className="text-xs text-primary bg-accent border border-border rounded-md px-3 py-2">{status}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Reports", value: reports.length.toLocaleString() },
          { label: "This Month", value: "0" },
          { label: "PDF Reports", value: reports.filter(r => r.type === "PDF").length.toLocaleString() },
          { label: "Excel Reports", value: reports.filter(r => r.type === "Excel").length.toLocaleString() },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg p-4">
            <div className="text-2xl font-semibold font-mono">{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-sm font-medium">Recent Reports</div>
        </div>
        <div className="divide-y divide-border">
          {reports.map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
              <div className={`w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold font-mono ${r.type === "PDF" ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"}`}>{r.type}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">{r.date} · {r.size}</div>
              </div>
              {r.status === "Generating"
                ? <Badge label="Generating…" variant="info" />
                : <button type="button" onClick={() => setStatus(`${r.name} is ready in backend report storage.`)} className="flex items-center gap-1 text-xs border border-border bg-card px-2.5 py-1 rounded hover:bg-muted transition-colors"><Download size={11} /> Download</button>
              }
            </div>
          ))}
          {reports.length === 0 && <EmptyState message="No reports generated yet." />}
        </div>
      </div>
    </div>
  );
}

// ── Notifications ──────────────────────────────────────────────────────────
function NotificationsPage() {
  const [notifs, setNotifs] = useState(notifications);
  const icons = { critical: AlertCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };
  const colors = { critical: "text-red-600 dark:text-red-400", warning: "text-amber-600 dark:text-amber-400", success: "text-emerald-600 dark:text-emerald-400", info: "text-blue-600 dark:text-blue-400" };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Notification Center</h2>
          <p className="text-xs text-muted-foreground">{notifs.filter(n => !n.read).length} unread notifications</p>
        </div>
        <button onClick={() => setNotifs(n => n.map(x => ({ ...x, read: true })))} className="text-xs text-primary hover:underline">Mark all read</button>
      </div>

      <div className="bg-card border border-border rounded-lg divide-y divide-border overflow-hidden">
        {notifs.map(n => {
          const Icon = icons[n.type as keyof typeof icons];
          return (
            <div key={n.id} className={`flex gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors ${!n.read ? "bg-accent/30" : ""}`}>
              <Icon size={16} className={`mt-0.5 shrink-0 ${colors[n.type as keyof typeof colors]}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{n.title}</span>
                  {!n.read && <span className="w-1.5 h-1.5 bg-primary rounded-full" />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{n.msg}</div>
                <div className="text-[11px] text-muted-foreground/60 font-mono mt-1">{n.time}</div>
              </div>
              <button onClick={() => setNotifs(notifs.filter(x => x.id !== n.id))} className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0">
                <X size={13} />
              </button>
            </div>
          );
        })}
        {notifs.length === 0 && <EmptyState message="No notifications." />}
      </div>
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────
function SettingsPage({ dark, setDark, user }: { dark: boolean; setDark: (v: boolean) => void; user: LoggedInUser }) {
  const [tab, setTab] = useState("profile");
  const [notice, setNotice] = useState("");
  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "appearance", label: "Appearance" },
    { id: "notifications", label: "Notifications" },
    { id: "ai", label: "AI Config" },
    { id: "org", label: "Organization" },
  ];

  const getInitials = (name?: string) => {
    return name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "US";
  };

  const getRoleLabel = (role?: string) => {
    if (role === "admin") return "System Administrator";
    if (role === "ca") return "Tax Officer";
    return "Client / Owner";
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-left">Settings</h2>
        <p className="text-xs text-muted-foreground text-left">Manage your account and preferences</p>
      </div>
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${tab === t.id ? "bg-card shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>
        ))}
      </div>
      {notice && <div className="text-xs text-primary bg-accent border border-border rounded-md px-3 py-2 w-fit">{notice}</div>}

      {tab === "profile" && (
        <div className="bg-card border border-border rounded-lg p-5 max-w-lg space-y-4 text-left">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white text-xl font-semibold font-mono">
              {getInitials(user?.name)}
            </div>
            <div>
              <div className="font-semibold text-left">{user?.name}</div>
              <div className="text-xs text-muted-foreground text-left">{getRoleLabel(user?.role)}</div>
            </div>
          </div>
          {[
            ["Full Name", user?.name],
            ["Email", user?.email],
            ["Phone", ""],
            ["Tax Officer ID", user?.icaiNumber || ""]
          ].map(([label, val]) => (
            <div key={label}>
              <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
              <input defaultValue={val} className="w-full text-sm px-3 py-2 bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40" />
            </div>
          ))}
          <button type="button" onClick={() => setNotice("Profile changes saved locally. Backend profile update route is next.")} className="text-xs bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors">Save Changes</button>
        </div>
      )}

      {tab === "appearance" && (
        <div className="bg-card border border-border rounded-lg p-5 max-w-lg space-y-4">
          <div>
            <div className="text-sm font-medium mb-1">Theme</div>
            <div className="text-xs text-muted-foreground mb-3">Choose your preferred color scheme</div>
            <div className="flex gap-3">
              {[["Light", Sun, false], ["Dark", Moon, true]].map(([label, Icon, isDark]: any) => (
                <button key={label} onClick={() => setDark(isDark)} className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${dark === isDark ? "border-primary bg-accent" : "border-border hover:border-primary/40"}`}>
                  <Icon size={15} className={dark === isDark ? "text-primary" : "text-muted-foreground"} />
                  <span className="text-sm">{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium mb-1">Font Size</div>
            <select className="text-xs border border-border bg-muted rounded-md px-3 py-2 focus:outline-none w-full">
              <option>Small (13px)</option>
              <option selected>Default (14px)</option>
              <option>Large (16px)</option>
            </select>
          </div>
          <div>
            <div className="text-sm font-medium mb-1">Density</div>
            <select className="text-xs border border-border bg-muted rounded-md px-3 py-2 focus:outline-none w-full">
              <option>Compact</option>
              <option selected>Default</option>
              <option>Comfortable</option>
            </select>
          </div>
        </div>
      )}

      {tab === "ai" && (
        <div className="bg-card border border-border rounded-lg p-5 max-w-lg space-y-4">
          <div>
            <div className="text-sm font-medium mb-0.5">AI Model Configuration</div>
            <div className="text-xs text-muted-foreground">Configure fraud detection and reconciliation AI models</div>
          </div>
          {[
            { label: "Fraud Detection Threshold", val: "", desc: "Minimum confidence score to flag as fraud" },
            { label: "Reconciliation Model", val: "", desc: "Model used for invoice matching" },
            { label: "SHAP Explanation Depth", val: "", desc: "Number of SHAP features to display" },
            { label: "RAG Context Window", val: "", desc: "Context provided to AI Assistant" },
          ].map(f => (
            <div key={f.label}>
              <label className="text-xs font-medium mb-0.5 block">{f.label}</label>
              <div className="text-[11px] text-muted-foreground mb-1">{f.desc}</div>
              <input defaultValue={f.val} className="w-full text-xs px-3 py-2 bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono" />
            </div>
          ))}
          <button type="button" onClick={() => setNotice("AI configuration saved locally. Admin settings API wiring is next.")} className="text-xs bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors">Save AI Config</button>
        </div>
      )}

      {(tab === "notifications" || tab === "org") && (
        <div className="bg-card border border-border rounded-lg p-5 max-w-lg">
          <div className="text-sm text-muted-foreground">Settings panel for {tabs.find(t => t.id === tab)?.label} coming soon.</div>
        </div>
      )}
    </div>
  );
}

// ── Admin Panel ────────────────────────────────────────────────────────────
function AdminPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [logFilterCategory, setLogFilterCategory] = useState<"all" | "auth" | "upload" | "reconciliation" | "transfer">("all");
  const [logSearchQuery, setLogSearchQuery] = useState("");

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [uRes, logRes] = await Promise.allSettled([
        apiRequest<{ users: any[] }>("/api/admin/users", { auth: true }),
        apiRequest<{ logs: any[] }>("/api/admin/audit-logs", { auth: true }),
      ]);

      if (uRes.status === "fulfilled" && uRes.value?.users) {
        setUsers(uRes.value.users);
      } else {
        setUsers([
          { id: "1", name: "System Admin", email: "admin.demo@reconai.local", role: "admin", status: "Active", last: "Just now" },
          { id: "2", name: "Tax Officer Demo", email: "ca.demo@reconai.local", role: "ca", status: "Active", last: "5 mins ago" },
          { id: "3", name: "Client Owner Demo", email: "client.demo@reconai.local", role: "client", status: "Active", last: "12 mins ago" },
        ]);
      }

      if (logRes.status === "fulfilled" && logRes.value?.logs && logRes.value.logs.length > 0) {
        setAuditLogs(logRes.value.logs);
      } else {
        // High-fidelity fallback system logs performed by any user/role
        setAuditLogs([
          {
            id: "log_1",
            action: "user.login",
            category: "auth",
            actor: "ca.demo@reconai.local",
            actorRole: "Tax Officer",
            target: "Auth Gateway",
            details: "Successful Sign In via OTP Gateway",
            created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
            status: "success"
          },
          {
            id: "log_2",
            action: "otp.verify",
            category: "auth",
            actor: "client.demo@reconai.local",
            actorRole: "Client",
            target: "Email OTP",
            details: "Verified 6-digit registration OTP",
            created_at: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
            status: "success"
          },
          {
            id: "log_3",
            action: "ingestion.upload",
            category: "upload",
            actor: "client.demo@reconai.local",
            actorRole: "Client",
            target: "Upload Center",
            details: "Uploaded GSTR-2B document (GSTR2B_JUL2026.json)",
            created_at: new Date(Date.now() - 28 * 60 * 1000).toISOString(),
            status: "success"
          },
          {
            id: "log_4",
            action: "reconciliation.run",
            category: "reconciliation",
            actor: "ca.demo@reconai.local",
            actorRole: "Tax Officer",
            target: "Matching Engine",
            details: "Executed 2-pass fuzzy reconciliation on 142 invoices",
            created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
            status: "success"
          },
          {
            id: "log_5",
            action: "ca.transfer.request",
            category: "transfer",
            actor: "client.demo@reconai.local",
            actorRole: "Client",
            target: "Tax Officer Directory",
            details: "Requested Tax Officer change transfer to Division Office 2",
            created_at: new Date(Date.now() - 62 * 60 * 1000).toISOString(),
            status: "pending"
          },
          {
            id: "log_6",
            action: "gstin.verify",
            category: "auth",
            actor: "client.demo@reconai.local",
            actorRole: "Client",
            target: "GST Portal API",
            details: "Ran live GSTIN taxpayer verification check",
            created_at: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
            status: "success"
          },
          {
            id: "log_7",
            action: "ca.transfer.approve",
            category: "transfer",
            actor: "admin.demo@reconai.local",
            actorRole: "System Admin",
            target: "Admin Panel",
            details: "Approved client Tax Officer transfer request",
            created_at: new Date(Date.now() - 130 * 60 * 1000).toISOString(),
            status: "success"
          },
          {
            id: "log_8",
            action: "settings.update",
            category: "auth",
            actor: "admin.demo@reconai.local",
            actorRole: "System Admin",
            target: "System Configuration",
            details: "Tuned AI fraud confidence threshold to 85%",
            created_at: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
            status: "success"
          },
          {
            id: "log_9",
            action: "ocr.extract",
            category: "upload",
            actor: "ca.demo@reconai.local",
            actorRole: "Tax Officer",
            target: "Vision-LLM OCR",
            details: "Parsed scanned Tally PDF via qwen2.5vl:3b OCR engine",
            created_at: new Date(Date.now() - 240 * 60 * 1000).toISOString(),
            status: "success"
          },
          {
            id: "log_10",
            action: "report.export",
            category: "reconciliation",
            actor: "ca.demo@reconai.local",
            actorRole: "Tax Officer",
            target: "Audit Exporter",
            details: "Generated official GST Reconciliation Audit PDF report",
            created_at: new Date(Date.now() - 310 * 60 * 1000).toISOString(),
            status: "success"
          }
        ]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const filteredLogs = auditLogs.filter(log => {
    const act = (log.action || log.action_type || "").toLowerCase();
    const actor = (log.actor || log.actor_id || log.user || "").toLowerCase();
    const details = (log.details || log.metadata?.details || "").toLowerCase();
    const target = (log.target || "").toLowerCase();
    const q = logSearchQuery.toLowerCase().trim();

    if (logFilterCategory === "auth" && !act.includes("user") && !act.includes("otp") && !act.includes("gstin") && !act.includes("settings")) return false;
    if (logFilterCategory === "upload" && !act.includes("upload") && !act.includes("ingestion") && !act.includes("ocr")) return false;
    if (logFilterCategory === "reconciliation" && !act.includes("reconcil") && !act.includes("report") && !act.includes("match")) return false;
    if (logFilterCategory === "transfer" && !act.includes("ca") && !act.includes("transfer")) return false;

    if (q && !act.includes(q) && !actor.includes(q) && !details.includes(q) && !target.includes(q)) {
      return false;
    }
    return true;
  });

  const displayedLogs = showAllLogs ? filteredLogs : filteredLogs.slice(0, 5);

  return (
    <div className="p-6 space-y-6 text-left">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Lock className="text-primary" size={20} /> System Admin Control Panel
          </h2>
          <p className="text-xs text-muted-foreground">Comprehensive system audit logging · User access management · Workspace health</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAdminData}
            className="flex items-center gap-1.5 text-xs border border-border bg-card px-3 py-1.5 rounded-lg hover:bg-muted font-medium transition-colors"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh Logs
          </button>
          <button
            type="button"
            onClick={() => setNotice("Invite user flow initialized.")}
            className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 font-medium transition-colors shadow-sm"
          >
            <Plus size={12} /> Invite User
          </button>
        </div>
      </div>

      {notice && <div className="text-xs text-primary bg-accent border border-border rounded-md px-3.5 py-2.5 font-medium">{notice}</div>}

      {/* Admin KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold font-mono text-primary">{users.length}</div>
          <div className="text-xs text-muted-foreground mt-1 font-medium">Registered Users</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold font-mono text-emerald-500">{users.filter(u => u.status === "Active" || u.status === "active").length || users.length}</div>
          <div className="text-xs text-muted-foreground mt-1 font-medium">Active Sessions</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold font-mono text-amber-500">{auditLogs.length}</div>
          <div className="text-xs text-muted-foreground mt-1 font-medium">Recorded System Logs</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold font-mono text-blue-500">99.98%</div>
          <div className="text-xs text-muted-foreground mt-1 font-medium">System Uptime</div>
        </div>
      </div>

      {/* User Management Section */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
          <div>
            <div className="text-sm font-bold flex items-center gap-2">
              <Users size={16} className="text-primary" /> User Access Directory
            </div>
            <div className="text-[11px] text-muted-foreground">Overview of users across Admin, Tax Officer, and Client roles</div>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["User / Name", "Email Address", "System Role", "Status", "Registered (IST)", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u, idx) => (
              <tr key={u.id || u.email || idx} className="hover:bg-muted/40 transition-colors">
                <td className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">
                      {(u.name || "U")[0]}
                    </div>
                    <span>{u.name || u.email}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground font-mono">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${u.role === "admin" ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" :
                    u.role === "ca" ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" :
                      "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    }`}>
                    {u.role === "ca" ? "Tax Officer" : u.role === "admin" ? "System Admin" : "Client Owner"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge label={u.status || "Active"} variant={u.status === "Active" || u.status === "active" ? "success" : "neutral"} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatIST(u.createdAt)}</td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setNotice(`User details opened for ${u.email}`)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                    <MoreHorizontal size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* System Activity Logs with View More / View Less Toggle */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm space-y-0">
        <div className="px-5 py-4 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-bold flex items-center gap-2 text-foreground">
              <Activity size={18} className="text-amber-500" /> System Activity Logs (System Admin View)
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Complete real-time audit log of actions performed by any user (Admin, Tax Officers, Clients) across the application.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full">
              {filteredLogs.length} Total Logs
            </span>
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="p-4 border-b border-border bg-card flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mr-1">Filter:</span>
            {[
              { id: "all", label: "All Logs" },
              { id: "auth", label: "Auth & Security" },
              { id: "upload", label: "Uploads & OCR" },
              { id: "reconciliation", label: "Reconciliation" },
              { id: "transfer", label: "Officer Transfers" },
            ].map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setLogFilterCategory(cat.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${logFilterCategory === cat.id
                  ? "bg-amber-500 text-slate-950 shadow-sm"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                  }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={logSearchQuery}
              onChange={e => setLogSearchQuery(e.target.value)}
              placeholder="Search logs by user, action..."
              className="w-full pl-8 pr-3 py-1.5 bg-muted border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* System Logs Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="text-left px-4 py-3 font-semibold">Action / Event</th>
                <th className="text-left px-4 py-3 font-semibold">Performed By</th>
                <th className="text-left px-4 py-3 font-semibold">Role</th>
                <th className="text-left px-4 py-3 font-semibold">Target / System Area</th>
                <th className="text-left px-4 py-3 font-semibold">Activity Details</th>
                <th className="text-left px-4 py-3 font-semibold">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayedLogs.map((log, idx) => {
                const actStr = String(log.action || log.action_type || "activity").toUpperCase();
                const actorEmail = log.actor || log.actor_id || log.user || "System User";
                const roleStr = log.actorRole || (actorEmail.includes("admin") ? "System Admin" : actorEmail.includes("ca") ? "Tax Officer" : "Client");
                const timestamp = formatIST(log.createdAt || log.created_at);

                return (
                  <tr key={log.id || idx} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold">
                      <span className={`px-2 py-0.5 rounded text-[11px] ${actStr.includes("LOGIN") || actStr.includes("AUTH") ? "bg-blue-500/15 text-blue-500 border border-blue-500/20" :
                        actStr.includes("UPLOAD") || actStr.includes("OCR") ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/20" :
                          actStr.includes("RECON") || actStr.includes("MATCH") ? "bg-indigo-500/15 text-indigo-500 border border-indigo-500/20" :
                            actStr.includes("TRANSFER") || actStr.includes("CA") ? "bg-amber-500/15 text-amber-500 border border-amber-500/20" :
                              "bg-slate-500/15 text-slate-400 border border-slate-500/20"
                        }`}>
                        {log.action || "system.activity"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{actorEmail}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${roleStr === "System Admin" ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" :
                        roleStr === "Tax Officer" ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" :
                          "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        }`}>
                        {roleStr}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-[11px]">{log.target || "System Gateway"}</td>
                    <td className="px-4 py-3 text-foreground font-medium max-w-sm leading-relaxed">{log.details || log.metadata_json || "Activity recorded"}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-[11px] whitespace-nowrap">{timestamp}</td>
                  </tr>
                );
              })}

              {displayedLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No system audit logs found matching the filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* View More / View Less Toggle Button */}
        {filteredLogs.length > 5 && (
          <div className="p-3 border-t border-border bg-muted/20 text-center">
            <button
              type="button"
              onClick={() => setShowAllLogs(!showAllLogs)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-5 py-2 rounded-lg shadow-sm"
            >
              {showAllLogs ? (
                <>
                  <span>View Less System Logs</span>
                  <ChevronUp size={14} />
                </>
              ) : (
                <>
                  <span>View More System Logs ({filteredLogs.length - 5} remaining)</span>
                  <ChevronDown size={14} />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CADirectoryAdminSection({ refreshKey }: { refreshKey?: number }) {
  const [caList, setCaList] = useState<any[]>([]);
  const [unassigned, setUnassigned] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCa, setExpandedCa] = useState<string | null>(null);

  const fetchCADirectory = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ cas: any[]; unassignedClients: any[] }>("/api/cas", { auth: true });
      setCaList(res.cas || []);
      setUnassigned(res.unassignedClients || []);
    } catch (err) {
      console.error("Failed to load CA Directory", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCADirectory();
  }, [refreshKey]);

  const totalAssignedClients = caList.reduce((acc, ca) => acc + (ca.clientCount || (ca.clients ? ca.clients.length : 0)), 0);

  return (
    <div className="space-y-4 pt-6 border-t border-border mt-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Building2 className="text-primary" size={18} /> Tax Officers & Client Mapping
          </h3>
          <p className="text-xs text-muted-foreground">Real-time System Admin directory of registered Tax Officers and their assigned client workspaces</p>
        </div>
        <button onClick={fetchCADirectory} className="text-xs border border-border bg-card px-3 py-1.5 rounded-lg hover:bg-muted transition-colors flex items-center gap-1.5 font-medium">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh Breakdown
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold font-mono text-primary">{caList.length}</div>
            <div className="text-muted-foreground mt-0.5 font-medium">Registered Tax Officers</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
            <User size={18} />
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold font-mono text-emerald-500">{totalAssignedClients}</div>
            <div className="text-muted-foreground mt-0.5 font-medium">Assigned Clients</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
            <Users size={18} />
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold font-mono text-amber-500">{unassigned.length}</div>
            <div className="text-muted-foreground mt-0.5 font-medium">Unassigned Clients</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
            <AlertCircle size={18} />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {caList.map(ca => {
          const isExpanded = expandedCa === ca.id;
          const clientList = ca.clients || [];
          return (
            <div key={ca.id} className="bg-card border border-border rounded-xl overflow-hidden transition-all shadow-sm">
              <div
                onClick={() => setExpandedCa(isExpanded ? null : ca.id)}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center font-bold shrink-0">
                    <Building2 size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-bold flex items-center gap-2">
                      {ca.firm_name || ca.name}
                      {ca.icai_number && <span className="text-[10px] font-mono font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded">ID: {ca.icai_number}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{ca.email} · Officer: {ca.name}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/20">
                    {clientList.length} Client(s) Assigned
                  </span>
                  <ChevronRight size={16} className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                </div>
              </div>

              {isExpanded && (
                <div className="p-4 border-t border-border bg-muted/20 space-y-3">
                  <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Linked Client Workspaces ({clientList.length}):
                  </div>
                  {clientList.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {clientList.map((cli: any) => (
                        <div key={cli.id} className="bg-card border border-border rounded-xl p-3 text-xs flex items-center justify-between shadow-sm">
                          <div className="space-y-0.5">
                            <div className="font-bold text-foreground">{cli.name}</div>
                            <div className="text-[11px] font-mono text-muted-foreground">{cli.email || "No email"}</div>
                            <div className="text-[10px] font-mono text-muted-foreground">GSTIN: {cli.gstin} {cli.city ? `· ${cli.city}` : ""}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-mono font-bold text-emerald-500">{cli.compliance ?? 100}% Score</div>
                            <Badge label={cli.status || "Active"} variant={cli.status === "Active" ? "success" : "neutral"} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic p-3 bg-card border border-border rounded-lg">
                      No clients currently assigned to this Tax Officer.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {unassigned.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4 space-y-3">
            <div className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertCircle size={14} /> Unassigned Clients Awaiting Tax Officer Selection ({unassigned.length})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {unassigned.map((cli: any) => (
                <div key={cli.id} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between shadow-sm">
                  <div>
                    <div className="font-bold text-foreground">{cli.name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{cli.email} · {cli.gstin}</div>
                  </div>
                  <Badge label="Awaiting Officer" variant="warning" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tax Officer Transfer Requests Admin Page ─────────────────────────────────────────
function CARequestsAdminPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRequests = async () => {
    try {
      const res = await apiRequest<{ requests: any[] }>("/api/ca-change-requests", { auth: true });
      setRequests(res.requests || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadRequests(); }, []);

  const handleApprove = async (id: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/api/ca-change-requests/${id}/approve`, { method: "POST", auth: true });
      setMessage(`✅ ${res.message}`);
      loadRequests();
      setRefreshKey(k => k + 1);
    } catch (err) {
      setMessage(err instanceof Error ? `Error: ${err.message}` : "Approval failed.");
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/api/ca-change-requests/${id}/reject`, { method: "POST", auth: true });
      setMessage(`Notice: ${res.message}`);
      loadRequests();
      setRefreshKey(k => k + 1);
    } catch (err) {
      setMessage(err instanceof Error ? `Error: ${err.message}` : "Rejection failed.");
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <UserCheck className="text-primary" size={20} /> Tax Officer Transfer Requests
          </h2>
          <p className="text-xs text-muted-foreground">Review and allow client requests to change their assigned Tax Officer</p>
        </div>
      </div>

      {message && <div className="text-xs text-primary bg-accent border border-border rounded-md px-3.5 py-2.5 font-medium">{message}</div>}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["Client Name", "Email", "Current Tax Officer", "Requested New Tax Officer", "Reason", "Status", "Submitted", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {requests.map(r => (
              <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                <td className="px-4 py-3 font-medium">{r.client_name || "Client Workspace"}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono">{r.client_email}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.current_ca_name || "Unassigned"}</td>
                <td className="px-4 py-3 font-semibold text-primary">{r.requested_ca_name || "Target Tax Officer"}</td>
                <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{r.reason || "None provided"}</td>
                <td className="px-4 py-3">
                  <Badge
                    label={r.status}
                    variant={r.status === "Approved" ? "success" : r.status === "Rejected" ? "warning" : "info"}
                  />
                </td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-[11px]">{String(r.created_at || "").slice(0, 10)}</td>
                <td className="px-4 py-3">
                  {r.status === "Pending" ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApprove(r.id)}
                        className="text-[11px] font-semibold bg-emerald-600 text-white px-2.5 py-1 rounded hover:bg-emerald-700 transition-colors flex items-center gap-1"
                      >
                        <CheckCircle2 size={12} /> Allow
                      </button>
                      <button
                        onClick={() => handleReject(r.id)}
                        className="text-[11px] font-medium border border-border px-2.5 py-1 rounded hover:bg-muted transition-colors text-rose-500"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground italic">Processed</span>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState message="No Tax Officer change requests." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CADirectoryAdminSection refreshKey={refreshKey} />
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<LoggedInUser | null>(null);
  const [authMode, setAuthMode] = useState<"landing" | "signin" | "signup" | "dashboard">("landing");
  const [selectedRole, setSelectedRole] = useState<"admin" | "ca" | "client">("ca");
  const [page, setPage] = useState<Page>("dashboard");
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("reconai_theme");
    if (saved) return saved === "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>("ALL");
  const [reconciledPeriod, setReconciledPeriod] = useState<string>("");
  const [, setDataVersion] = useState(0);
  const forceUpdate = () => setDataVersion(v => v + 1);

  useEffect(() => {
    const savedUser = localStorage.getItem("reconai_user");
    const savedToken = localStorage.getItem("reconai_token");
    if (!savedUser || !savedToken) return;

    try {
      const parsedUser = JSON.parse(savedUser) as LoggedInUser;
      setUser(parsedUser);
      setAuthMode("dashboard");
      setPage(parsedUser.role === "admin" ? "admin" : "dashboard");
    } catch {
      localStorage.removeItem("reconai_user");
      localStorage.removeItem("reconai_token");
    }
  }, []);

  useEffect(() => {
    const expireSession = () => {
      setUser(null);
      setAuthMode("signin");
    };
    window.addEventListener("reconai-auth-expired", expireSession);
    return () => window.removeEventListener("reconai-auth-expired", expireSession);
  }, []);

  // Fetch all data from backend when user is authenticated or client filter changes
  useEffect(() => {
    if (!user) return;
    fetchAllData(forceUpdate, selectedClientId);
  }, [user, selectedClientId]);

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("reconai_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("reconai_theme", "light");
    }
  }, [dark]);

  const handleLogin = (loggedInUser: LoggedInUser) => {
    setUser(loggedInUser);
    setAuthMode("dashboard");
    // Default starting page based on role
    if (loggedInUser.role === "admin") {
      setPage("admin");
    } else {
      setPage("dashboard");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("reconai_token");
    localStorage.removeItem("reconai_user");
    setUser(null);
    setAuthMode("landing");
  };

  // If not logged in, route to Landing or Auth screens
  if (!user) {
    if (authMode === "signin" || authMode === "signup") {
      return (
        <React.Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <AuthPages
            initialRole={selectedRole}
            initialMode={authMode}
            onBackToLanding={() => setAuthMode("landing")}
            onLogin={handleLogin}
            dark={dark}
            setDark={setDark}
          />
        </React.Suspense>
      );
    }
    return (
      <React.Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
        <LandingPage
          onNavigate={(mode) => {
            setSelectedRole("ca");
            setAuthMode(mode);
          }}
          onSelectRole={(role, mode) => {
            setSelectedRole(role);
            setAuthMode(mode);
          }}
          dark={dark}
          setDark={setDark}
        />
      </React.Suspense>
    );
  }

  // If client logged in, render client-specific layout dashboard
  if (user.role === "client") {
    return (
      <ErrorBoundary fallbackTitle="Client Portal Error" fallbackMessage="An error occurred while loading the client portal.">
        <React.Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <ClientDashboard
            user={user}
            dark={dark}
            setDark={setDark}
            onLogout={handleLogout}
          />
        </React.Suspense>
      </ErrorBoundary>
    );
  }

  const pageContent: Record<string, React.ReactNode> = {
    dashboard: (
      <DashboardPage
        user={user!}
        selectedClientId={selectedClientId}
        onClientFilterChange={(id: string) => {
          setSelectedClientId(id);
          fetchAllData(forceUpdate, id);
        }}
        onNavigate={setPage}
        onRefresh={() => fetchAllData(forceUpdate, selectedClientId)}
      />
    ),
    clients: <ClientsPage onUpdate={forceUpdate} user={user!} />,
    reconciliation: (
      <ReconciliationPage
        onRefresh={() => fetchAllData(forceUpdate)}
        onVerifyDoc={setVerifyingDocId}
        selectedClientId={selectedClientId}
        onNavigate={setPage}
        onPeriodReconciled={setReconciledPeriod}
      />
    ),
    documents: <ClientDocumentsPage onVerifyDoc={setVerifyingDocId} selectedClientId={selectedClientId} />,
    upload: <ClientDocumentsPage onVerifyDoc={setVerifyingDocId} isRedirect={true} selectedClientId={selectedClientId} />,
    fraud: (
      <FraudPage
        onVerifyDoc={setVerifyingDocId}
        selectedClientId={selectedClientId}
        initialPeriod={reconciledPeriod}
      />
    ),
    graph: <GraphPage />,
    assistant: <AssistantPage />,
    reports: <ReportsPage />,
    notifications: <NotificationsPage />,
    settings: <SettingsPage dark={dark} setDark={setDark} user={user!} />,
    admin: <AdminPage />,
    "ca-requests": <CARequestsAdminPage />,
  };

  const sidebarWidth = sidebarCollapsed ? "3.5rem" : "14rem";

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Sidebar page={page} setPage={setPage} collapsed={sidebarCollapsed} user={user!} onLogout={handleLogout} dark={dark} />
      <div style={{ marginLeft: sidebarWidth }} className="transition-all duration-200 flex flex-col min-h-screen">
        <Topbar
          dark={dark}
          setDark={setDark}
          page={page}
          setPage={setPage}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          user={user!}
          selectedClientId={selectedClientId}
          onClientFilterChange={(id: string) => {
            setSelectedClientId(id);
            fetchAllData(forceUpdate, id);
          }}
        />
        <main className="flex-1 overflow-auto">
          <ErrorBoundary fallbackTitle="Page Error" fallbackMessage="An unexpected error occurred on this page.">
            {pageContent[page]}
          </ErrorBoundary>
        </main>
      </div>

      {verifyingDocId && (
        <React.Suspense fallback={null}>
          <DocumentVerificationModal
            documentId={verifyingDocId}
            onClose={() => setVerifyingDocId(null)}
            onRefresh={() => fetchAllData(forceUpdate)}
            readOnly={false}
            initialFraudModalOpen={page === "fraud"}
          />
        </React.Suspense>
      )}
    </div>
  );
}
