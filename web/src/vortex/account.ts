// The visitor's account. Signing in is done by here.now's gate (email + code);
// its cookie keeps the visitor signed in next time. On top of that, each
// person can pick a display name, a profile picture and how the app looks
// for them. Those choices are saved on this device, per email.

import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
export type TextSize = "small" | "normal" | "large";

export interface Prefs {
  name: string; // full name shown on the profile and the welcome message
  avatar: string; // data: URL of a small square picture, or ""
  theme: ThemePref;
  accent: string; // "" = the site's color
  textSize: TextSize;
  reduceMotion: boolean;
}

export const DEFAULT_PREFS: Prefs = { name: "", avatar: "", theme: "system", accent: "", textSize: "normal", reduceMotion: false };

const storeKey = (email: string | null) => `vortex.prefs.${email ?? "guest"}`;

function load(email: string | null): Prefs {
  try {
    const raw = localStorage.getItem(storeKey(email));
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** "valentino.conde@x.co" → "Valentino Conde" (used until the person sets a name). */
export function nameFromEmail(email: string | null): string {
  if (!email) return "Guest";
  return email.split("@")[0].split(/[._-]+/).filter((p) => p && !/^\d+$/.test(p))
    .map((p) => p[0].toUpperCase() + p.slice(1)).join(" ") || email.split("@")[0];
}

export function usePrefs(email: string | null) {
  const [prefs, setPrefs] = useState<Prefs>(() => load(email));
  useEffect(() => { setPrefs(load(email)); }, [email]);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try { localStorage.setItem(storeKey(email), JSON.stringify(next)); } catch { /* storage full or blocked */ }
      return next;
    });
  }, [email]);
  return [prefs, update] as const;
}

/** Apply light/dark, text size and motion to the whole page. */
export function useApplyAppearance(prefs: Prefs) {
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = prefs.theme === "dark" || (prefs.theme === "system" && !!media?.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    const root = document.documentElement;
    root.dataset.textSize = prefs.textSize;
    root.dataset.reduceMotion = prefs.reduceMotion ? "true" : "false";
    if (prefs.theme !== "system") return;
    media?.addEventListener?.("change", apply);
    return () => media?.removeEventListener?.("change", apply);
  }, [prefs.theme, prefs.textSize, prefs.reduceMotion]);
}

/** Shrink a chosen photo to a 160×160 square JPEG so it fits in storage. */
export async function squareAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 160, 160);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The person's real profile picture: their Gravatar (the picture linked to
 * their email across many sites), when they have one. Only a SHA-256 hash of
 * the email is sent, never the email itself. null when there isn't one.
 */
export function useGravatar(email: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!email || !crypto?.subtle) return;
    let alive = true;
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())).then((buf) => {
      const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const src = `https://gravatar.com/avatar/${hash}?s=160&d=404`;
      const img = new Image();
      img.onload = () => { if (alive) setUrl(src); };
      img.src = src; // d=404: no picture → onerror, keep the initials
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [email]);
  return url;
}

/**
 * Log out on this device. here.now's gate keeps its own sign-in cookie (only
 * here.now can end that), so the app remembers the logout itself and shows
 * the signed-out page until the person signs back in.
 */
const OUT_KEY = "vortex.signedOut";
export function isSignedOut(): boolean {
  try { return localStorage.getItem(OUT_KEY) === "1"; } catch { return false; }
}
export function logout() {
  try { localStorage.setItem(OUT_KEY, "1"); } catch { /* ignore */ }
  location.hash = "#/signed-out";
  location.reload();
}
export function signBackIn() {
  try { localStorage.removeItem(OUT_KEY); } catch { /* ignore */ }
  location.hash = "#/";
  location.reload();
}
