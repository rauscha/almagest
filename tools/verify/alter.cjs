// Pads and the menu with real pointers in a real browser, two fingers at once, and screenshots to look at.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs = require("fs"), path = require("path"), os = require("os");
let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

(async () => {
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 998, height: 448 }, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "?debug", { waitUntil: "networkidle" });
  await page.click("button.start");
  await page.waitForSelector("button.start", { state: "detached", timeout: 20000 });
  await page.evaluate(() => window.__almagest.core.send({ type: "ringChanged", ms: 3000 }));
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const name = () => page.evaluate(() => window.__almagest.core.views.readout.get().name);
  const tapChord = async (c) => { const [x, y] = await center(`[data-chord="${c}"]`); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); };
  const pad = (label) => `.pad:has(:is(.label, .ring):text-is("${label}"))`;
  /** Taps off whatever's latched, so a section starts plain. */
  const clearLatch = () => page.evaluate(() => {
    const { core } = window.__almagest;
    const { top, sus, quality } = core.state.get().latched;
    for (const pad of [top, sus, quality].filter(Boolean)) { core.send({ type: "padDown", pad, pointer: 991 }); core.send({ type: "padUp", pointer: 991 }); }
  });
  const tapPad = async (label) => { const [x, y] = await center(pad(label)); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); };
  const level = () => page.evaluate(async () => {
    const { meter } = window.__almagest; const buf = new Float32Array(meter.fftSize); let sum = 0, n = 0;
    const end = performance.now() + 300;
    while (performance.now() < end) { meter.getFloatTimeDomainData(buf); for (const x of buf) { sum += x * x; n++; } await new Promise((r) => setTimeout(r, 40)); }
    return Math.sqrt(sum / n);
  });

  await page.screenshot({ path: `${OUT}/alter_idle.png` });
  await tapChord("G");
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/alter_g.png` });
  await tapPad("7");
  check("a pad alters the ringing chord", (await name()) === "G7", await name());
  check("and it sounds", (await level()) > 0.01);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/alter_g7.png` });
  // A tap latches.
  await tapChord("C");
  check("the tapped 7 latches onto the next chord", (await name()) === "C7", await name());
  const latched7 = await page.locator(`${pad("7")}[data-latched="true"]`).count();
  check("and the 7 pad shows it's latched", latched7 === 1);
  await tapPad("7");
  check("tapped again, it comes off the chord sounding", (await name()) === "C", await name());
  await tapChord("G");
  check("and off the next one", (await name()) === "G", await name());

  // Two fingers at once, the way it's really played: pad down under one, chord under the other.
  const cdp = await page.context().newCDPSession(page);
  const [px, py] = await center(pad("maj7"));
  const [cx, cy] = await center('[data-chord="F"]');
  const pt = (id, x, y) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(1, px, py)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(1, px, py), pt(2, cx, cy)] });
  await page.waitForTimeout(60);
  check("a held pad applies to a chord pressed with another finger", (await name()) === "Fmaj7", await name());
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [pt(2, cx, cy)] });
  await page.waitForTimeout(40);
  const [ax, ay] = await center('[data-chord="Am"]');
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(1, px, py), pt(3, ax, ay)] });
  await page.waitForTimeout(40);
  check("and to the next one", (await name()) === "Am(maj7)", await name());
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(40);
  await tapChord("C");
  check("let go, and the next chord is plain", (await name()) === "C", await name());

  // The menu
  check("sound settings are hidden on the main screen", (await page.locator("button:text-is('Pad synth')").count()) === 0);
  await page.click("button:text-is('Menu')");
  await page.screenshot({ path: `${OUT}/menu_open.png` });
  await page.click("button:text-is('Multi-model')");
  await page.waitForFunction(() => window.__almagest.core.state.get().engine === "multi");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/menu_multi.png` });
  await page.click("button:text-is('Pad synth')");
  await page.waitForFunction(() => window.__almagest.core.state.get().engine === "pad");
  await page.waitForTimeout(600);
  await page.click("button:text-is('Warm Sine')");
  await page.screenshot({ path: `${OUT}/menu_pad.png` });
  await tapChord("Am");
  await page.waitForTimeout(150);
  check("a chord can be played with the menu open", (await level()) > 0.002 && (await name()) === "Am", await name());
  await tapPad("sus4");
  check("and a pad", (await name()) === "Asus4", await name());
  await page.click("button:text-is('Done')");
  check("Done closes it", (await page.locator("button:text-is('Pad synth')").count()) === 0);
  await page.click("button:text-is('Menu')");
  await page.click("button:text-is('Multi-model')");
  await page.click("button:text-is('Done')");
  await page.waitForTimeout(500);

  await clearLatch();
  // A minor, raised V
  await page.evaluate(() => {
    const { core } = window.__almagest;
    core.send({ type: "touch", phase: "down", pointer: 77, ref: null, head: true, r: 212, theta: 0, time: 0 });
    core.send({ type: "touch", phase: "move", pointer: 77, ref: null, r: 100, theta: 0, ring: "min", time: 0 });
    core.send({ type: "touch", phase: "up", pointer: 77, ref: null, r: 100, theta: 0, time: 0 });
  });
  await tapChord("Em");
  await tapPad("Major");
  check("Major on v is the raised V", (await name()) === "E", await name());
  await tapPad("7");
  check("and takes a 7", (await name()) === "E7", await name());
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/alter_raised.png` });
  await clearLatch();
  // Creep, in G: G, Bm made Major, C, C made Minor
  await page.evaluate(() => {
    const { core } = window.__almagest;
    core.send({ type: "touch", phase: "down", pointer: 78, ref: null, head: true, r: 212, theta: 0, time: 0 });
    core.send({ type: "touch", phase: "move", pointer: 78, ref: null, r: 212, theta: 30, ring: "maj", time: 0 });
    core.send({ type: "touch", phase: "up", pointer: 78, ref: null, r: 212, theta: 30, time: 0 });
  });
  const creep = [];
  await tapChord("G"); creep.push(await name());
  await tapChord("Bm"); await tapPad("Major"); creep.push(await name());
  await tapChord("C"); creep.push(await name());
  await tapPad("Minor"); creep.push(await name());
  check("Creep: G, B, C, Cm, all from the wedge", creep.join() === "G,B,C,Cm", creep.join());
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/alter_creep.png` });

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
})().catch((e) => { console.error(e); process.exit(1); });
