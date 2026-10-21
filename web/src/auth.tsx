import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, hasSession, onUnauthorized, setSession } from "./api";
import { readJSON, writeJSON } from "./storage";
import type { User } from "./types";

interface AuthConfig {
  googleClientId: string | null;
  emailLogin: boolean;
  passcodeLogin: boolean;
  ephemeral: boolean;
  devLogin: boolean;
}

type State =
  | { status: "loading" }
  | { status: "signedOut"; reason?: string }
  | { status: "signedIn"; user: User }
  | { status: "error"; message: string; code: string };

interface AuthApi {
  state: State;
  config: AuthConfig | null;
  signInWithGoogle(credential: string): Promise<void>;
  signInDev(email: string): Promise<void>;
  signInPasscode(passcode: string): Promise<void>;
  requestCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(everywhere?: boolean): Promise<void>;
  retry(): void;
}

const Ctx = createContext<AuthApi | null>(null);
const USER_KEY = "dubdeck.user";

interface SessionResponse {
  token: string;
  user: User;
}

declare global {
  interface Window {
    google?: any;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onUnauthorized((err) => {
      setState({ status: "signedOut", reason: err.code === "not_allowed" ? err.message : undefined });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api<AuthConfig>("/api/auth/config", { auth: false });
        if (cancelled) return;
        setConfig(cfg);
        if (!hasSession()) {
          setState({ status: "signedOut" });
          return;
        }
        const cached = readJSON<User>(USER_KEY);
        if (cached) setState({ status: "signedIn", user: cached });
        const { token, ...user } = await api<User & { token?: string }>("/api/auth/me");
        if (cancelled) return;
        if (token) setSession(token); // sliding renewal
        writeJSON(USER_KEY, user);
        setState({ status: "signedIn", user });
      } catch (e) {
        if (cancelled) return;
        const err = e as ApiError;
        if (["no_session", "bad_session", "not_allowed"].includes(err.code)) return; // handled by onUnauthorized
        const cached = readJSON<User>(USER_KEY);
        if (err.code === "offline" && cached && hasSession()) {
          setState({ status: "signedIn", user: cached });
          return;
        }
        setState({
          status: "error",
          code: err.code,
          message:
            err.code === "bad_key"
              ? "The backend rejected the proxy key. Check that the here.now account variable DUBDECK_BACKEND_KEY matches the server's DUBDECK_BACKEND_KEY."
              : err.message,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const finish = useCallback((res: SessionResponse) => {
    setSession(res.token);
    writeJSON(USER_KEY, res.user);
    setState({ status: "signedIn", user: res.user });
  }, []);

  const signInWithGoogle = useCallback(
    async (credential: string) => finish(await api<SessionResponse>("/api/auth/google", { body: { credential }, auth: false })),
    [finish],
  );

  const signInDev = useCallback(
    async (email: string) => finish(await api<SessionResponse>("/api/auth/dev", { body: { email }, auth: false })),
    [finish],
  );

  const signInPasscode = useCallback(
    async (passcode: string) => finish(await api<SessionResponse>("/api/auth/passcode", { body: { passcode }, auth: false })),
    [finish],
  );

  const requestCode = useCallback(async (email: string) => {
    await api("/api/auth/email/start", { body: { email }, auth: false });
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string) =>
      finish(await api<SessionResponse>("/api/auth/email/verify", { body: { email, code }, auth: false })),
    [finish],
  );

  const signOut = useCallback(async (everywhere = false) => {
    try {
      await api("/api/auth/logout", { body: { everywhere } });
    } catch {
      /* the local session is dropped either way */
    }
    setSession(null);
    try {
      window.google?.accounts?.id?.disableAutoSelect();
    } catch {
      /* GIS not loaded */
    }
    setState({ status: "signedOut" });
  }, []);

  const value = useMemo<AuthApi>(
    () => ({ state, config, signInWithGoogle, signInDev, signInPasscode, requestCode, verifyCode, signOut, retry: () => setAttempt((n) => n + 1) }),
    [state, config, signInWithGoogle, signInDev, signInPasscode, requestCode, verifyCode, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function useUser(): User {
  const { state } = useAuth();
  if (state.status !== "signedIn") throw new Error("not signed in");
  return state.user;
}
