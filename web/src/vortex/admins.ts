import { useEffect, useState } from "react";

// People who see the "Editor" button. Saving still needs the GitHub token,
// so this list only decides who sees the button, not who can change the site.
export const EDITOR_EMAILS = [
  "valentino.104688@anglo.edu.co",
  "vale.conde.arango@gmail.com",
  "valentino1910@icloud.com",
];

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
