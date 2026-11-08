// Shared by the scripts in this folder: a Chromium for Playwright, the address to test, and where screenshots go.
//
//   ALMAGEST_URL  the app to test. Default: the dev server, http://127.0.0.1:5173/ (`npm run dev`).
//                 install.cjs and update.cjs test a build instead; see each one.
//   CHROMIUM      a Chromium binary to use, when Playwright's own isn't installed (`npx playwright install chromium`).
//   SHOTS         where screenshots go. Default: almagest-shots in the system temp folder.
const fs = require("fs"), path = require("path"), os = require("os");
const { chromium } = require("playwright");

/** Playwright's own browser if it's there; otherwise CHROMIUM, or any Chromium Playwright has downloaded before. */
function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  try {
    if (fs.existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* no browser registered for this version */
  }
  const base = path.join(os.homedir(), ".cache/ms-playwright");
  if (!fs.existsSync(base)) return undefined;
  for (const dir of fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const sub of fs.readdirSync(path.join(base, dir))) {
      const bin = path.join(base, dir, sub, "chrome");
      if (fs.existsSync(bin)) return bin;
    }
  }
  return undefined;
}

const BASE = process.env.ALMAGEST_URL || "http://127.0.0.1:5173/";
const OUT = process.env.SHOTS || path.join(os.tmpdir(), "almagest-shots");
fs.mkdirSync(OUT, { recursive: true });

module.exports = { chromium, executablePath: findChromium(), BASE, OUT };
