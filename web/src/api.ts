import { readJSON, remove, writeJSON } from "./storage";

// All calls go to the same origin. On here.now, /api/* and /events are proxy
// routes that add the backend key server-side; the browser never sees it.

const TOKEN_KEY = "dubdeck.session";
const TRANSPORT_KEY = "dubdeck.transport";

type Transport = "header" | "query";

let token: string | null = readJSON<string>(TOKEN_KEY);
let transport: Transport = readJSON<Transport>(TRANSPORT_KEY) ?? "header";
let onSessionLost: ((reason: ApiError) => void) | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

export function setSession(t: string | null) {
  token = t;
  if (t) writeJSON(TOKEN_KEY, t);
  else remove(TOKEN_KEY);
}

export function hasSession() {
  return Boolean(token);
}

export function onUnauthorized(fn: (reason: ApiError) => void) {
  onSessionLost = fn;
}

function withAuth(path: string, headers: Record<string, string>): string {
  if (!token) return path;
  if (transport === "header") {
    headers["X-DubDeck-Session"] = token;
    return path;
  }
  return `${path}${path.includes("?") ? "&" : "?"}dd_session=${encodeURIComponent(token)}`;
}

function statusMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504 || status === 520 || status === 530) {
    return "Can't reach your DubDeck server. Is your PC on and the tunnel running?";
  }
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status === 404) return "The DubDeck API wasn't found. Check the proxy configuration.";
  return `Request failed (${status}).`;
}

interface Options {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
}

export async function api<T>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const url = opts.auth === false ? path : withAuth(path, headers);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "offline", "You're offline, or the DubDeck site can't be reached.");
  }
  const data: any = await res.json().catch(() => null);
  if (res.ok) return data as T;

  const err = data?.error ?? {};
  const apiErr = new ApiError(res.status, err.code ?? `http_${res.status}`, err.message ?? statusMessage(res.status), data);
  // If a proxy strips our custom header the backend sees no token at all:
  // fall back to the query parameter once and remember it.
  if (apiErr.code === "no_session" && token && transport === "header" && !retried && opts.auth !== false) {
    transport = "query";
    writeJSON(TRANSPORT_KEY, transport);
    return api<T>(path, opts, true);
  }
  if (["no_session", "bad_session", "not_allowed"].includes(apiErr.code) && opts.auth !== false) {
    setSession(null);
    onSessionLost?.(apiErr);
  }
  throw apiErr;
}

// -- Server-Sent Events over fetch (so the session header can be sent) -------

export interface StreamHandlers {
  onEvent: (event: string, data: any) => void;
  onStatus: (status: "connecting" | "open" | "closed") => void;
}

export function openEventStream({ onEvent, onStatus }: StreamHandlers): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let backoff = 1000;

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      onStatus("connecting");
      try {
        const headers: Record<string, string> = { Accept: "text/event-stream" };
        const url = withAuth("/events", headers);
        const res = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          const data: any = await res.json().catch(() => null);
          const code = data?.error?.code ?? "no_session";
          if (code === "no_session" && token && transport === "header") {
            transport = "query";
            writeJSON(TRANSPORT_KEY, transport);
            continue;
          }
          setSession(null);
          onSessionLost?.(new ApiError(res.status, code, data?.error?.message ?? "Signed out"));
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        onStatus("open");
        backoff = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = "message";
            const data: string[] = [];
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            }
            if (data.length) {
              try {
                onEvent(event, JSON.parse(data.join("\n")));
              } catch {
                /* ignore malformed event */
              }
            }
          }
        }
      } catch (e) {
        if (stopped) return;
      }
      onStatus("closed");
      if (stopped) return;
      await new Promise((r) => setTimeout(r, backoff + Math.random() * 500));
      backoff = Math.min(backoff * 2, 30_000);
    }
  };
  void run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}

/** Trigger a browser download from a signed URL without leaving the page. */
export function downloadFromUrl(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener noreferrer";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
