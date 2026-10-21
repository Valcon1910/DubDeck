// localStorage is only a cache/fallback: every access is wrapped because it can
// throw (private mode, blocked storage) or be unavailable entirely.

export function readJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the backend copy is the source of truth */
  }
}

export function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Jobs started from this device, so finished files can be offered here automatically.
const MINE = "dubdeck.myJobs";

export function rememberMyJobs(ids: string[]): void {
  const prev = readJSON<string[]>(MINE) ?? [];
  writeJSON(MINE, [...ids, ...prev].slice(0, 300));
}

export function isMyJob(id: string): boolean {
  return (readJSON<string[]>(MINE) ?? []).includes(id);
}
