// src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "./context/LocaleContext";
import RootRouter from "./RootRouter";
import { capturePendingReferral } from "./utils/referralLink";
import "./index.css";

/*
  Capture `?ref=` BEFORE anything renders.

  Supabase's auth redirects rewrite the URL and Auth.tsx calls history.replaceState
  of its own, so by the time a component mounts the parameter may already be gone.
  Boot is the only point where it is reliably still there. Never throws, and never
  claims anything — it only remembers the code for the explicit prompt.
*/
capturePendingReferral();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(container).render(
  <React.StrictMode>
    <LocaleProvider>
      <RootRouter />
    </LocaleProvider>
  </React.StrictMode>
);
