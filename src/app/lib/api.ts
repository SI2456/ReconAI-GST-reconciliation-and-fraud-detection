const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

type ApiOptions = RequestInit & {
  auth?: boolean;
};

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  }

  if (options.auth !== false) {
    const token = localStorage.getItem("reconai_token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.detail || payload.error || "Request failed.";
    if (options.auth !== false && (response.status === 401 || String(message).toLowerCase().includes("token"))) {
      localStorage.removeItem("reconai_token");
      localStorage.removeItem("reconai_user");
      window.dispatchEvent(new Event("reconai-auth-expired"));
      throw new Error("Session expired. Please sign in again.");
    }
    throw new Error(message);
  }

  return payload as T;
}

// Protected files can't be loaded via a plain <a href>/<img src>/<iframe src>
// because those don't send the bearer token. Fetch them here and hand back an
// object URL; callers must URL.revokeObjectURL() it when done.
export async function fetchFileObjectUrl(path: string): Promise<string> {
  const headers = new Headers();
  const token = localStorage.getItem("reconai_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Could not load file (${response.status}).`);
  }
  return URL.createObjectURL(await response.blob());
}

export async function openProtectedFile(path: string): Promise<void> {
  // Open the tab synchronously so popup blockers treat it as user-initiated.
  const tab = window.open("", "_blank");
  try {
    const url = await fetchFileObjectUrl(path);
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "ca" | "client";
  firmName?: string;
  gstin?: string;
  icaiNumber?: string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};
