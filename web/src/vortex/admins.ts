import { useEffect, useState } from "react";

// The site's owner: always Admin, always on both access lists, can't be removed.
export const OWNER_EMAILS = [
  "valentino.104688@anglo.edu.co",
  "vale.conde.arango@gmail.com",
  "valentino1910@icloud.com",
];
export const isOwner = (email: string) => OWNER_EMAILS.includes(email.trim().toLowerCase());

// People who see the Admin and Editor buttons: the owner plus config/roles.json
// (set from the Admin page; takes effect when the site is published).
export const EDITOR_EMAILS = [...new Set([...OWNER_EMAILS, ...__VORTEX_ADMINS__])];

/** The visitor's verified email from here.now's sign-in gate (null when unknown). */
export function useVisitorEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("./.herenow/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { email?: string | null } | null) => { if (alive) setEmail(d?.email?.toLowerCase() ?? null); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return email;
}

export const isEditor = (email: string | null) => !!email && EDITOR_EMAILS.includes(email);
