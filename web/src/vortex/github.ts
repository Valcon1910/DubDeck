// The admin editor saves by committing to the site's GitHub repository with a
// fine-grained token that only the admin has (kept in this browser's storage).
// The push to main redeploys the site, and access-list changes are applied to
// here.now by the "Sync access allowlist" workflow.

export const REPO: string = __VORTEX_REPO__;
export const BRANCH = "main";
export const CONTENT_PATH = "web/content.json";
export const ACCESS_PATH = "config/allowed-emails.json";
const API = "https://api.github.com";
const TOKEN_KEY = "vortex.admin.token";

export class GitHubError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

export const tokenStore = {
  get(): string { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } },
  set(t: string) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new GitHubError("Can't reach GitHub. Check the internet connection.");
  }
  if (res.status === 401) throw new GitHubError("GitHub didn't accept the token. It may be wrong or expired.", 401);
  if (res.status === 403 || res.status === 404) {
    throw new GitHubError(`The token can't access ${REPO}. Give it "Contents: Read and write" and "Actions: Read" on that repository.`, res.status);
  }
  if (!res.ok) throw new GitHubError(`GitHub error ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  return (await res.json()) as T;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0));

/** Check the token can write to the repository; returns the GitHub username. */
export async function verify(token: string): Promise<string> {
  const repo = await gh<{ permissions?: { push?: boolean } }>(token, `/repos/${REPO}`);
  if (!repo.permissions?.push) throw new GitHubError(`This token can read ${REPO} but not save to it. Give it "Contents: Read and write".`);
  const me = await gh<{ login?: string }>(token, "/user").catch(() => ({ login: undefined }));
  return me.login ?? "admin";
}

/** Read a JSON file from the tip of main (so edits always start from the newest saved copy). */
export async function readJson<T>(token: string, path: string): Promise<T> {
  const f = await gh<{ content: string }>(token, `/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
  return JSON.parse(dec.decode(fromBase64(f.content))) as T;
}

export interface FileChange { path: string; text?: string; bytes?: Uint8Array }

/** Commit several files to main in one commit. Returns the commit SHA. */
export async function commit(token: string, message: string, files: FileChange[]): Promise<string> {
  const base = `/repos/${REPO}/git`;
  const ref = await gh<{ object: { sha: string } }>(token, `${base}/ref/heads/${BRANCH}`);
  const parent = await gh<{ tree: { sha: string } }>(token, `${base}/commits/${ref.object.sha}`);
  const tree = await Promise.all(files.map(async (f) => {
    const bytes = f.bytes ?? enc.encode(f.text ?? "");
    const blob = await gh<{ sha: string }>(token, `${base}/blobs`, {
      method: "POST", body: JSON.stringify({ content: toBase64(bytes), encoding: "base64" }),
    });
    return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
  }));
  const newTree = await gh<{ sha: string }>(token, `${base}/trees`, {
    method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree }),
  });
  const c = await gh<{ sha: string }>(token, `${base}/commits`, {
    method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [ref.object.sha] }),
  });
  try {
    await gh(token, `${base}/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
  } catch (e) {
    if (e instanceof GitHubError && e.status === 422) {
      throw new GitHubError("Someone else saved at the same moment. Reload the editor and try again.");
    }
    throw e;
  }
  return c.sha;
}

export type DeployState = "waiting" | "running" | "live" | "failed" | "unknown";

/** Status of the deploy workflow run for a commit. */
export async function deployState(token: string, sha: string): Promise<DeployState> {
  const r = await gh<{ workflow_runs: { name: string; status: string; conclusion: string | null }[] }>(
    token, `/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=20`,
  ).catch(() => null);
  if (!r) return "unknown";
  const runs = r.workflow_runs.filter((w) => /deploy/i.test(w.name));
  if (!runs.length) return "waiting";
  if (runs.some((w) => w.status !== "completed")) return "running";
  return runs.every((w) => w.conclusion === "success") ? "live" : "failed";
}
