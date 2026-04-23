import AsyncStorage from "@react-native-async-storage/async-storage";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "autosocial_token";

export async function getToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null) {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
  auth?: boolean;
};

export async function apiFetch<T = any>(path: string, opts: Options = {}): Promise<T> {
  const url = `${BACKEND_URL}/api${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const token = await getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : "Something went wrong");
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string, full_name?: string) =>
    apiFetch("/auth/register", { method: "POST", body: { email, password, full_name }, auth: false }),
  login: (email: string, password: string) =>
    apiFetch("/auth/login", { method: "POST", body: { email, password }, auth: false }),
  me: () => apiFetch("/auth/me"),
  saveBusiness: (b: any) => apiFetch("/business", { method: "POST", body: b }),
  getBusiness: () => apiFetch("/business"),
  listConnections: () => apiFetch("/social/connections"),
  connectSocial: (platform: string, account_name: string) =>
    apiFetch("/social/connections", { method: "POST", body: { platform, account_name } }),
  disconnectSocial: (platform: string) =>
    apiFetch(`/social/connections/${platform}`, { method: "DELETE" }),
  uploadImage: (image_base64: string, mime_type: string) =>
    apiFetch("/uploads", { method: "POST", body: { image_base64, mime_type } }),
  generateImages: (payload: any) => apiFetch("/generate/images", { method: "POST", body: payload }),
  generateCaptions: (payload: any) => apiFetch("/generate/captions", { method: "POST", body: payload }),
  createPost: (payload: any) => apiFetch("/posts", { method: "POST", body: payload }),
  listPosts: () => apiFetch("/posts"),
  dashboard: () => apiFetch("/dashboard/summary"),
  usageToday: () => apiFetch("/usage/today"),
  selectGeneratedImage: (id: string) =>
    apiFetch(`/generated-images/${id}/select`, { method: "POST" }),
};
