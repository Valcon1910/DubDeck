import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import { Modal } from "./components/Modal";
import { NAV, Shell } from "./components/Shell";
import { LogoMark } from "./components/Logo";
import { LiveProvider } from "./live";
import { DownloadPage } from "./pages/DownloadPage";
import { LibraryPage } from "./pages/LibraryPage";
import { QueuePage } from "./pages/QueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignIn } from "./pages/SignIn";
import { RouterProvider, useRouter } from "./router";
import { SettingsProvider } from "./settings";
import { ToastProvider } from "./toasts";
import { extractUrls } from "./util";

function isTyping(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  return !!e && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || e.isContentEditable);
}

function SignedInApp() {
  const { route, go } = useRouter();
  const [intake, setIntake] = useState<{ urls: string[]; nonce: number } | null>(null);
  const [shortcuts, setShortcuts] = useState(false);

  // Ctrl+V anywhere on the page (outside a text field) pastes and previews links.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const urls = extractUrls(e.clipboardData?.getData("text") ?? "");
      if (!urls.length) return;
      e.preventDefault();
      go("download");
      setIntake({ urls, nonce: Date.now() });
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector("dialog[open]")) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const n = NAV.find((x) => x.key === e.key);
        if (n) {
          e.preventDefault();
          go(n.route);
        }
      } else if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcuts(true);
      }
    };
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKey);
    };
  }, [go]);

  return (
    <Shell onShortcuts={() => setShortcuts(true)}>
      {route === "download" && <DownloadPage intake={intake} />}
      {route === "queue" && <QueuePage />}
      {route === "library" && <LibraryPage />}
      {route === "settings" && <SettingsPage onShortcuts={() => setShortcuts(true)} />}
      {shortcuts && (
        <Modal title="Keyboard shortcuts" onClose={() => setShortcuts(false)}>
          <dl className="shortcuts">
            <div><dt><kbd>Ctrl</kbd> + <kbd>V</kbd></dt><dd>Paste links anywhere and preview them</dd></div>
            <div><dt><kbd>Enter</kbd></dt><dd>Preview the links in the box</dd></div>
            {NAV.map((n) => <div key={n.route}><dt><kbd>Alt</kbd> + <kbd>{n.key}</kbd></dt><dd>Go to {n.label}</dd></div>)}
            <div><dt><kbd>/</kbd></dt><dd>Search the Library</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>Close dialogs and menus</dd></div>
            <div><dt><kbd>?</kbd></dt><dd>Show this list</dd></div>
          </dl>
        </Modal>
      )}
    </Shell>
  );
}

function Gate() {
  const { state, retry } = useAuth();
  if (state.status === "loading") {
    return (
      <div className="splash" aria-busy="true">
        <LogoMark size={48} />
        <span className="sr-only">Loading DubDeck</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <main className="signin">
        <div className="signin-card">
          <LogoMark size={48} />
          <h1>Can't connect</h1>
          <p className="error-text" role="alert">{state.message}</p>
          <button className="btn btn-primary" onClick={retry}>Try again</button>
        </div>
      </main>
    );
  }
  if (state.status === "signedOut") return <SignIn />;
  return (
    <SettingsProvider>
      <LiveProvider>
        <RouterProvider>
          <SignedInApp />
        </RouterProvider>
      </LiveProvider>
    </SettingsProvider>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
