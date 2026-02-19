export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: string; // ISO
};

export type Settings = {
  language: string;
  voice: string;
  wakeWordEnabled: boolean;
};

export type HealthResponse = unknown;

const DEFAULT_BASE_URL = "http://localhost:3001";

/**
 * PUBLIC_INTERFACE
 * Returns backend base URL (prefer NEXT_PUBLIC_BACKEND_URL if set).
 */
export function getBackendBaseUrl(): string {
  // IMPORTANT: Must be NEXT_PUBLIC_* to be readable in the browser.
  return process.env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BASE_URL;
}

/**
 * PUBLIC_INTERFACE
 * Low-level fetch wrapper with JSON handling and good error messages.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = getBackendBaseUrl().replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `API ${res.status} ${res.statusText} for ${path}${text ? `: ${text}` : ""}`,
    );
  }

  // Some endpoints might return empty body.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    // @ts-expect-error allow void/unknown
    return (undefined as T) ?? (null as T);
  }
  return (await res.json()) as T;
}

/**
 * PUBLIC_INTERFACE
 * Health check for connectivity indicator.
 */
export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/", { method: "GET" });
}

/**
 * PUBLIC_INTERFACE
 * Loads chat history.
 *
 * Note: backend currently doesn't expose this yet; this is wired so that when
 * backend adds /history it will "just work". For now, caller should handle errors.
 */
export async function getHistory(): Promise<ChatMessage[]> {
  return apiFetch<ChatMessage[]>("/history", { method: "GET" });
}

/**
 * PUBLIC_INTERFACE
 * Sends an audio blob for STT→LLM→TTS pipeline.
 *
 * Note: backend currently doesn't expose this yet; kept as forward-compatible contract.
 */
export async function sendAudioForAssistant(params: {
  audio: Blob;
  language: string;
  voice: string;
}): Promise<{ transcript: string; replyText: string; ttsAudioUrl?: string }> {
  const form = new FormData();
  form.append("audio", params.audio, "audio.webm");
  form.append("language", params.language);
  form.append("voice", params.voice);

  const base = getBackendBaseUrl().replace(/\/$/, "");
  const url = `${base}/assist`;

  const res = await fetch(url, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `API ${res.status} ${res.statusText} for /assist${text ? `: ${text}` : ""}`,
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as {
      transcript: string;
      replyText: string;
      ttsAudioUrl?: string;
    };
  }

  // If backend returns audio directly later, we'll support it; for now return minimal.
  return { transcript: "", replyText: "", ttsAudioUrl: undefined };
}
