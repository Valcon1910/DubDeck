import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "../Settings";
import { squareAvatar } from "../account";
import {
  conversationPicture, conversationTitle, dataUrlToBlob, displayName, UnreadBadge, useChat,
  type Attachment, type Conversation, type Message, type Participant, type Profile,
} from "./store";

const PAGE = 50;
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 10;

/** #/chat/<id> → id */
function openId() {
  const m = location.hash.match(/^#\/?chat\/([0-9a-f-]{36})/i);
  return m ? m[1].toLowerCase() : null;
}

export function ChatPage() {
  const chat = useChat();
  const [id, setId] = useState(openId);
  const [dialog, setDialog] = useState<null | "dm" | "group" | "info">(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const on = () => setId(openId());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { chat?.setOpen(id); return () => chat?.setOpen(null); }, [chat, id]);

  if (!chat || chat.status === "off") {
    return (
      <section className="vx-page">
        <header className="vx-page-head"><h1>Chat</h1><p className="vx-muted">Coming soon.</p></header>
      </section>
    );
  }
  if (chat.status === "loading") return <div className="vx-card vx-skeleton vx-chat-skeleton" aria-label="Loading chat" />;
  if (chat.status === "error") {
    return (
      <section className="vx-page">
        <header className="vx-page-head"><h1>Chat</h1></header>
        <div className="vx-card vx-stack">
          <p className="vx-alert vx-alert-error" role="alert">{chat.error}</p>
          <button type="button" className="vx-btn vx-btn-primary vx-btn-sm" onClick={chat.retry}>Try again</button>
        </div>
      </section>
    );
  }

  const { conversations, me, profiles } = chat;
  const current = conversations.find((c) => c.id === id) ?? null;
  const q = query.trim().toLowerCase();
  const shown = q ? conversations.filter((c) => conversationTitle(c, me, profiles).toLowerCase().includes(q)) : conversations;

  return (
    <div className={`vx-chat ${id ? "vx-chat-open" : ""}`}>
      <aside className="vx-chat-list" aria-label="Chats">
        <div className="vx-chat-list-head">
          <h1>Chat</h1>
          <div className="vx-action-row">
            <button type="button" className="vx-btn vx-btn-primary vx-btn-sm" onClick={() => setDialog("dm")}>New chat</button>
            <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setDialog("group")}>New group</button>
          </div>
        </div>
        <input className="vx-chat-search" type="search" placeholder="Search chats" aria-label="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />
        {typeof Notification !== "undefined" && (
          <label className="vx-chat-notify">
            <input type="checkbox" checked={chat.notify} onChange={(e) => chat.setNotify(e.target.checked)} />
            Notify me about new messages
          </label>
        )}
        <ul className="vx-chat-items">
          {shown.length === 0 && <li className="vx-muted vx-small vx-chat-empty">{q ? "No chats match." : "No chats yet. Start one with New chat."}</li>}
          {shown.map((c) => <ConversationItem key={c.id} c={c} active={c.id === id} />)}
        </ul>
      </aside>
      <section className="vx-chat-thread">
        {current ? <Thread key={current.id} c={current} onInfo={() => setDialog("info")} />
          : id && conversations.length > 0 ? <p className="vx-muted vx-chat-placeholder">This chat isn't available. It may have been deleted, or you were removed.</p>
          : <p className="vx-muted vx-chat-placeholder">Pick a chat, or start a new one.</p>}
      </section>
      {(dialog === "dm" || dialog === "group") && <NewChat kind={dialog} onClose={() => setDialog(null)} />}
      {dialog === "info" && current && <GroupInfo c={current} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ConversationItem({ c, active }: { c: Conversation; active: boolean }) {
  const { me, profiles } = useChat()!;
  const title = conversationTitle(c, me, profiles);
  const who = c.last_sender === me ? "You" : c.last_sender ? displayName(profiles.get(c.last_sender), c.last_sender) : "";
  const preview = c.last_sender == null ? (c.kind === "group" ? "Group created" : "Say hi!")
    : c.last_deleted ? "Message deleted"
    : c.last_body || (c.last_files ? `Sent ${c.last_files === 1 ? "a file" : `${c.last_files} files`}` : "");
  return (
    <li>
      <a href={`#/chat/${c.id}`} className={`vx-chat-item ${c.unread ? "vx-chat-item-unread" : ""}`} aria-current={active ? "page" : undefined}>
        <Avatar src={conversationPicture(c, me, profiles)} name={title} size={42} />
        <span className="vx-chat-item-text">
          <strong>{title}</strong>
          <span className="vx-muted">{c.kind === "group" && who ? `${who}: ` : c.last_sender === me ? "You: " : ""}{preview}</span>
        </span>
        <span className="vx-chat-item-meta">
          <time className="vx-muted">{shortTime(c.last_message_at)}</time>
          <UnreadBadge count={c.unread} label="unread messages" />
        </span>
      </a>
    </li>
  );
}

// ── One conversation ─────────────────────────────────────────────────────────

function Thread({ c, onInfo }: { c: Conversation; onInfo: () => void }) {
  const chat = useChat()!;
  const { sb, me, profiles, owner } = chat;
  const [messages, setMessages] = useState<Message[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [people, setPeople] = useState<Participant[]>([]);
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const urls = useSignedUrls();
  const { typing, sendTyping, clearTyping } = useTyping(c.id);

  const markRead = useCallback(() => {
    if (!document.hidden) void sb!.rpc("mark_read", { p_id: c.id }).then(() => chat.reload());
  }, [sb, c.id, chat]);

  const loadPeople = useCallback(async () => {
    const { data } = await sb!.from("participants").select("*").eq("conversation_id", c.id);
    if (data) setPeople(data as Participant[]);
  }, [sb, c.id]);

  const loadLatest = useCallback(async () => {
    const { data } = await sb!.from("messages").select("*").eq("conversation_id", c.id).order("created_at", { ascending: false }).limit(PAGE);
    if (!data) return;
    const latest = (data as Message[]).reverse();
    setMessages((old) => merge(old, latest));
    setMore((m) => m || data.length === PAGE);
    setLoaded(true);
  }, [sb, c.id]);

  useEffect(() => { void loadLatest(); void loadPeople(); markRead(); }, [loadLatest, loadPeople, markRead]);

  useEffect(() => chat.listen((ch) => {
    if (ch.table === "resync") { void loadLatest(); void loadPeople(); return; }
    const row = (ch.eventType === "DELETE" ? ch.old : ch.new) as Record<string, unknown>;
    if (row?.conversation_id !== c.id) return;
    if (ch.table === "messages" && ch.eventType !== "DELETE") {
      setMessages((old) => merge(old, [row as unknown as Message]));
      if (ch.eventType === "INSERT" && row.sender !== me) { markRead(); clearTyping(row.sender as string); }
    }
    if (ch.table === "participants") void loadPeople();
  }), [chat, c.id, me, loadLatest, loadPeople, markRead]);

  useEffect(() => {
    const on = () => { if (!document.hidden) markRead(); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [markRead]);

  // Stay at the bottom as messages arrive, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, loaded]);

  async function loadEarlier() {
    const first = messages[0];
    if (!first) return;
    const el = scroller.current;
    const from = el ? el.scrollHeight - el.scrollTop : 0;
    const { data } = await sb!.from("messages").select("*").eq("conversation_id", c.id).lt("created_at", first.created_at)
      .order("created_at", { ascending: false }).limit(PAGE);
    if (!data) return;
    stick.current = false;
    setMessages((old) => merge(old, (data as Message[]).reverse()));
    setMore(data.length === PAGE);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - from; });
  }

  useEffect(() => {
    const paths = messages.flatMap((m) => m.attachments.map((a) => a.path));
    if (paths.length) urls.want(paths);
  }, [messages, urls]);

  const title = conversationTitle(c, me, profiles);
  const other = c.kind === "dm" ? c.members.find((m) => m !== me) ?? me : null;
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const othersRead = people.filter((p) => p.email !== me);
  const lastMine = [...messages].reverse().find((m) => m.sender === me && !m.deleted);
  const seenBy = lastMine ? othersRead.filter((p) => p.last_read_at >= lastMine.created_at) : [];

  async function remove(m: Message) {
    if (!confirm(m.sender === me ? "Delete this message for everyone?" : "Delete this message (as moderator)?")) return;
    const files = m.attachments.map((a) => a.path);
    const { error } = await sb!.from("messages").update({ deleted: true }).eq("id", m.id);
    if (error) { alert(error.message); return; }
    if (files.length) void sb!.storage.from("chat").remove(files);
  }

  return (
    <>
      <header className="vx-chat-head">
        <a className="vx-icon-btn vx-chat-back" href="#/chat" aria-label="Back to chats">‹</a>
        <Avatar src={conversationPicture(c, me, profiles)} name={title} size={38} />
        <span className="vx-chat-head-text">
          <strong>{title}</strong>
          <span className="vx-muted vx-small">
            {c.kind === "group" ? `${c.members.length} ${c.members.length === 1 ? "member" : "members"}` : lastSeen(profiles.get(other!))}
          </span>
        </span>
        {c.kind === "group" && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={onInfo}>Group info</button>}
      </header>

      <div className="vx-chat-messages" ref={scroller} role="log" aria-live="polite" aria-label={`Messages with ${title}`}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {more && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm vx-chat-earlier" onClick={() => void loadEarlier()}>Load earlier messages</button>}
        {loaded && messages.length === 0 && <p className="vx-muted vx-chat-placeholder">No messages yet. Say hi!</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const day = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const grouped = !day && prev && prev.sender === m.sender && !prev.deleted && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60_000;
          const mine = m.sender === me;
          const quote = m.reply_to ? byId.get(m.reply_to) : undefined;
          return (
            <div key={m.id}>
              {day && <p className="vx-chat-day"><span>{dayLabel(m.created_at)}</span></p>}
              <div className={`vx-msg ${mine ? "vx-msg-mine" : ""} ${grouped ? "vx-msg-grouped" : ""} ${selected === m.id ? "vx-msg-selected" : ""}`}
                onClick={() => setSelected((s) => (s === m.id ? null : m.id))}>
                {!mine && <span className="vx-msg-avatar">{!grouped && <Avatar src={profiles.get(m.sender)?.avatar ?? ""} name={displayName(profiles.get(m.sender), m.sender)} size={30} />}</span>}
                <div className="vx-msg-col">
                  {!mine && !grouped && c.kind === "group" && <span className="vx-msg-name">{displayName(profiles.get(m.sender), m.sender)}</span>}
                  <div className={`vx-bubble ${m.deleted ? "vx-bubble-deleted" : ""}`}>
                    {m.deleted ? <em>Message deleted</em> : (
                      <>
                        {m.reply_to && (
                          <span className="vx-msg-quote">
                            <b>{quote ? displayName(profiles.get(quote.sender), quote.sender) : "Reply"}</b>
                            {quote ? (quote.deleted ? "Message deleted" : quote.body || "File") : "Earlier message"}
                          </span>
                        )}
                        {m.attachments.length > 0 && <Files files={m.attachments} urls={urls.get} />}
                        {m.body && <p className="vx-msg-text"><Linkify text={m.body} /></p>}
                      </>
                    )}
                    <span className="vx-msg-time">{m.edited_at && !m.deleted ? "edited · " : ""}{clock(m.created_at)}</span>
                  </div>
                  {!m.deleted && (
                    <div className="vx-msg-actions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => { setEditing(null); setReply(m); setSelected(null); }}>Reply</button>
                      {mine && m.body && <button type="button" onClick={() => { setReply(null); setEditing(m); setSelected(null); }}>Edit</button>}
                      {(mine || owner) && <button type="button" className="vx-danger-text" onClick={() => void remove(m)}>Delete</button>}
                    </div>
                  )}
                  {lastMine?.id === m.id && seenBy.length > 0 && (
                    <span className="vx-msg-seen">
                      {c.kind === "dm" ? "Seen" : `Seen by ${seenBy.map((p) => displayName(profiles.get(p.email), p.email)).join(", ")}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {typing.length > 0 && (
          <div className="vx-msg vx-typing-row" aria-live="polite">
            <span className="vx-msg-avatar"><Avatar src={profiles.get(typing[0])?.avatar ?? ""} name={displayName(profiles.get(typing[0]), typing[0])} size={30} /></span>
            <div className="vx-msg-col">
              {c.kind === "group" && <span className="vx-msg-name">{typingLabel(typing, profiles)}</span>}
              <div className="vx-bubble vx-typing" aria-label={`${typingLabel(typing, profiles)} typing`}><i /><i /><i /></div>
            </div>
          </div>
        )}
      </div>

      <Composer c={c} reply={reply} editing={editing} onTyping={sendTyping} onDone={() => { setReply(null); setEditing(null); stick.current = true; }} />
    </>
  );
}

/**
 * "…is typing": short live signals on a private channel per conversation (only
 * its members can join). Sent at most every 2.5 s while typing; shown for 5 s
 * after the last one, or until that person sends or clears their message.
 */
function useTyping(cid: string) {
  const { sb, me } = useChat()!;
  const [seen, setSeen] = useState<Record<string, number>>({});
  const channel = useRef<ReturnType<NonNullable<typeof sb>["channel"]> | null>(null);
  const last = useRef(0);

  useEffect(() => {
    const ch = sb!.channel(`typing:${cid}`, { config: { private: true, broadcast: { self: false } } });
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { email?: string; stop?: boolean };
      if (!p.email || p.email === me) return;
      setSeen((s) => ({ ...s, [p.email!]: p.stop ? 0 : Date.now() }));
    }).subscribe();
    channel.current = ch;
    const tick = window.setInterval(() => setSeen((s) => {
      const live = Object.entries(s).filter(([, t]) => Date.now() - t < 5000);
      return live.length === Object.keys(s).length ? s : Object.fromEntries(live);
    }), 1000);
    return () => { window.clearInterval(tick); channel.current = null; last.current = 0; void sb!.removeChannel(ch); };
  }, [sb, cid, me]);

  const sendTyping = useCallback((stop = false) => {
    const ch = channel.current;
    if (!ch) return;
    if (stop) {
      if (!last.current) return;
      last.current = 0;
    } else {
      if (Date.now() - last.current < 2500) return;
      last.current = Date.now();
    }
    void ch.send({ type: "broadcast", event: "typing", payload: { email: me, stop } });
  }, [me]);

  const clearTyping = useCallback((email: string) => setSeen((s) => ({ ...s, [email]: 0 })), []);
  const typing = Object.entries(seen).filter(([, t]) => t && Date.now() - t < 5000).map(([e]) => e);
  return { typing, sendTyping, clearTyping };
}

function typingLabel(emails: string[], profiles: Map<string, Profile>) {
  const names = emails.map((e) => displayName(profiles.get(e), e));
  return names.length === 1 ? `${names[0]} is` : names.length === 2 ? `${names[0]} and ${names[1]} are` : `${names.length} people are`;
}

function merge(old: Message[], incoming: Message[]) {
  const map = new Map(old.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, { ...m, attachments: Array.isArray(m.attachments) ? m.attachments : [] });
  return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function Composer({ c, reply, editing, onDone, onTyping }: { c: Conversation; reply: Message | null; editing: Message | null; onDone: () => void; onTyping: (stop?: boolean) => void }) {
  const { sb, profiles } = useChat()!;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const draftKey = `vortex.chatDraft.${c.id}`;

  useEffect(() => { try { setText(localStorage.getItem(draftKey) ?? ""); } catch { /* ignore */ } }, [draftKey]);
  useEffect(() => { if (editing) { setText(editing.body); box.current?.focus(); } }, [editing]);
  useEffect(() => { if (reply) box.current?.focus(); }, [reply]);
  const saveDraft = (v: string) => { setText(v); if (!editing) try { localStorage.setItem(draftKey, v); } catch { /* ignore */ } };

  function add(list: FileList | null) {
    if (!list) return;
    setErr("");
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) { setErr(`${f.name} is bigger than 25 MB.`); continue; }
      if (next.length >= MAX_FILES) { setErr(`Up to ${MAX_FILES} files per message.`); break; }
      next.push(f);
    }
    setFiles(next);
  }

  async function send() {
    const body = text.trim();
    if (busy || (!body && files.length === 0)) return;
    setBusy(true); setErr("");
    try {
      if (editing) {
        const { error } = await sb!.from("messages").update({ body }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const attachments: Attachment[] = [];
        for (const f of files) {
          const safe = f.name.replace(/[^\w.\- ]+/g, "_").slice(-80) || "file";
          const path = `${c.id}/${crypto.randomUUID()}/${safe}`;
          const { error } = await sb!.storage.from("chat").upload(path, f, { contentType: f.type || "application/octet-stream" });
          if (error) throw new Error(`Couldn't upload ${f.name}: ${error.message}`);
          attachments.push({ path, name: f.name.slice(0, 120), size: f.size, type: f.type || "application/octet-stream" });
        }
        const { error } = await sb!.from("messages").insert({ conversation_id: c.id, body, attachments, reply_to: reply?.id ?? null });
        if (error) throw error;
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      }
      setText(""); setFiles([]); onDone(); onTyping(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send. Try again.");
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  return (
    <div className="vx-composer"
      onDragOver={(e) => { if (!editing) e.preventDefault(); }}
      onDrop={(e) => { if (editing) return; e.preventDefault(); add(e.dataTransfer.files); }}>
      {(reply || editing) && (
        <div className="vx-composer-bar">
          <span>{editing ? "Editing message" : <>Replying to <b>{displayName(profiles.get(reply!.sender), reply!.sender)}</b>: {reply!.body || "File"}</>}</span>
          <button type="button" className="vx-icon-btn" aria-label="Cancel" onClick={() => { setText(editing ? "" : text); onDone(); }}>×</button>
        </div>
      )}
      {files.length > 0 && (
        <ul className="vx-chips vx-composer-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}><span>{f.name} · {size(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></li>
          ))}
        </ul>
      )}
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      <div className="vx-composer-row">
        {!editing && (
          <>
            <button type="button" className="vx-icon-btn vx-attach" aria-label="Attach files" title="Attach photos, videos or files" onClick={() => pick.current?.click()}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6L15 7" />
              </svg>
            </button>
            <input ref={pick} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          </>
        )}
        <textarea ref={box} rows={1} placeholder="Message" aria-label="Message" value={text} maxLength={4000}
          onChange={(e) => { saveDraft(e.target.value); if (!editing) onTyping(!e.target.value.trim()); }}
          onBlur={() => onTyping(true)}
          onPaste={(e) => { if (!editing && e.clipboardData.files.length) { e.preventDefault(); add(e.clipboardData.files); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button type="button" className="vx-btn vx-btn-primary vx-btn-sm" disabled={busy || (!text.trim() && files.length === 0)} onClick={() => void send()}>
          {busy ? (files.length ? "Sending…" : "…") : editing ? "Save" : "Send"}
        </button>
      </div>
    </div>
  );
}

/** Photos and videos show inline; other files are download links. */
function Files({ files, urls }: { files: Attachment[]; urls: (path: string) => string | undefined }) {
  return (
    <span className="vx-msg-files">
      {files.map((f) => {
        const url = urls(f.path);
        if (f.type.startsWith("image/")) {
          return url
            ? <a key={f.path} href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><img src={url} alt={f.name} loading="lazy" /></a>
            : <span key={f.path} className="vx-msg-file-wait" aria-label={`Loading ${f.name}`} />;
        }
        if (f.type.startsWith("video/")) return url ? <video key={f.path} src={url} controls preload="metadata" onClick={(e) => e.stopPropagation()} /> : <span key={f.path} className="vx-msg-file-wait" />;
        if (f.type.startsWith("audio/")) return url ? <audio key={f.path} src={url} controls onClick={(e) => e.stopPropagation()} /> : null;
        return (
          <a key={f.path} className="vx-msg-file" href={url ? `${url}&download=${encodeURIComponent(f.name)}` : undefined} onClick={(e) => e.stopPropagation()}>
            <span aria-hidden="true">📄</span><span>{f.name}<em>{size(f.size)}</em></span>
          </a>
        );
      })}
    </span>
  );
}

/** Private files are read through short-lived links, fetched in batches. */
function useSignedUrls() {
  const { sb } = useChat()!;
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const asked = useRef(new Set<string>());
  return useMemo(() => ({
    get: (p: string) => urls.get(p),
    want: (paths: string[]) => {
      const need = paths.filter((p) => !asked.current.has(p));
      if (!need.length) return;
      need.forEach((p) => asked.current.add(p));
      void sb!.storage.from("chat").createSignedUrls(need, 60 * 60 * 6).then(({ data }) => {
        if (!data) return;
        setUrls((old) => {
          const next = new Map(old);
          for (const d of data) if (d.signedUrl && d.path) next.set(d.path, d.signedUrl);
          return next;
        });
      });
    },
  }), [sb, urls]);
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="vx-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="vx-card vx-modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="vx-modal-head"><h2>{title}</h2><button type="button" className="vx-icon-btn" aria-label="Close" onClick={onClose}>×</button></header>
        {children}
      </div>
    </div>
  );
}

/** Members to pick from (everyone on the access list except you). */
function MemberPicker({ exclude, chosen, onPick, multi }: { exclude: string[]; chosen: string[]; onPick: (email: string) => void; multi: boolean }) {
  const { profiles } = useChat()!;
  const [q, setQ] = useState("");
  const list = [...profiles.values()]
    .filter((p) => !exclude.includes(p.email))
    .filter((p) => !q.trim() || `${p.name} ${p.email}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => displayName(a, a.email).localeCompare(displayName(b, b.email)));
  return (
    <div className="vx-stack">
      <input className="vx-chat-search" type="search" placeholder="Search people" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="vx-chat-people">
        {list.length === 0 && <li className="vx-muted vx-small">Nobody to add.</li>}
        {list.map((p) => (
          <li key={p.email}>
            <button type="button" className="vx-chat-person" aria-pressed={multi ? chosen.includes(p.email) : undefined} onClick={() => onPick(p.email)}>
              <Avatar src={p.avatar} name={displayName(p, p.email)} size={34} />
              <span><strong>{displayName(p, p.email)}</strong><em>{p.email}</em></span>
              {multi && <span className="vx-chat-tick" aria-hidden="true">{chosen.includes(p.email) ? "✓" : ""}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function uploadIcon(sb: NonNullable<ReturnType<typeof useChat>>["sb"], folder: string, file: File) {
  const data = await squareAvatar(file);
  const blob = dataUrlToBlob(data);
  const path = `${folder}/${Date.now()}.${blob.type.split("/")[1] || "png"}`;
  const { error } = await sb!.storage.from("pics").upload(path, blob, { contentType: blob.type });
  if (error) throw error;
  return sb!.storage.from("pics").getPublicUrl(path).data.publicUrl;
}

function NewChat({ kind, onClose }: { kind: "dm" | "group"; onClose: () => void }) {
  const { sb, me, reload } = useChat()!;
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [icon, setIcon] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  async function create(members: string[]) {
    setBusy(true); setErr("");
    try {
      const { data: id, error } = await sb!.rpc("create_conversation", { p_kind: kind, p_members: members, p_name: name.trim(), p_icon: "" });
      if (error) throw error;
      if (kind === "group" && icon) {
        const url = await uploadIcon(sb, id as string, icon);
        await sb!.rpc("update_group", { p_id: id, p_name: name.trim(), p_icon: url });
      }
      reload();
      onClose();
      location.hash = `#/chat/${id as string}`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create the chat.");
      setBusy(false);
    }
  }

  if (kind === "dm") {
    return (
      <Modal title="New chat" onClose={onClose}>
        <MemberPicker exclude={[me]} chosen={[]} multi={false} onPick={(e) => { if (!busy) void create([e]); }} />
        {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      </Modal>
    );
  }
  return (
    <Modal title="New group" onClose={onClose}>
      <div className="vx-group-head">
        <button type="button" className="vx-group-icon" aria-label="Choose group icon" onClick={() => pick.current?.click()}>
          {preview ? <img src={preview} alt="" /> : <span>Add icon</span>}
        </button>
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (f) { setIcon(f); void squareAvatar(f).then(setPreview).catch(() => setErr("That file isn't a picture this browser can open.")); }
        }} />
        <label className="vx-field vx-grow">Group name
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Study group" />
        </label>
      </div>
      <p className="vx-small vx-muted">{chosen.length ? `${chosen.length} selected` : "Pick people to add"}</p>
      <MemberPicker exclude={[me]} chosen={chosen} multi onPick={(e) => setChosen((c) => (c.includes(e) ? c.filter((x) => x !== e) : [...c, e]))} />
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      <button type="button" className="vx-btn vx-btn-primary" disabled={busy || !name.trim() || chosen.length === 0} onClick={() => void create(chosen)}>
        {busy ? "Creating…" : "Create group"}
      </button>
    </Modal>
  );
}

function GroupInfo({ c, onClose }: { c: Conversation; onClose: () => void }) {
  const { sb, me, owner, profiles, reload } = useChat()!;
  const [people, setPeople] = useState<Participant[]>([]);
  const [name, setName] = useState(c.name);
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const admin = c.my_role === "admin" || owner;

  const load = useCallback(async () => {
    const { data } = await sb!.from("participants").select("*").eq("conversation_id", c.id).order("joined_at");
    if (data) setPeople(data as Participant[]);
  }, [sb, c.id]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setErr("");
    const { error } = await fn();
    if (error) setErr(error.message);
    void load(); reload();
    return !error;
  }

  return (
    <Modal title="Group info" onClose={onClose}>
      <div className="vx-group-head">
        <button type="button" className="vx-group-icon" disabled={!admin} aria-label="Change group icon" onClick={() => pick.current?.click()}>
          {c.icon ? <img src={c.icon} alt="" /> : <span>{admin ? "Add icon" : ""}</span>}
        </button>
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (f) void uploadIcon(sb, c.id, f).then((url) => run(() => sb!.rpc("update_group", { p_id: c.id, p_name: c.name, p_icon: url })))
            .catch(() => setErr("Couldn't use that picture."));
        }} />
        {admin ? (
          <label className="vx-field vx-grow">Group name
            <span className="vx-row">
              <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" disabled={!name.trim() || name.trim() === c.name}
                onClick={() => void run(() => sb!.rpc("update_group", { p_id: c.id, p_name: name.trim(), p_icon: c.icon }))}>Rename</button>
            </span>
          </label>
        ) : <strong className="vx-grow">{c.name}</strong>}
      </div>

      <h3 className="vx-small">{people.length} members</h3>
      <ul className="vx-chat-people">
        {people.map((p) => {
          const prof: Profile | undefined = profiles.get(p.email);
          return (
            <li key={p.email} className="vx-chat-person">
              <Avatar src={prof?.avatar ?? ""} name={displayName(prof, p.email)} size={34} />
              <span><strong>{displayName(prof, p.email)}{p.email === me ? " (you)" : ""}</strong><em>{p.role === "admin" ? "Group admin" : p.email}</em></span>
              {admin && p.email !== me && (
                <span className="vx-action-row">
                  <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm"
                    onClick={() => void run(() => sb!.rpc("set_admin", { p_id: c.id, p_email: p.email, p_admin: p.role !== "admin" }))}>
                    {p.role === "admin" ? "Remove admin" : "Make admin"}
                  </button>
                  <button type="button" className="vx-btn vx-btn-danger vx-btn-sm"
                    onClick={() => void run(() => sb!.rpc("remove_member", { p_id: c.id, p_email: p.email }))}>Remove</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {admin && (adding ? (
        <div className="vx-stack">
          <MemberPicker exclude={people.map((p) => p.email)} chosen={chosen} multi onPick={(e) => setChosen((x) => (x.includes(e) ? x.filter((y) => y !== e) : [...x, e]))} />
          <div className="vx-action-row">
            <button type="button" className="vx-btn vx-btn-primary vx-btn-sm" disabled={!chosen.length}
              onClick={() => void run(() => sb!.rpc("add_members", { p_id: c.id, p_members: chosen })).then(() => { setChosen([]); setAdding(false); })}>
              Add {chosen.length || ""}
            </button>
            <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => { setAdding(false); setChosen([]); }}>Cancel</button>
          </div>
        </div>
      ) : <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setAdding(true)}>Add people</button>)}

      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      <div className="vx-action-row vx-group-danger">
        {people.some((p) => p.email === me) && (
          <button type="button" className="vx-btn vx-btn-danger vx-btn-sm" onClick={() => {
            if (confirm(`Leave ${c.name}?`)) void run(() => sb!.rpc("remove_member", { p_id: c.id, p_email: me })).then((ok) => { if (ok) { onClose(); location.hash = "#/chat"; } });
          }}>Leave group</button>
        )}
        {admin && (
          <button type="button" className="vx-btn vx-btn-danger vx-btn-sm" onClick={() => {
            if (confirm(`Delete ${c.name} and all its messages for everyone?`)) void run(() => sb!.rpc("delete_conversation", { p_id: c.id })).then((ok) => { if (ok) { onClose(); location.hash = "#/chat"; } });
          }}>Delete group</button>
        )}
      </div>
    </Modal>
  );
}

// ── Small helpers ───────────────────────────────────────────────────────────

function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>{p}</a> : p))}</>;
}

const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
function shortTime(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? clock(iso) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function lastSeen(p: Profile | undefined) {
  if (!p?.last_seen) return "Hasn't opened Vortex Chat yet";
  const mins = (Date.now() - Date.parse(p.last_seen)) / 60_000;
  if (mins < 5) return "Active now";
  if (mins < 60) return `Active ${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return `Active ${Math.round(mins / 60)} h ago`;
  return `Active ${new Date(p.last_seen).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
function size(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
