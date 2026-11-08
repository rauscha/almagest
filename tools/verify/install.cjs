// The installed build, at its real address, in a fresh browser profile with the strict autoplay rule.
// The other scripts launch with an autoplay flag that would hide a silent first press, so
// this one first proves that rule is really on.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs = require("fs"), path = require("path"), os = require("os");
// A build, not the dev server: `npm run build && npm run preview`, then pass its address (or set ALMAGEST_URL).
const APP = process.argv[2] ?? process.env.ALMAGEST_URL ?? "http://127.0.0.1:4173/";
let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

const SPY = () => {
  window.__fullscreenCalls = 0;
  setTimeout(() => {
    const c = new AudioContext();
    setTimeout(() => { window.__beforeTap = c.state; c.close(); }, 300);
  }, 50);
  const real = Element.prototype.requestFullscreen;
  Element.prototype.requestFullscreen = function (...a) { window.__fullscreenCalls++; return real.apply(this, a); };
};
const level = (page, ms = 400) => page.evaluate(async (ms) => {
  const { meter } = window.__almagest;
  const buf = new Float32Array(meter.fftSize);
  let sum = 0, n = 0;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    meter.getFloatTimeDomainData(buf);
    for (const x of buf) { sum += x * x; n++; }
    await new Promise((r) => setTimeout(r, 40));
  }
  return +Math.sqrt(sum / n).toFixed(4);
}, ms);
const setHidden = (page, hidden) => page.evaluate((hidden) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}, hidden);
const tap = async (page) => {
  await page.click("button.start");
  await page.waitForSelector("button.start", { state: "detached", timeout: 20000 });
};
const press = async (page, name) => {
  const b = await page.locator(`[data-chord="${name}"]`).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
};

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "almagest-fresh-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath,
    args: ["--no-sandbox", "--autoplay-policy=document-user-activation-required"],
    viewport: { width: 998, height: 448 },
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(SPY);
  await page.goto(`${APP}?debug`, { waitUntil: "networkidle" });

  // ---- is the rule on? a control that shows this test could fail
  // Playwright's evaluate counts as a user gesture, so this has to be measured by the page itself.
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.__beforeTap);
  check("control: before a tap, the browser refuses to start audio", before === "suspended", before);

  // ---- can it install?
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors: installErrors } = await cdp.send("Page.getInstallabilityErrors");
  check("Chrome finds nothing stopping an install", installErrors.length === 0, JSON.stringify(installErrors));
  const { errors: manifestErrors, url: manifestUrl } = await cdp.send("Page.getAppManifest");
  check("the manifest loads with no errors", !!manifestUrl && manifestErrors.length === 0, JSON.stringify(manifestErrors));
  const manifest = await (await page.request.get(manifestUrl)).json();
  check("it asks for fullscreen, landscape, on its own identity",
    manifest.display === "fullscreen" && manifest.orientation === "landscape" && manifest.id === "./" && manifest.start_url === "./" && manifest.scope === "./");
  const external = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => !n.startsWith(location.origin)));
  check("nothing is fetched from anywhere else, so offline can't lose it", external.length === 0, external.join(" "));

  // ---- the first press, in a fresh profile
  await tap(page);
  await page.waitForFunction(() => window.__almagest?.ctx?.state === "running", null, { timeout: 5000 }).catch(() => {});
  check("the first tap starts the audio", (await page.evaluate(() => window.__almagest.ctx.state)) === "running");
  await press(page, "G");
  await page.waitForTimeout(150);
  const first = await level(page);
  await page.mouse.up();
  check("the first press makes sound", first > 0.01, `rms ${first}`);
  check("in a browser tab, fullscreen is requested once", (await page.evaluate(() => window.__fullscreenCalls)) === 1);

  // ---- away and back
  await press(page, "C");
  await page.waitForTimeout(200);
  await setHidden(page, true);
  const gone = await page.evaluate(() => window.__almagest.core.state.get());
  check("going away stops every note and forgets the finger", gone.sounding === null && gone.fingers.length === 0);
  // Suspending cuts the output dead, so it must already be silent: no release or room tail left to click.
  await page.waitForTimeout(80);
  const tail = await level(page, 100);
  check("going away fades the output to silence before it suspends", tail < 0.001, `rms ${tail}`);
  await page.mouse.up();
  await page.waitForTimeout(700);
  check("going away suspends the audio", (await page.evaluate(() => window.__almagest.ctx.state)) === "suspended");
  await page.waitForTimeout(300);
  await setHidden(page, false);
  await page.waitForFunction(() => window.__almagest.ctx.state === "running", null, { timeout: 3000 }).catch(() => {});
  check("coming back resumes it", (await page.evaluate(() => window.__almagest.ctx.state)) === "running",
    `in ${await page.evaluate(() => window.__almagest.keeper.lastResumeMs)} ms here`);
  await press(page, "F");
  await page.waitForTimeout(150);
  const woke = await level(page);
  await page.mouse.up();
  check("a press after coming back makes sound", woke > 0.01, `rms ${woke}`);
  check("no second fullscreen request on wake", (await page.evaluate(() => window.__fullscreenCalls)) === 1);

  // ---- losing focus while on screen: Android's app switcher, before the page is hidden
  await page.waitForTimeout(1300);
  await press(page, "G");
  await page.waitForTimeout(150);
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  await page.waitForTimeout(100);
  const blurred = await level(page, 120);
  check("losing focus silences and fades, with no suspend", blurred < 0.001 && (await page.evaluate(() => window.__almagest.core.state.get().sounding)) === null, `rms ${blurred}`);
  await page.mouse.up();
  await press(page, "F");
  await page.waitForTimeout(150);
  const refocused = await level(page);
  await page.mouse.up();
  check("the next press after that sounds", refocused > 0.01, `rms ${refocused}`);

  // ---- Android suspends it while it's on screen
  await page.evaluate(() => window.__almagest.ctx.suspend());
  await page.waitForTimeout(100);
  await page.waitForFunction(() => window.__almagest.ctx.state === "running", null, { timeout: 1000 }).catch(() => {});
  check("if the audio is suspended underneath it while visible, it comes back", (await page.evaluate(() => window.__almagest.ctx.state)) === "running");

  // ---- the zombie: claims to be running, clock stopped
  await page.evaluate(() => {
    const ctx = window.__almagest.ctx;
    const stuck = ctx.currentTime;
    Object.defineProperty(ctx, "currentTime", { get: () => stuck });
  });
  await page.waitForFunction(() => window.__almagest.keeper.rebuilds === 1 && window.__almagest.keeper.graph, null, { timeout: 8000 }).catch(() => {});
  check("a stopped clock gets a new context and new voices", (await page.evaluate(() => window.__almagest.keeper.rebuilds)) === 1);
  await page.waitForFunction(() => window.__almagest.ctx?.state === "running", null, { timeout: 3000 }).catch(() => {});
  await press(page, "Dm");
  await page.waitForTimeout(150);
  const rebuilt = await level(page);
  await page.mouse.up();
  check("and it plays", rebuilt > 0.01, `rms ${rebuilt}`);

  // ---- offline
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.state === "activated";
  }, null, { timeout: 15000 });
  check("the service worker is active", true);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" });
  check("offline: it opens", await page.waitForSelector("button.start", { timeout: 5000 }).then(() => true, () => false));
  await tap(page);
  await page.waitForFunction(() => window.__almagest?.ctx?.state === "running", null, { timeout: 5000 }).catch(() => {});
  await press(page, "Am");
  await page.waitForTimeout(150);
  const offline = await level(page);
  await page.mouse.up();
  check("offline: it plays, worklets and WASM included", offline > 0.01, `rms ${offline}`);
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`); });
  check("offline: its fonts load (the star atlas: Newsreader, Plex for figures)", fonts.some((f) => /Plex/.test(f)) && fonts.some((f) => /Newsreader/.test(f)), fonts.join(", "));
  await ctx.setOffline(false);

  // ---- installed: no toast, because the API is never touched
  const installed = await ctx.newPage();
  await installed.addInitScript(SPY);
  // Chrome's device emulation can't fake this window state, so the page is told directly.
  await installed.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode: fullscreen/.test(q) ? { matches: true } : real(q));
  });
  await installed.goto(`${APP}?debug`, { waitUntil: "load" });
  check("installed: no Full button", (await installed.locator("button.full").count()) === 0);
  await tap(installed);
  await setHidden(installed, true);
  await installed.waitForTimeout(100);
  await setHidden(installed, false);
  await installed.waitForTimeout(100);
  check("installed: the Fullscreen API is never called, tap or wake", (await installed.evaluate(() => window.__fullscreenCalls)) === 0);
  await installed.close();

  const real = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
  check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
