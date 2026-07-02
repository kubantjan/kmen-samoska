import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ⚠️  GitHub Pages servíruje z https://<user>.github.io/<REPO>/
// Nastav `base` na název svého repa i s lomítky, např. "/samoska/".
// Když repo přejmenuješ, změň to i tady.
const REPO = "/kmen-samoska/";

export default defineConfig({
  plugins: [react()],
  base: REPO,
});
