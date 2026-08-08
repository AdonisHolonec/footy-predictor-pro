import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PostCSS (Tailwind + Autoprefixer) → lăsat în `postcss.config.js`
// ca Vite să încarce tema custom (`signal.*`) corect pentru `@apply` în `index.css`.

// react-router 7.x publică `exports` care indică `dist/development` pentru toate
// condițiile standard (vezi remix-run/react-router#14753), deci build-ul de
// producție ar împacheta build-ul de development (cu ENABLE_DEV_WARNINGS=true).
// Aliniem manual intrările la `dist/production` doar la build.
// Aliasurile trebuie să fie căi absolute pe disc: exports-ul pachetului nu
// expune subpath-ul `./dist/*`, deci un alias către subpath ar fi respins.
const reactRouterProductionFile = (file) =>
  fileURLToPath(
    new URL(`./node_modules/react-router/dist/production/${file}`, import.meta.url)
  );

const reactRouterProductionAliases = [
  { find: /^react-router\/dom$/, replacement: reactRouterProductionFile("dom-export.mjs") },
  { find: /^react-router$/, replacement: reactRouterProductionFile("index.mjs") }
];

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: command === "build" ? reactRouterProductionAliases : []
  }
}));
