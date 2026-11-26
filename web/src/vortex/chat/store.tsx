// Chat's connection to Supabase, shared by the whole app (the Chat page and
// the unread badges). Signing in: the site's /chat-login route (a here.now
// proxy route) adds the visitor's verified email, and Supabase answers with a
// session for it. Supabase's library is only downloaded once Chat is used.
import { setProfileIds } from "../profileLink.ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dispatch } from "../github";
import { isGaming } from "../../hexdrift/gaming";
import { cropStyle, readCrop, stripCrop, withCrop } from "../crop";
import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

export const CHAT_ON = __VORTEX_CHAT__;

/** w/h: picture or video size, saved when sent so the space is kept while it loads. */
export interface Attachment { path: string; name: string; size: number; type: string; w?: number; h?: number }
export interface Profile { email: string; name: string; avatar: string; member: boolean; last_seen: string | null; pid?: string }
export interface Conversation {
  id: string; kind: "dm" | "group"; name: string; icon: string; created_by: string;
  last_message_at: string; last_read_at: string; my_role: "member" | "admin"; unread: number; members: string[];
  last_body: string | null; last_sender: string | null; last_files: number; last_deleted: boolean | null;
  /** You removed the chat from your list at this time: older messages stay hidden for you. */
  cleared_at: string | null;
  /** Group setting: only admins can send messages. */
  admins_only?: boolean;
}
export interface Message {
  id: string; conversation_id: string; sender: string; body: string; attachments: Attachment[];
  reply_to: string | null; created_at: string; edited_at: string | null; deleted: boolean;
}
export interface Reaction { message_id: string; conversation_id: string; email: string; emoji: string; created_at: string }
export interface Participant { conversation_id: string; email: string; role: "member" | "admin"; joined_at: string; last_read_at: string }

type Status = "off" | "loading" | "ready" | "error";
type Change = RealtimePostgresChangesPayload<Record<string, unknown>> & { table: string };

interface ChatValue {
  status: Status;
  error: string;
  sb: SupabaseClient | null;
  me: string;
  owner: boolean;
  profiles: Map<string, Profile>;
  conversations: Conversation[];
  unread: number;
  /** Which conversation is open on screen (no notifications for it). */
  setOpen: (id: string | null) => void;
  reload: () => void;
  retry: () => void;
  /** Live changes to messages and participants, for the open conversation. */
  listen: (fn: (c: Change) => void) => () => void;
  notify: boolean;
  setNotify: (on: boolean) => void;
}

const Ctx = createContext<ChatValue | null>(null);
export const useChat = () => useContext(Ctx);

const NOTIFY_KEY = "vortex.chatNotify";
const ASLEEP = "Chat was asleep and is waking up. This takes a few minutes; it opens on its own when ready.";

/** Starts the "Keep Chat awake" workflow (at most every 10 minutes from this browser). */
async function wake() {
  try {
    const last = Number(localStorage.getItem("vortex.chatWake") ?? 0);
    if (Date.now() - last < 10 * 60_000) return;
    localStorage.setItem("vortex.chatWake", String(Date.now()));
  } catch { /* ignore */ }
  try { await dispatch("chat-keepalive.yml", {}); } catch { /* the scheduled run will wake it */ }
}

export function displayName(p: Profile | undefined, email: string) {
  return p?.name?.trim() || email.split("@")[0];
}

export function conversationTitle(c: Conversation, me: string, profiles: Map<string, Profile>) {
  if (c.kind === "group") return c.name || "Group";
  const other = c.members.find((m) => m !== me) ?? me;
  return displayName(profiles.get(other), other);
}

export function conversationPicture(c: Conversation, me: string, profiles: Map<string, Profile>) {
  if (c.kind === "group") return c.icon;
  const other = c.members.find((m) => m !== me) ?? me;
  return profiles.get(other)?.avatar ?? "";
}

interface Props {
  email: string | null;
  owner: boolean;
  /** The picture and name the visitor picked in Settings, shared with Chat. */
  name: string;
  avatar: string;
  children: ReactNode;
}

