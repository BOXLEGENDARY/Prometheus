import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { prometheusLuaPlugin } from "./src/vite/prometheusLuaPlugin"

export default defineConfig(({ command }) => {
  const isDevServer = command === "serve"

  return {
    // Use repo base path for production/preview, but root path for local dev.
    // This keeps runtime asset URLs (including Wasm files loaded by dependencies)
    // valid in both environments.
    base: isDevServer ? "/" : "/Prometheus/",
    plugins: [react(), tailwindcss(), prometheusLuaPlugin()],
    worker: {
      format: "es",
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
  }
})
