import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PostCSS (Tailwind + Autoprefixer) → lăsat în `postcss.config.js`
// ca Vite să încarce tema custom (`signal.*`) corect pentru `@apply` în `index.css`.

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    // Allow the Emergent preview hosts so this dev server can be reached via ingress.
    allowedHosts: [".preview.emergentagent.com", ".preview.emergentcf.cloud", "localhost"]
  }
});
