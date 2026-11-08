// The long press, with real touch events (docs/GESTURES.md). Holding a chord 450 ms lights
// the chord that leads to it, its secondary dominant, and sliding onto that plays it as a 7th.
// Run against the dev server: node tools/verify/longpress.cjs [shot dir] [url]. Pass a built copy's address
// to check the build a phone would run, at a phone's density.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs = require("fs"), path = require("path"), os = require("os");
const out = process.argv[2] || OUT;
const APP = process.argv[3] || BASE;
let failed = 0;
const check = (n, ok, x = "") => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };

(async () => {
  const b = await chromium.launch({ executablePath, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const c = await b.newContext({ viewport: { width: 998, height: 448 }, hasTouch: true, isMobile: true, deviceScaleFactor: Number(process.env.DPR || 1) });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${APP}?debug`, { waitUntil: "networkidle" });
  await p.tap("button.start");
  await p.waitForSelector("button.start", { state: "detached", timeout: 20000 });
  const cdp = await c.newCDPSession(p);

  // A point on the circle, in its own polar units, as a screen position.
  const polar = (r, deg) => p.evaluate(([r, deg]) => {
    const svg = document.querySelector('[data-slot="circle"] svg') || document.querySelector("svg[aria-label='Circle of fifths']");
    const a = (deg * Math.PI) / 180;
    const pt = new DOMPoint(r * Math.sin(a), -r * Math.cos(a)).matrixTransform(svg.getScreenCTM());
    return { x: pt.x, y: pt.y };
  }, [r, deg]);
  const S = () => p.evaluate(() => {
    const s = window.__almagest.core.state.get();
    const v = window.__almagest.core.views.circle.get();
    const name = (r) => (r ? `${r.ring}-${r.col}` : null);
    return { now: name(s.current?.ref), sounding: !!s.sounding, fingers: s.fingers.length, trail: v.trail.map(name), stars: v.next.map((n) => name(n.ref)).join(","), readout: window.__almagest.core.views.readout.get().name };
  });
  const touch = (type, pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pt ? [{ ...pt, id: 1 }] : [] });
  /** Moves the finger in small steps, as a real one does. */
  async function glide(from, to, steps = 8) {
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
      await p.waitForTimeout(12);
    }
    await p.waitForTimeout(50); // Chrome hands moves over at the next frame, so let the last one land
  }
  const clear = async () => { await touch("touchEnd"); await p.waitForTimeout(1300); };
  const lit = () => p.evaluate(() => {
    const ring = document.querySelector("[data-leads]");
    return ring ? ring.getAttribute("data-leads") : null;
  });
  const C = await polar(176, 0), G = await polar(176, 30), Am = await polar(118, 0), E = await polar(176, 120);

  await touch("touchStart", C);
  await p.waitForTimeout(300);
  check("at 300 ms, nothing is lit yet", (await lit()) === null);
  await p.waitForTimeout(250);
  check("at 550 ms, G7 is lit as leading to C", (await lit()) === "G7", String(await lit()));
  check("G's cell is named G7 while it's lit", await p.locator('[data-chord="G"]').count() === 1 &&
    (await p.evaluate(() => [...document.querySelectorAll("text")].some((t) => t.textContent === "G7"))));
  check("the words LEADS HERE show", await p.evaluate(() => [...document.querySelectorAll("text")].some((t) => t.textContent === "LEADS HERE")));
  await p.screenshot({ path: path.join(out, "long-lit.png") });
  await p.emulateMedia({});
  await p.addStyleTag({ content: "html { filter: grayscale(1) }" });
  await p.screenshot({ path: path.join(out, "long-lit-gray.png") });
  await p.evaluate(() => document.querySelectorAll("style").forEach((s) => s.textContent.includes("grayscale(1)") && s.remove()));
  await glide(C, G);
  let s = await S();
  check("sliding onto G plays G7", s.readout === "G7", s.readout);
  await touch("touchEnd");
  await p.waitForTimeout(60);
  s = await S();
  check("lifting keeps G7, and the mark goes", s.readout === "G7" && s.sounding && (await lit()) === null);
  await p.waitForTimeout(1300);

  await touch("touchStart", Am);
  await p.waitForTimeout(550);
  check("holding Am lights E7, four columns round, not the next one", (await lit()) === "E7", String(await lit()));
  await glide(Am, E, 10);
  s = await S();
  check("sliding onto E plays E7", s.readout === "E7", s.readout);
  await clear();

  await touch("touchStart", C);
  await p.waitForTimeout(250);
  await glide(C, G);
  s = await S();
  check("without the long press, the same slide plays plain G", s.readout === "G", s.readout);
  await clear();

  check("no page errors", errs.length === 0, errs.join("|"));
  await b.close();
  console.log(failed ? failed + " failed" : "all passed");
})().catch((e) => { console.error(e); process.exit(1); });