export function ChatProvider({ email, owner, name, avatar, children }: Props) {
  const [status, setStatus] = useState<Status>(CHAT_ON ? "loading" : "off");
  const [error, setError] = useState("");
  const [sb, setSb] = useState<SupabaseClient | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const [notify, setNotifyState] = useState(() => { try { return localStorage.getItem(NOTIFY_KEY) === "1"; } catch { return false; } });
  const listeners = useRef(new Set<(c: Change) => void>());
  const open = useRef<string | null>(null);
  const me = email ?? "";

  // Sign in to Supabase once the visitor's email is known.
  useEffect(() => {
    if (!CHAT_ON || !email) return;
    let alive = true;
    let client: SupabaseClient | null = null;
    let retryTimer: number | undefined;
    setStatus("loading");
    (async () => {
      const res = await fetch("./chat-login", { method: "POST", credentials: "same-origin", cache: "no-store" }).catch(() => null);
      // A free Supabase project falls asleep after a week unused: start waking it.
      if (!res || res.status >= 500) { await wake(); throw new Error(ASLEEP); }
      const s = await res.json().catch(() => null) as { url?: string; anonKey?: string; access_token?: string; refresh_token?: string; error?: string } | null;
      if (!res.ok || !s?.access_token || !s.url || !s.anonKey) throw new Error(s?.error || "Chat isn't available right now.");
      const { createClient } = await import("@supabase/supabase-js");
      client = createClient(s.url, s.anonKey, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });
      const { error: e } = await client.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token ?? "" });
      if (e) throw e;
      if (!alive) return;
      setSb(client);
      setStatus("ready");
    })().catch((e: unknown) => {
      if (!alive) return;
      setError(e instanceof Error ? e.message : "Chat isn't available right now.");
      setStatus("error");
      if (e instanceof Error && e.message === ASLEEP) retryTimer = window.setTimeout(() => setAttempt((a) => a + 1), 60_000);
    });
    return () => { alive = false; window.clearTimeout(retryTimer); void client?.removeAllChannels(); };
  }, [email, attempt]);

  const loadProfiles = useCallback(async () => {
    if (!sb) return;
    const { data } = await sb.from("profiles").select("*").eq("member", true).order("name");
    if (data) { setProfileIds(data as Profile[]); setProfiles(new Map((data as Profile[]).map((p) => [p.email, p]))); }
  }, [sb]);

  const loadConversations = useCallback(async () => {
    if (!sb) return;
    const { data } = await sb.rpc("my_conversations");
    if (data) setConversations(data as Conversation[]);
  }, [sb]);

  // Coalesce bursts of live events into one reload.
  const timer = useRef<number | undefined>(undefined);
  const reload = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void loadConversations(); }, 250);
  }, [loadConversations]);

  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const convRef = useRef(conversations);
  convRef.current = conversations;

  useEffect(() => {
    if (!sb) return;
    void loadProfiles();
    void loadConversations();
    const ch = sb.channel("vortex-chat");
    const on = (table: string) => (p: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const change = { ...p, table } as Change;
      listeners.current.forEach((fn) => fn(change));
      if (table === "profiles") { void loadProfiles(); return; }
      if (table === "message_reactions") return;
      reload();
      if (table === "messages" && p.eventType === "INSERT") alertFor(p.new as unknown as Message);
    };
    const alertFor = (m: Message) => {
      if (m.sender === me) return;
      // The small card in the top right (not in Gaming Mode, not for the chat on screen).
      if (!document.hidden && open.current !== m.conversation_id && !isGaming()) {
        const p = profilesRef.current.get(m.sender);
        const conv = convRef.current.find((c) => c.id === m.conversation_id);
        const pop: Pop = {
          id: m.id, cid: m.conversation_id, who: displayName(p, m.sender), avatar: p?.avatar ?? "",
          group: conv?.kind === "group" ? conv.name : "",
          text: m.body || (m.attachments.length ? (m.attachments.length === 1 ? "Sent a file" : `Sent ${m.attachments.length} files`) : "New message"),
        };
        setPops((list) => [...list.filter((x) => x.cid !== pop.cid).slice(-2), pop]);
        window.setTimeout(() => setPops((list) => list.filter((x) => x.id !== pop.id)), 6000);
      }
      if (!notifyRef.current || typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (!document.hidden && open.current === m.conversation_id) return;
      const who = displayName(profilesRef.current.get(m.sender), m.sender);
      const n = new Notification(`${who} on Vortex`, {
        body: m.body || (m.attachments.length ? "Sent a file" : "New message"),
        icon: stripCrop(profilesRef.current.get(m.sender)?.avatar ?? "") || "./favicon.svg",
        tag: m.conversation_id,
      });
      n.onclick = () => { window.focus(); location.hash = `#/chat/${m.conversation_id}`; n.close(); };
    };
    for (const t of ["messages", "participants", "conversations", "profiles", "message_reactions"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, on(t));
    }
    // Catch up on anything sent while the connection was being made.
    ch.subscribe((st) => { if (st === "SUBSCRIBED") { void loadConversations(); listeners.current.forEach((fn) => fn({ table: "resync" } as Change)); } });
    const wake = () => { if (!document.hidden) { void loadConversations(); void sb.rpc("touch_seen"); } };
    // "Active now" for others while Vortex is open here.
    const beat = window.setInterval(() => { if (!document.hidden) void sb.rpc("touch_seen"); }, 3 * 60_000);
    document.addEventListener("visibilitychange", wake);
    return () => { window.clearInterval(beat); document.removeEventListener("visibilitychange", wake); void sb.removeChannel(ch); };
  }, [sb, me, loadProfiles, loadConversations, reload]);

  // Share the name and picture from Settings so everyone sees the same ones.
  useEffect(() => {
    if (!sb || !me || profiles.size === 0) return;
    const mine = profiles.get(me);
    if (!mine) return;
    void (async () => {
      const patch: Partial<Profile> = {};
      if (name.trim() && name.trim() !== mine.name) patch.name = name.trim().slice(0, 60);
      const key = `vortex.chatAvatar.${me}`;
      let sent = "";
      try { sent = localStorage.getItem(key) ?? ""; } catch { /* ignore */ }
      const fingerprint = avatar ? `${avatar.length}:${avatar.slice(-40)}` : "";
      // Only when this device changed it: a new device with no picture yet must not wipe the shared one.
      if (fingerprint !== sent) {
        if (!avatar) patch.avatar = "";
        else if (/^https:\/\//.test(avatar)) patch.avatar = avatar;
        else if (avatar.startsWith("data:image/")) {
          const blob = dataUrlToBlob(stripCrop(avatar));
          const path = `${me}/${Date.now()}.${blob.type.split("/")[1] || "png"}`;
          const up = await sb.storage.from("pics").upload(path, blob, { contentType: blob.type });
          if (!up.error) {
            const url = sb.storage.from("pics").getPublicUrl(path).data.publicUrl;
            const c = readCrop(avatar);
            patch.avatar = c ? withCrop(url, c) : url;
          }
        }
        try { localStorage.setItem(key, fingerprint); } catch { /* ignore */ }
      }
      if (Object.keys(patch).length) {
        const { error: e } = await sb.from("profiles").update(patch).eq("email", me);
        if (!e) void loadProfiles();
      }
    })();
  }, [sb, me, name, avatar, profiles, loadProfiles]);

  const setNotify = useCallback((on: boolean) => {
    const save = (v: boolean) => { setNotifyState(v); try { localStorage.setItem(NOTIFY_KEY, v ? "1" : "0"); } catch { /* ignore */ } };
    if (!on) { save(false); return; }
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") { save(true); return; }
    void Notification.requestPermission().then((p) => save(p === "granted"));
  }, []);

  const value = useMemo<ChatValue>(() => ({
    status, error, sb, me, owner, profiles, conversations,
    unread: conversations.reduce((n, c) => n + c.unread, 0),
    setOpen: (id) => { open.current = id; },
    reload,
    retry: () => setAttempt((a) => a + 1),
    listen: (fn) => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; },
    notify, setNotify,
  }), [status, error, sb, me, owner, profiles, conversations, reload, notify, setNotify]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <MessagePops pops={pops} close={(id) => setPops((l) => l.filter((x) => x.id !== id))} />
    </Ctx.Provider>
  );
}

