import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Building, KeyRound, Loader2, Lock, Mail, Moon, Phone, RotateCcw, Shield, Sun, User } from "lucide-react";
import { apiRequest, type AuthResponse } from "../lib/api";

import lightLogoImg from "../../assets/Screenshot_2026-07-01_214942-removebg-preview.png";
import darkLogoImg from "../../assets/darkThemeLogo.png";

interface AuthPagesProps {
  initialRole: "admin" | "ca" | "client";
  initialMode: "signin" | "signup";
  onBackToLanding: () => void;
  dark?: boolean;
  setDark?: (dark: boolean | ((prev: boolean) => boolean)) => void;
  onLogin: (user: {
    name: string;
    email: string;
    role: "admin" | "ca" | "client";
    firmName?: string;

    gstin?: string;
    icaiNumber?: string;
  }) => void;
}

type AuthMode = "signin" | "signup" | "verify" | "forgot" | "reset";

export default function AuthPages({ initialRole, initialMode, onBackToLanding, onLogin, dark = false, setDark }: AuthPagesProps) {
  const [role, setRole] = useState<"admin" | "ca" | "client">(initialRole);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [phone, setPhone] = useState("");
  const [clientBusinessName, setClientBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const finishLogin = (result: AuthResponse) => {
    localStorage.setItem("reconai_token", result.token);
    localStorage.setItem("reconai_user", JSON.stringify(result.user));
    onLogin(result.user);
  };

  const handleSignIn = async () => {
    const result = await apiRequest<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      auth: false,
    });
    const roleLabel = result.user.role === "ca" ? "Tax Officer" : result.user.role === "client" ? "Client" : "System Admin";
    if (result.user.role !== role) throw new Error(`This account is registered as ${roleLabel}. Select that role to continue.`);
    finishLogin(result);
  };

  const handleRegister = async () => {
    if (!name.trim()) throw new Error("Please provide your full legal name.");
    if (!clientBusinessName.trim()) throw new Error("Please provide your business name.");

    const result = await apiRequest<{ message: string; email: string }>("/api/auth/register", {
      method: "POST",
      auth: false,
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: "client",
        phone: phone.trim(),
        businessName: clientBusinessName.trim(),
        city: city.trim(),
      }),
    });
    setNotice(result.message);
    setOtp("");
    setMode("verify");
  };

  const handleVerifyOtp = async () => {
    const result = await apiRequest<AuthResponse>("/api/auth/verify-otp", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, otp }),
    });
    finishLogin(result);
  };

  const handleForgotPassword = async () => {
    const result = await apiRequest<{ message: string }>("/api/auth/forgot-password", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email }),
    });
    setNotice(result.message);
    setOtp("");
    setMode("reset");
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    const result = await apiRequest<{ message: string }>("/api/auth/reset-password", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, otp, password: newPassword }),
    });
    setNotice(result.message);
    setPassword("");
    setNewPassword("");
    setOtp("");
    setMode("signin");
  };

  const handleResendOtp = async (purpose: "registration" | "password_reset" = "registration") => {
    const result = await apiRequest<{ message: string }>("/api/auth/resend-otp", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, purpose }),
    });
    setNotice(result.message);
    setOtp("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if ((mode === "signin" || mode === "signup") && !password) {
      setError("Please enter your password.");
      return;
    }
    if ((mode === "verify" || mode === "reset") && otp.trim().length !== 6) {
      setError("Please enter the 6-digit OTP.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signin") await handleSignIn();
      if (mode === "signup") await handleRegister();
      if (mode === "verify") await handleVerifyOtp();
      if (mode === "forgot") await handleForgotPassword();
      if (mode === "reset") await handleResetPassword();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const resetDemoAccount = () => {
    const demoEmailByRole = {
      admin: "admin.demo@reconai.local",
      ca: "ca.demo@reconai.local",
      client: "client.demo@reconai.local",
    };
    setMode("signin");
    setEmail(demoEmailByRole[role]);
    setPassword("Demo@123");
    setError("");
    setNotice("");
  };

  const title = mode === "signin" ? "Sign In to ReconAI" : mode === "signup" ? "Register Client Account" : mode === "verify" ? "Verify Email OTP" : mode === "forgot" ? "Forgot Password" : "Reset Password";
  const subtitle = mode === "signup" ? "Create your client workspace. Tax officers and administrators are added by the system admin." : "Use your verified email credentials to continue.";

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 relative overflow-hidden transition-colors duration-200" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-amber-500/5 rounded-full blur-[120px]" />

      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-12 bg-card border border-border rounded-2xl overflow-hidden shadow-2xl relative z-10">
        <div className="md:col-span-5 bg-muted/40 p-8 flex flex-col justify-between border-r border-border text-left">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button onClick={onBackToLanding} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium">
                <ArrowLeft size={13} /> Back to main
              </button>
              {setDark && (
                <button
                  type="button"
                  onClick={() => setDark(prev => !prev)}
                  aria-label={dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  title={dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  className="p-1.5 rounded-lg border border-border hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
                >
                  {dark ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-indigo-600" />}
                </button>
              )}
            </div>
            <div className="h-10 flex items-center">
              <img src={lightLogoImg} alt="ReconAI Logo" className="dark:hidden h-10 object-contain" />
              <img src={darkLogoImg} alt="ReconAI Logo" className="hidden dark:block h-10 object-contain" />
            </div>
            <div className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight text-primary">Secure Compliance Gateway</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Email OTP protects account registration and password reset. Tax officers and administrators are provisioned directly through the admin dashboard.
              </p>
            </div>
          </div>
          <div className="space-y-4 pt-8 md:pt-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20"><Shield size={16} /></div>
              <div className="text-left">
                <div className="text-[11px] font-bold uppercase tracking-wider text-foreground">OTP Verification</div>
                <div className="text-[10px] text-muted-foreground">Secure email OTP with 10-minute validity</div>
              </div>
            </div>
            <div className="border-t border-border pt-4 text-[10px] text-muted-foreground font-mono">ReconAI Auth Gateway</div>
          </div>
        </div>

        <div className="md:col-span-7 p-8 md:p-12 flex flex-col justify-center text-left bg-card">
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            </div>

            {mode === "signin" && (
              <div className="flex bg-muted/60 p-1 rounded-xl border border-border">
                {(["ca", "client", "admin"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => { setRole(r); setError(""); }}
                    className={`flex-1 text-center py-2 text-xs rounded-lg font-semibold transition-all ${
                      role === r
                        ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                    }`}
                  >
                    {r === "ca" ? "Tax Officer" : r === "client" ? "Client Owner" : "System Admin"}
                  </button>
                ))}
              </div>
            )}

            {error && <div className="text-xs bg-destructive/10 border border-destructive/30 text-destructive p-3 rounded-lg font-medium">{error}</div>}
            {notice && <div className="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-lg font-medium">{notice}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <Field icon={<User size={14} />} label="Full Name" value={name} onChange={setName} placeholder="Full legal name" />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field icon={<Mail size={14} />} label="Email Address" value={email} onChange={setEmail} placeholder="name@company.com" type="email" />
                {(mode === "signin" || mode === "signup") && <Field icon={<Lock size={14} />} label="Password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" type="password" />}
                {mode === "reset" && <Field icon={<Lock size={14} />} label="New Password" value={newPassword} onChange={setNewPassword} placeholder="Minimum 8 characters" type="password" />}
                {(mode === "verify" || mode === "reset") && <Field icon={<KeyRound size={14} />} label="6-Digit OTP" value={otp} onChange={setOtp} placeholder="123456" />}
              </div>

              {mode === "signup" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field icon={<Building size={14} />} label="Business Name" value={clientBusinessName} onChange={setClientBusinessName} placeholder="Registered business name" />
                  <Field icon={<Building size={14} />} label="City" value={city} onChange={setCity} placeholder="e.g. Mumbai" />
                </div>
              )}

              {mode === "signup" && (
                <Field icon={<Phone size={14} />} label="Phone Number" value={phone} onChange={setPhone} placeholder="+91 98765 43210" />
              )}

              {mode === "signin" && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <button type="button" onClick={resetDemoAccount} className="inline-flex items-center gap-1 text-primary hover:underline font-medium">
                    <RotateCcw size={11} /> Reset demo account
                  </button>
                  <button type="button" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }} className="text-primary hover:underline font-medium">Forgot password?</button>
                </div>
              )}

              {(mode === "verify" || mode === "reset") && (
                <button type="button" onClick={() => handleResendOtp(mode === "verify" ? "registration" : "password_reset")} className="text-xs text-primary hover:underline font-medium">
                  Resend OTP
                </button>
              )}

              <button disabled={loading} className="w-full py-2.5 mt-4 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all flex items-center justify-center gap-2 text-xs shadow-sm shadow-primary/20 disabled:opacity-50 cursor-pointer">
                {loading ? <><Loader2 size={14} className="animate-spin" /> Processing...</> : <span>{mode === "signin" ? `Sign In as ${role === "ca" ? "Tax Officer" : role === "client" ? "Client" : "System Admin"}` : mode === "signup" ? "Register Client Account & Send OTP" : mode === "verify" ? "Verify OTP" : mode === "forgot" ? "Send Reset OTP" : "Reset Password"}</span>}
              </button>
            </form>

            <div className="text-center pt-2 text-xs text-muted-foreground">
              {mode !== "signin" && <button type="button" onClick={() => { setMode("signin"); setError(""); setNotice(""); }} className="text-primary font-semibold hover:underline">Back to Sign In</button>}
              {mode === "signin" && <>Don't have an account? <button type="button" onClick={() => { setRole("client"); setMode("signup"); setError(""); setNotice(""); }} className="text-primary font-semibold hover:underline">Register Client Account</button></>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, value, onChange, placeholder, type = "text", compact = false }: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  compact?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full text-xs pl-9 pr-3 ${compact ? "py-2" : "py-2.5"} bg-muted/40 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/25 transition-colors`}
        />
      </div>
    </div>
  );
}
