import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readJSON } from "./storage";
import "./styles.css";

// Apply the cached theme before first paint to avoid a flash.
const cached = readJSON<{ settings?: { appearance?: { theme?: string } } }>("dubdeck.settings");
const theme = cached?.settings?.appearance?.theme;
const dark = theme === "dark" || (theme !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
document.documentElement.dataset.theme = dark ? "dark" : "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
