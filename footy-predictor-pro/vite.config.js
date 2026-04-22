import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PostCSS (Tailwind + Autoprefixer) → lăsat în `postcss.config.js`
// ca Vite să încarce tema custom (`signal.*`) corect pentru `@apply` în `index.css`.

export default defineConfig({
  plugins: [react()]
});
