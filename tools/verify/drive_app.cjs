// The real app, over the real tailnet BASE, in a real browser: does pressing a chord make sound?
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs = require("fs"), path = require("path"), os = require("os");
let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

(async () => {
  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 998, height: 448 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400) console.log("HTTP", r.status(), r.url().slice(0, 110)); });
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|Failed to load resource: net::ERR_(ABORTED|FAILED)/i.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE + "?debug", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/app_start.png` });
  check("asks for a first tap", await page.isVisible("button.start"));

  const t0 = Date.now();
  await page.click("button.start");
  await page.waitForSelector("button.start", { state: "detached", timeout: 20000 });
  console.log(`note  voices ready ${Date.now() - t0} ms after the tap`);
  const running = await page.evaluate(() => window.__almagest.ctx.state);
  check("the audio context is running", running === "running", running);

  const level = (ms = 500) => page.evaluate(async (ms) => {
    const { meter } = window.__almagest;
    const buf = new Float32Array(meter.fftSize);
    let peak = 0, sum = 0, n = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      meter.getFloatTimeDomainData(buf);
      for (const x of buf) { peak = Math.max(peak, Math.abs(x)); sum += x * x; n++; }
      await new Promise((r) => setTimeout(r, 40));
    }
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4) };
  }, ms);
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const cell = (name) => `[data-chord="${name}"]`;

  await page.click("button:text-is('Menu')"); // left open: it doesn't cover the circle
  const quiet = await level(300);
  check("silent before any press", quiet.peak < 0.001, JSON.stringify(quiet));

  const [gx, gy] = await center(cell("G"));
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const held = await level();
  check("holding G makes sound", held.rms > 0.01, JSON.stringify(held));
  check("not clipping", held.peak < 1, JSON.stringify(held));
  check("the readout names it", (await page.textContent("[data-slot=readout]")).includes("G"));
  await page.screenshot({ path: `${OUT}/app_held.png` });
  await page.mouse.up();

  const ringing = await level(600);
  check("it rings on after the lift", ringing.rms > 0.002, JSON.stringify(ringing));
  await page.waitForTimeout(2600);
  const after = await level(300);
  console.log(`note  level 3.5 s after the lift ${JSON.stringify(after)} (a release tail may remain)`);
  const silent = await page.evaluate(() => window.__almagest.core.state.get().sounding === null);
  check("the ring ends", silent);

  // Sustain
  await page.click(".sustain-disc");
  const [cx, cy] = await center(cell("C"));
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(2500);
  const sustained = await level(300);
  check("Sustain keeps sounding well past the ring time", sustained.rms > 0.002 && await page.evaluate(() => window.__almagest.core.state.get().sounding !== null), JSON.stringify(sustained));
  await page.click(".sustain-disc");
  check("switching Sustain off ends it", await page.evaluate(() => window.__almagest.core.state.get().sounding === null));
  await page.waitForTimeout(400);

  // Every multi-model sound, then FM: does each make sound, and does any clip?
  const stats = [];
  const walk = async (label, settle = 120) => {
    const names = await page.evaluate(() => window.__almagest.core.views.menu.get().models);
    for (let i = 0; i < names.length; i++) {
      const [ax, ay] = await center(cell("Am"));
      await page.mouse.move(ax, ay); await page.mouse.down();
      await page.waitForTimeout(settle);
      const v = await level(350);
      await page.mouse.up();
      stats.push({ engine: label, name: names[i], ...v });
      await page.click("button:text-is('Off') >> nth=3");
      await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.up();
      await page.click("button:text-is('1.5')");
      await page.click(`.sound[aria-label="${names[(i + 1) % names.length]}"]`);
      await page.waitForTimeout(160); // a chord struck within ~60 ms of a sound change peaks a little hot on Bank A
    }
  };
  await page.click("button:text-is('Multi-model')"); // the pads are the default now
  await page.waitForFunction(() => window.__almagest.core.state.get().engine === "multi");
  await page.waitForTimeout(800);
  await walk("multi");
  await page.click("button:text-is('Pad synth')");
  await page.waitForFunction(() => window.__almagest.core.state.get().engine === "pad");
  await page.waitForTimeout(800);
  await walk("pad", 700); // a pad's attack is slow, so let it arrive before measuring
  await page.click("button:text-is('Recorded')");
  await page.waitForFunction(() => window.__almagest.core.state.get().engine === "recorded");
  await page.waitForTimeout(2500); // the recordings have to decode
  await walk("recorded", 700);
  const dead = stats.filter((s) => s.rms < 0.002);
  const hot = stats.filter((s) => s.peak >= 0.99);
  const rmss = stats.map((s) => s.rms).sort((a, b) => a - b);
  console.log(`note  ${stats.length} sounds. rms from ${rmss[0]} to ${rmss.at(-1)}, median ${rmss[rmss.length >> 1]}`);
  check("every sound makes sound", dead.length === 0, dead.map((d) => d.name).join(", "));
  check("no sound clips", hot.length === 0, hot.map((d) => `${d.name} ${d.peak}`).join(", "));
  fs.writeFileSync(path.join(path.dirname(OUT), "levels.json"), JSON.stringify(stats, null, 1));

  // Settings survive a reload
  await page.click("button:text-is('3')");
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: "networkidle" });
  await page.click("button.start");
  await page.waitForSelector("button.start", { state: "detached", timeout: 20000 });
  await page.click("button:text-is('Menu')");
  const s = await page.evaluate(() => { const c = window.__almagest.core.state.get(); return { engine: c.engine, ringMs: c.ringMs }; });
  check("settings survive a reload", s.engine === "recorded" && s.ringMs === 3000, JSON.stringify(s));
  await page.click("button:text-is('Multi-model')");
  await page.click("button:text-is('1.5')");

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
})().catch((e) => { console.error(e); process.exit(1); });
