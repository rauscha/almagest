import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import type { Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { execSync } from "node:child_process";

/**
 * Vite stays bound to localhost on purpose. To play the dev server on a phone, put a TLS proxy in front
 * of it (a phone needs a secure context for AudioWorklet and service workers) and name it in
 * `.env.local`: DEV_HOST=<the proxy's hostname> and DEV_PORT=<the port it answers on>.
 */
const env = loadEnv("development", process.cwd(), "DEV_");
const DEV_HOST = env.DEV_HOST;
const DEV_PORT = Number(env.DEV_PORT || 443);

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

/**
 * Serve a directory byte for byte. Worklet modules must bypass Vite's transform
 * pipeline, and the vendored Parallax worklets are measured exactly as shipped.
 */
function raw(prefix: string, dir: string): Plugin {
  const root = resolve(dir);
  return {
    name: `raw:${prefix}`,
    configureServer(server) {
      server.middlewares.use(prefix, (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
        const file = join(root, rel);
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * Parallax's engines load their worklets and WASM from the site root. Only the two chord engines'
 * files go there, not the whole folder, which also holds Parallax's own icons.
 */
const PARALLAX = resolve("vendor/parallax/public");
const ENGINE_FILES: Record<string, string> = {
  "plaits-worklet.js": PARALLAX,
  "plaits.js": PARALLAX,
  "plaits.wasm": PARALLAX,
  "laxsynth-worklet.js": PARALLAX, // the pad synth: plain JS, no WASM
};
function engineFiles(): Plugin {
  return {
    name: "engine-files",
    configureServer(server) {
      for (const [name, dir] of Object.entries(ENGINE_FILES)) {
        server.middlewares.use(`/${name}`, (_req, res) => {
          res.setHeader("Content-Type", TYPES[extname(name)] ?? "application/octet-stream");
          res.setHeader("Cache-Control", "no-store");
          createReadStream(join(dir, name)).pipe(res);
        });
      }
    },
    generateBundle() {
      for (const [fileName, dir] of Object.entries(ENGINE_FILES)) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(join(dir, fileName)) });
      }
    },
  };
}

/** Which commit a build came from, so the phone can say what it's running. */
function buildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
  // Tests mount Svelte under a fake DOM, which needs its browser build. Setting this outside tests
  // replaces Vite's defaults and hands the real app Svelte's server build.
  ...(process.env.VITEST ? { resolve: { conditions: ["browser"] } } : {}),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    ...(DEV_HOST ? { allowedHosts: [DEV_HOST], hmr: { protocol: "wss" as const, host: DEV_HOST, clientPort: DEV_PORT } } : {}),
    watch: { ignored: ["**/vendor/**"] },
  },
  // Parallax has html entry points of its own; keep the dependency scan out of them.
  optimizeDeps: { entries: ["index.html"] },
  test: { include: ["src/**/*.test.ts", "tools/**/*.test.ts"] },
  plugins: [
    svelte(),
    engineFiles(),
    raw("/parallax/", "vendor/parallax/public"),
    VitePWA({
      injectRegister: false, // src/app/install.ts does it, on the rule that nothing reloads mid-play
      registerType: "prompt",
      manifestFilename: "manifest.json", // tailscale serve gives .webmanifest the wrong type
      manifest: {
        // Identity. Changing what these resolve to orphans the install, so they stay put.
        id: "./",
        start_url: "./",
        scope: "./",
        // The name can change without touching identity.
        name: "Almagest",
        short_name: "Almagest",
        description: "A star chart of the circle of fifths, where chords are stars and progressions are constellations you play.",
        // The app's own window state: no system bars, and no toast on wake. See src/app/install.ts.
        display: "fullscreen",
        orientation: "landscape",
        background_color: "#0A0F1D",
        theme_color: "#0A0F1D",
        categories: ["music", "education"],
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        // The worklets and WASM are what make it work offline, and the fonts what keep its look.
        globPatterns: ["**/*.{js,css,html,wasm,woff2,png,svg,webmanifest,ogg}"],
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
});
