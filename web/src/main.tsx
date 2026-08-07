import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
// Self-hosted via @fontsource (bundled by Vite into dist/assets, no runtime
// CDN request) — CLAUDE.md requires the UI work fully offline with no
// external CDN, which rules out a Google Fonts <link>. Latin-only subset:
// the app is English-only UI chrome, and the full latin+latin-ext set would
// roughly double the font payload for characters nothing here uses.
import "@fontsource/sora/latin-400.css";
import "@fontsource/sora/latin-500.css";
import "@fontsource/sora/latin-600.css";
import "@fontsource/sora/latin-700.css";
import "./theme.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root element");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
