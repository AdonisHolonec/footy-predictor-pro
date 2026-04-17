// src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import RootRouter from "./RootRouter";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(container).render(
  <React.StrictMode>
    <RootRouter />
  </React.StrictMode>
);
