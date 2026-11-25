// Gaming Mode: one tap turns it on, holding for 3 seconds turns it off.
// While it's on:
//  - the page goes full screen (hides the address bar on computers and Android);
//  - on Chrome for computers the Escape key is captured, so a quick press doesn't exit;
//  - Back doesn't leave the game;
//  - reloading is allowed and keeps Gaming Mode on (full screen comes back on the next tap);
//  - the screen stays awake.
// No website can fully disable a browser's own reload and close buttons; this
// makes accidents very unlikely. Small and three.js-free: the site shell uses it too.

type Listener = (on: boolean) => void;
let on = false;
const listeners = new Set<Listener>();
let wake: { release(): Promise<void> } | null = null;

type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type Nav = Navigator & {
  keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };
  wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
};

export const isGaming = () => on;

export function onGaming(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// No highlighting or copying page content while it's on (typing in fields still works).
const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, [contenteditable='true']");
const noCopy = (e: Event) => { if (!editable(e.target)) e.preventDefault(); };
function lockSelection(v: boolean) {
  document.documentElement.dataset.gaming = v ? "on" : "off";
  for (const t of ["selectstart", "copy", "cut", "dragstart"] as const) {
    if (v) document.addEventListener(t, noCopy, true); else document.removeEventListener(t, noCopy, true);
  }
  if (v) window.getSelection?.()?.removeAllRanges();
}

const emit = () => { lockSelection(on); for (const f of listeners) f(on); };

/** False on iPhones: Safari there doesn't let websites go full screen. */
export const canFullscreen = () => {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
};

export const isFullscreen = () => !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement);

/** Opened from the home screen (no address bar anyway). */
export const isStandalone = () => matchMedia?.("(display-mode: standalone), (display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;

const KEY = "vortex.gaming";
const remember = (v: boolean) => { try { if (v) sessionStorage.setItem(KEY, "1"); else sessionStorage.removeItem(KEY); } catch { /* */ } };
// Browsers only allow full screen after a tap, so after a reload it returns on the first one.
const refull = () => { if (on && !isFullscreen()) void enterFullscreen(); };
const onPop = () => { if (on) history.pushState({ hexdriftGuard: 1 }, "", location.href); };
const onVisible = () => { if (on && document.visibilityState === "visible") void lockScreen(); };

async function lockScreen() {
  try { wake = (await (navigator as Nav).wakeLock?.request("screen")) ?? null; } catch { wake = null; }
}

export async function enterFullscreen() {
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else await el.webkitRequestFullscreen?.();
    await (navigator as Nav).keyboard?.lock?.(["Escape"]);
  } catch { /* refused (needs a tap) or not supported */ }
}

export function enableGaming() {
  if (on) return;
  on = true;
  remember(true);
  void enterFullscreen();
  window.addEventListener("pointerdown", refull);
  // An extra history entry: pressing Back lands on it and we add it again.
  history.pushState({ hexdriftGuard: 1 }, "", location.href);
  window.addEventListener("popstate", onPop);
  document.addEventListener("visibilitychange", onVisible);
  void lockScreen();
  emit();
}

export function disableGaming() {
  if (!on) return;
  on = false;
  remember(false);
  window.removeEventListener("pointerdown", refull);
  window.removeEventListener("popstate", onPop);
  document.removeEventListener("visibilitychange", onVisible);
  try { (navigator as Nav).keyboard?.unlock?.(); } catch { /* */ }
  if (isFullscreen()) {
    const d = document as FsDoc;
    try { void (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()); } catch { /* */ }
  }
  void wake?.release().catch(() => undefined);
  wake = null;
  emit();
}

// Still on from before a reload in this tab.
try { if (sessionStorage.getItem(KEY) === "1") enableGaming(); } catch { /* */ }
