import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { PluginOption, ProxyOptions } from "vite";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { cartographer } from "@replit/vite-plugin-cartographer";
import { devBanner } from "@replit/vite-plugin-dev-banner";

const port = Number(process.env.PORT ?? "5174");
const basePath = process.env.BASE_PATH ?? "/content-calendar/";

/** Ensures the API always receives x-api-key (Vite 7 + http-proxy-3 can omit static `headers` on the upstream request). */
function withApiKeyProxy(
  key: string,
  extra: { target: string; changeOrigin: boolean } = {
    target: "http://127.0.0.1:3001",
    changeOrigin: true,
  },
): ProxyOptions {
  return {
    ...extra,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("x-api-key", key);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname, "."), "");
  const localApiKey =
    env.LOCAL_API_KEY ||
    env.VITE_LOCAL_API_KEY ||
    "sk-content-calendar-test-2026";

  const replitPlugins: PluginOption[] =
    process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
      ? [
          cartographer({
            root: path.resolve(import.meta.dirname, ".."),
          }),
          devBanner(),
        ]
      : [];

  const baseProxy = withApiKeyProxy(localApiKey);

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), runtimeErrorOverlay(), ...replitPlugins],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
        "@workspace/research-brief": path.resolve(import.meta.dirname, "..", "..", "lib", "research-brief", "src", "index.ts"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      open: basePath,
      allowedHosts: true,
      proxy: {
        "/api": baseProxy,
        "/content-calendar/api": baseProxy,
      },
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": baseProxy,
        "/content-calendar/api": baseProxy,
      },
    },
  };
});
