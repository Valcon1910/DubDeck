import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VortexApp } from "./vortex/VortexApp";
import "./styles.css";

// Follow the device's light/dark setting.
const media = window.matchMedia?.("(prefers-color-scheme: dark)");
const applyTheme = () => { document.documentElement.dataset.theme = media?.matches ? "dark" : "light"; };
applyTheme();
// Afterwards the person's own choice (Settings → Theme) takes over; see account.ts.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VortexApp />
  </StrictMode>,
);

// Offline support (built site only: the dev server changes files constantly).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => undefined); });
}
