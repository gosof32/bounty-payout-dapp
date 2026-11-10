import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./", // relative paths so the build works on GitHub Pages or any static host
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Vendor chunks (React, viem and friends, genlayer-js) so no chunk passes Vite's 500 kB warning.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (/node_modules\/(viem|ox|abitype|@noble|@scure)\//.test(id)) return "viem";
          return "chain";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/frontend/**/*.test.{js,jsx}"],
    setupFiles: ["tests/frontend/setup.js"],
  },
});