interface Pop { id: string; cid: string; who: string; avatar: string; group: string; text: string }

/** New-message cards in the top right; tap one to open that chat. */
function MessagePops({ pops, close }: { pops: Pop[]; close: (id: string) => void }) {
  if (!pops.length) return null;
  return (
    <div className="vx-pops" role="status" aria-live="polite">
      {pops.map((p) => (
        <div key={p.id} className="vx-pop">
          <a className="vx-pop-main" href={`#/chat/${p.cid}`} onClick={() => close(p.id)}>
            {p.avatar ? <span className="vx-pop-avatar"><img src={stripCrop(p.avatar)} alt="" style={cropStyle(readCrop(p.avatar))} /></span> : <span className="vx-pop-avatar" aria-hidden="true">{p.who.slice(0, 1).toUpperCase()}</span>}
            <span className="vx-pop-text">
              <strong>{p.who}{p.group && <em> in {p.group}</em>}</strong>
              <span>{p.text}</span>
            </span>
          </a>
          <button type="button" className="vx-pop-close" aria-label="Dismiss" onClick={() => close(p.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

/** data:image/png;base64,… → Blob (fetch() of data: URLs is blocked by the site's security policy). */
export function dataUrlToBlob(url: string): Blob {
  const [head, b64 = ""] = url.split(",", 2);
  const type = head.match(/^data:([^;,]+)/)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** The red unread count (nothing when zero). */
export function UnreadBadge({ count, label = "unread" }: { count: number; label?: string }) {
  if (count <= 0) return null;
  return <span className="vx-unread" aria-label={`${count} ${label}`}>{count > 99 ? "99+" : count}</span>;
}
