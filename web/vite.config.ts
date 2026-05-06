import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

import { prometheusLuaPlugin } from "./src/vite/prometheusLuaPlugin"

export default defineConfig({
  base: "/Prometheus/",
  plugins: [react(), tailwindcss(), prometheusLuaPlugin()],
  worker: {
    plugins: () => [prometheusLuaPlugin()],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  optimizeDeps: {
    exclude: ["wasmoon"],
  },
  test: {
    environment: "node",
    setupFiles: "./src/test/setup.ts",
    exclude: ["src/e2e/**", "node_modules/**", "dist/**"],
  },
})
