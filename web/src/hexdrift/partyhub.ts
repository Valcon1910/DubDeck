// The Hexdrift party you're in, for the whole site: small enough to load with
// every page. The room itself (partysession.ts) and its card (partydock.tsx)
// load only once you're in a party.
//
// For chat:
//   const code = await createParty();          // a new room, you're its host
//   await inviteToParty(code, conversationId); // posts the invite in that chat
//   joinParty(code);                           // the receiver taps the invite
//   parsePartyInvite(message.body)             // the room code, if it's an invite
import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O (they read like 1 and 0)
export const newRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => LETTERS[b % LETTERS.length]).join("");
export const isRoomCode = (s: string) => /^[A-Z]{6}$/.test(s);

/** The room's page. */
export const partyHash = (code: string) => `#/hexdrift/party/${code}`;
export const partyLink = (code: string) => `${location.origin}${location.pathname}${partyHash(code)}`;

const KEY = "hexdrift.party";
let code: string | null = (() => {
  try { const c = sessionStorage.getItem(KEY); return c && isRoomCode(c) ? c : null; } catch { return null; }
})();
const subs = new Set<() => void>();
function set(next: string | null) {
  if (next === code) return;
  code = next;
  try { if (next) sessionStorage.setItem(KEY, next); else sessionStorage.removeItem(KEY); } catch { /* */ }
  subs.forEach((f) => f());
}

/** The room you're in (this tab), or null. */
export const getParty = () => code;
export function subscribeParty(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export function useParty(): string | null { return useSyncExternalStore(subscribeParty, getParty, getParty); }

/** Makes a new room and puts you in it (you're the host). Resolves to its code. */
export async function createParty(): Promise<string> {
  const c = newRoomCode();
  set(c);
  return c;
}

/** Puts you in a room (leaving any other). The card shows up top right on every page. */
export function joinParty(c: string) {
  const clean = c.trim().toUpperCase();
  if (!isRoomCode(clean)) throw new Error("Not a room code");
  set(clean);
}

export function leaveParty() { set(null); }

/** Chat's connection, for posting invites (set by the app). */
let client: SupabaseClient | null = null;
export function setPartyClient(sb: SupabaseClient | null) { client = sb; }

/** The text of an invite message. parsePartyInvite() finds the room in it. */
export const partyInviteText = (c: string) => `Join my Hexdrift party: ${partyLink(c)}`;

/** Posts an invite to the room in a chat. */
export async function inviteToParty(c: string, conversationId: string): Promise<void> {
  if (!isRoomCode(c)) throw new Error("Not a room code");
  if (!client) throw new Error("Chat isn't connected");
  const { error } = await client.from("messages").insert({ conversation_id: conversationId, body: partyInviteText(c), attachments: [], reply_to: null });
  if (error) throw new Error(error.message);
}

/** The room code a chat message invites to (any link to a room counts), or null. */
export function parsePartyInvite(body: string): string | null {
  const m = /#\/hexdrift\/party\/([A-Z]{6})\b/.exec(body);
  return m ? m[1] : null;
}
