import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { LogoMark } from "../components/Logo";

const GIS_SRC = "https://accounts.google.com/gsi/client";

function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("Couldn't load Google sign-in.")));
    if (!existing) {
      s.src = GIS_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
  });
}

export function SignIn() {
  const { config, signInWithGoogle, signInDev, state } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(state.status === "signedOut" ? state.reason ?? null : null);
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState("");

  useEffect(() => {
    const clientId = config?.googleClientId;
    if (!clientId) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        const dark = document.documentElement.dataset.theme === "dark";
        window.google.accounts.id.initialize({
          client_id: clientId,
          auto_select: true,
          itp_support: true,
          use_fedcm_for_prompt: true,
          use_fedcm_for_button: true,
          callback: async (resp: { credential: string }) => {
            setBusy(true);
            setError(null);
            try {
              await signInWithGoogle(resp.credential);
            } catch (e) {
              setError((e as ApiError).message);
            } finally {
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard", theme: dark ? "filled_black" : "outline", size: "large",
          shape: "pill", text: "signin_with", logo_alignment: "left", width: 280,
        });
        window.google.accounts.id.prompt();
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      try {
        window.google?.accounts?.id?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [config?.googleClientId, signInWithGoogle]);

  return (
    <main className="signin">
      <div className="signin-card">
        <LogoMark size={56} />
        <h1>
          Dub<span className="logo-accent">Deck</span>
        </h1>
        <p className="muted">Your private video and audio downloader. Sign in to continue.</p>
        {config?.googleClientId ? (
          <div className="gis-slot" ref={buttonRef} aria-busy={busy} />
        ) : (
          !config?.devLogin && <p className="notice">Google sign-in isn't configured on the server yet.</p>
        )}
        {config?.devLogin && (
          <form
            className="dev-login"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await signInDev(devEmail);
              } catch (err) {
                setError((err as ApiError).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="dev-email">Developer sign-in (local testing only)</label>
            <div className="row">
              <input id="dev-email" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="you@example.com" />
              <button className="btn btn-primary" disabled={busy}>Sign in</button>
            </div>
          </form>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <p className="fine">Only addresses on your allowlist can sign in.</p>
      </div>
    </main>
  );
}
