// Links to a member's pages use their short profile ID (a random column on
// profiles), never their email. Old links with the email still open.

const byEmail = new Map<string, string>();
const byPid = new Map<string, string>();

/** Called when Chat loads the member list. */
export function setProfileIds(list: { email: string; pid?: string | null }[]) {
  byEmail.clear();
  byPid.clear();
  for (const p of list) {
    if (!p.pid) continue;
    byEmail.set(p.email.toLowerCase(), p.pid);
    byPid.set(p.pid, p.email.toLowerCase());
  }
}

/** The part of a link that names the member: their ID (or, until the list has loaded, the email). */
const idFor = (email: string) => byEmail.get(email.toLowerCase()) ?? encodeURIComponent(email.toLowerCase());

/** A member's Vortex profile page. */
export const profileHref = (email: string) => `#/profile/${idFor(email)}`;
/** A member's Hexdrift times. */
export const playerHref = (email: string) => `#/hexdrift/player/${idFor(email)}`;

/** The email a link names: an ID once the member list has loaded, or an old email link. "" while unknown. */
export function emailFrom(param: string): string {
  const p = decodeURIComponent(param).toLowerCase();
  return p.includes("@") ? p : byPid.get(p) ?? "";
}

/** The member's ID, to tidy an old email link in the address bar. */
export const pidOf = (email: string) => byEmail.get(email.toLowerCase());
