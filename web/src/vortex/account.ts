// The visitor's account. Signing in is done by here.now's gate (email + code);
// its cookie keeps the visitor signed in next time. On top of that, each
// person can pick a display name, a profile picture and how the app looks
// for them. Those choices are saved on this device, per email.

import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
export type TextSize = "small" | "normal" | "large";

export interface Prefs {
  name: string;
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
 * Sign out of here.now's gate. here.now ends the session at /.herenow/logout;
 * the page then reloads, and the gate asks for the email again.
 */
export function logout() {
  location.href = "/.herenow/logout";
}
