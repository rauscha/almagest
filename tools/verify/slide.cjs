// Sliding from a held chord onto one of its stars, with real touch events (docs/GESTURES.md).
// Run against the dev server: node tools/verify/slide.cjs [shot dir] [url]. Pass a built copy's address
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
  const C = await polar(176, 0), G = await polar(176, 30), F = await polar(176, -30), Db = await polar(176, 210);
  const clear = async () => { await touch("touchEnd"); await p.waitForTimeout(1300); };

  // Hold C, then slide onto G.
  await touch("touchStart", C);
  await p.waitForTimeout(260);
  let s0 = await S();
  check("holding C plays C and shows its stars", s0.now === "maj-0" && s0.stars.includes("maj-1"), s0.stars);
  await glide(C, G);
  let s = await S();
  check("sliding onto G plays G", s.now === "maj-1" && s.readout === "G", JSON.stringify(s));
  check("the stars stay C's while the finger is down", s.stars === s0.stars);
  await p.screenshot({ path: path.join(out, "slide-mid.png") });
  await glide(G, C);
  s = await S();
  check("sliding back onto C returns to C, trail as it was", s.now === "maj-0" && s.trail.join() === s0.trail.join(), JSON.stringify(s.trail));
  await glide(C, F);
  await glide(F, G);
  await touch("touchEnd");
  await p.waitForTimeout(50);
  s = await S();
  check("lifting on G keeps G, ringing on", s.now === "maj-1" && s.sounding && s.fingers === 0);
  check("the trail ends C then G, with F not in it", s.trail.slice(-2).join() === "maj-0,maj-1", JSON.stringify(s.trail));
  check("the stars are G's now", s.stars !== s0.stars);
  await p.screenshot({ path: path.join(out, "slide-kept.png") });
  await p.waitForTimeout(1300);

  // A quick move before the hold time plays nothing; that movement is kept for swipes.
  await touch("touchStart", C);
  await p.waitForTimeout(30);
  await glide(C, G, 4);
  await p.waitForTimeout(300);
  s = await S();
  check("a quick move from C before the hold time stays on C", s.now === "maj-0", s.now);
  await clear();

  // Wandering over a chord that isn't a star does nothing.
  await touch("touchStart", C);
  await p.waitForTimeout(260);
  s0 = await S();
  check("D♭ isn't a star of C (so the next check means something)", !s0.stars.split(",").includes("maj-7"));
  // Out past the rim, around, and in onto D♭, so the path crosses no star on the way.
  let at = C;
  for (let deg = 0; deg <= 210; deg += 10) { const next = await polar(214, deg); await glide(at, next, 2); at = next; }
  await glide(at, Db, 5);
  s = await S();
  check("the finger over D♭, and off the circle, leaves C sounding", s.now === "maj-0" && s.readout === s0.readout, `${s.readout}`);
  await clear();

  // The line between two cells doesn't flicker: 3 units into G stays on C; 12 units in is G.
  await touch("touchStart", C);
  await p.waitForTimeout(260);
  const edge = 15 + (3 * 180) / (Math.PI * 176);
  await glide(C, await polar(176, edge), 6);
  s = await S();
  check("just over the line into G, it stays on C", s.now === "maj-0", s.now);
  await glide(await polar(176, edge), await polar(176, 15 + (12 * 180) / (Math.PI * 176)), 3);
  s = await S();
  check("well inside G, it's G", s.now === "maj-1", s.now);
  await clear();

  check("no page errors", errs.length === 0, errs.join("|"));
  await b.close();
  console.log(failed ? failed + " failed" : "all passed");
})().catch((e) => { console.error(e); process.exit(1); });
