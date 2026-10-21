import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { LogoMark } from "../components/Logo";
import { readJSON, writeJSON } from "../storage";

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
  const { config, signInWithGoogle, signInDev, signInPasscode, requestCode, verifyCode, state } = useAuth();
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
        {config?.passcodeLogin && <PasscodeForm signIn={signInPasscode} onError={setError} />}
        {config?.passcodeLogin && config.emailLogin && <p className="or">or</p>}
        {config?.emailLogin && (
          <EmailCodeForm requestCode={requestCode} verifyCode={verifyCode} onError={setError} />
        )}
        {config?.googleClientId && (
          <>
            {config.emailLogin && <p className="or">or</p>}
            <div className="gis-slot" ref={buttonRef} aria-busy={busy} />
          </>
        )}
        {!config?.googleClientId && !config?.emailLogin && !config?.passcodeLogin && !config?.devLogin && (
          <p className="notice">No sign-in method is configured on the server yet.</p>
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
        <p className="fine">You only need to do this once on each device.</p>
      </div>
    </main>
  );
}

const EMAIL_KEY = "dubdeck.lastEmail";

function EmailCodeForm({ requestCode, verifyCode, onError }: {
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [email, setEmail] = useState(() => readJSON<string>(EMAIL_KEY) ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    onError(null);
    try {
      await requestCode(email.trim());
      writeJSON(EMAIL_KEY, email.trim());
      setStep("code");
    } catch (e) {
      onError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === "email") {
    return (
      <form className="code-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
      </form>
    );
  }
  return (
    <form
      className="code-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        onError(null);
        try {
          await verifyCode(email.trim(), code);
        } catch (err) {
          onError((err as ApiError).message);
          setBusy(false);
        }
      }}
    >
      <p className="muted">If {email} is allowed, a 6-digit code is on its way. It expires in 10 minutes.</p>
      <label htmlFor="login-code">Code</label>
      <input id="login-code" className="mono code-input" inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6} required autoFocus value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
      <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Sign in"}</button>
      <div className="row code-links">
        <button type="button" className="link-btn" onClick={() => { setCode(""); void send(); }}>Resend code</button>
        <button type="button" className="link-btn" onClick={() => { setStep("email"); setCode(""); }}>Use another email</button>
      </div>
    </form>
  );
}

function PasscodeForm({ signIn, onError }: { signIn: (p: string) => Promise<void>; onError: (m: string | null) => void }) {
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="code-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        onError(null);
        try {
          await signIn(passcode);
        } catch (err) {
          onError((err as ApiError).message);
          setBusy(false);
        }
      }}
    >
      <label htmlFor="passcode">Passcode</label>
      <input id="passcode" type="password" autoComplete="current-password" required autoFocus
        value={passcode} onChange={(e) => setPasscode(e.target.value)} />
      <button className="btn btn-primary" disabled={busy || !passcode}>{busy ? "Checking…" : "Sign in"}</button>
    </form>
  );
}
