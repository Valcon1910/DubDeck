// The admin editor saves by committing to the site's GitHub repository through
// the site's /gh proxy route: here.now adds the GITHUB_EDIT_TOKEN secret on the
// way to api.github.com, so no token is ever typed in or kept in the browser.
// The push to main redeploys the site, and access-list changes are applied to
// here.now by the "Sync access allowlist" workflow.

export const REPO: string = __VORTEX_REPO__;
/** main for the real site, test for the test site (set at build time). */
export const BRANCH: string = __VORTEX_BRANCH__;
export const CONTENT_PATH = "web/content.json";
export const ACCESS_PATH = "config/allowed-emails.json";
const API = "/gh";

export class GitHubError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

async function gh<T>(_token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new GitHubError("Can't reach GitHub. Check the internet connection.");
  }
  if (res.status === 401 && /access_restricted/.test(await res.clone().text())) {
    throw new GitHubError("Sign in to the site with an editor email first.", 401);
  }
  if (res.status === 401) throw new GitHubError("GitHub didn't accept the saved token (GH_EDIT_TOKEN). It may be wrong or expired; replace it and redeploy.", 401);
  if (res.status === 403 || res.status === 404) {
    throw new GitHubError(`The saved token can't access ${REPO}. Give GH_EDIT_TOKEN "Contents: Read and write" and "Actions: Read" on that repository, then redeploy.`, res.status);
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
  if (!repo.permissions?.push) throw new GitHubError(`The saved token can read ${REPO} but not save to it. Give GH_EDIT_TOKEN "Contents: Read and write".`);
  const me = await gh<{ login?: string }>(token, "/user").catch(() => ({ login: undefined }));
  return me.login ?? "admin";
}

/** Read a JSON file from the tip of main (so edits always start from the newest saved copy). */
export async function readJson<T>(token: string, path: string, branch = BRANCH): Promise<T> {
  const f = await gh<{ content: string }>(token, `/repos/${REPO}/contents/${path}?ref=${branch}`);
  return JSON.parse(dec.decode(fromBase64(f.content))) as T;
}

export interface FileChange { path: string; text?: string; bytes?: Uint8Array }

/** Commit several files to main in one commit. Returns the commit SHA. */
export async function commit(token: string, message: string, files: FileChange[], branch = BRANCH): Promise<string> {
  const BRANCH = branch;
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
  const runs = r.workflow_runs.filter((w) => /publish|deploy/i.test(w.name));
  if (!runs.length) return "waiting";
  if (runs.some((w) => w.status !== "completed")) return "running";
  return runs.every((w) => w.conclusion === "success") ? "live" : "failed";
}

/** The two publish actions the Admin page can start. */
export const ACTIONS = {
  test: { file: "deploy-test.yml", name: "Publish code to test site", inputs: { code_branch: "claude/dubdeck-architecture-nxzvcz" } },
  real: { file: "deploy.yml", name: "Publish test site to real site", inputs: {} },
} as const;

export async function runAction(key: keyof typeof ACTIONS): Promise<void> {
  const a = ACTIONS[key];
  let res: Response;
  try {
    res = await fetch(`${API}/repos/${REPO}/actions/workflows/${a.file}/dispatches`, {
      method: "POST", cache: "no-store",
      headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: a.inputs }),
    });
  } catch {
    throw new GitHubError("Can't reach GitHub. Check the internet connection.");
  }
  if (res.status === 403 || res.status === 404) {
    throw new GitHubError('The saved token can\'t start actions. Give GH_EDIT_TOKEN "Actions: Read and write", then publish again.', res.status);
  }
  if (!res.ok) throw new GitHubError(`GitHub error ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
}

export interface Run { id: number; name: string; status: string; conclusion: string | null; created_at: string; html_url: string; event: string }

/** The latest publish runs, newest first. */
export async function recentRuns(token: string): Promise<Run[]> {
  const r = await gh<{ workflow_runs: Run[] }>(token, `/repos/${REPO}/actions/runs?per_page=30`);
  return r.workflow_runs.filter((w) => /publish/i.test(w.name)).slice(0, 6);
}
