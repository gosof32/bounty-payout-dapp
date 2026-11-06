import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./", // relative paths so the build works on GitHub Pages or any static host
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/frontend/**/*.test.{js,jsx}"],
    setupFiles: ["tests/frontend/setup.js"],
  },
});
