// Swipes, with real touch events (docs/GESTURES.md). In on a major is its relative minor,
// out on a minor its relative major, judged 24 units from landing, within 35 degrees of straight.
// Run against the dev server: node tools/verify/swipe.cjs [shot dir] [url]. Pass a built copy's address
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
  /** A quick swipe: land at a cell's middle, then move `dr` units along the radius in about 60 ms. */
  async function swipe(r0, deg, dr, sideways = 0) {
    const from = await polar(r0, deg);
    const to = await polar(r0 + dr, deg + sideways);
    await touch("touchStart", from);
    await p.waitForTimeout(20);
    await glide(from, to, 5);
    await p.waitForTimeout(30);
    return S();
  }
  let s = await swipe(176, 0, -30);
  check("swiping in on C plays Am", s.now === "min-0" && s.readout === "Am", JSON.stringify(s));
  check("the trail has Am in C's place", s.trail[s.trail.length - 1] === "min-0" && !s.trail.includes("maj-0"), JSON.stringify(s.trail));
  await p.screenshot({ path: path.join(out, "swipe-am.png") });
  await touch("touchEnd");
  await p.waitForTimeout(50);
  s = await S();
  check("lifting keeps Am, ringing on", s.now === "min-0" && s.sounding && s.fingers === 0);
  await p.waitForTimeout(1300);

  s = await swipe(118, 0, 30);
  check("swiping out on Am plays C", s.now === "maj-0", s.now);
  await clear();
  s = await swipe(176, 90, -30);
  check("near the right edge too: in on A plays F♯m", s.now === "min-3" && s.readout === "F♯m", `${s.now} ${s.readout}`);
  await clear();
  s = await swipe(176, 0, 26);
  check("swiping out on C plays nothing new", s.now === "maj-0", s.now);
  await clear();
  s = await swipe(176, 0, 0, 10);
  check("a sideways move on C plays nothing new", s.now === "maj-0", s.now);
  await clear();

  // Held first, the same inward move is a slide: Am plays only once the finger is in its cell.
  const C = await polar(176, 0);
  await touch("touchStart", C);
  await p.waitForTimeout(260);
  await glide(C, await polar(150, 0), 4);
  s = await S();
  check("after the hold, moving in within C's cell stays on C", s.now === "maj-0", s.now);
  await glide(await polar(150, 0), await polar(125, 0), 4);
  s = await S();
  check("and reaching Am's cell slides to Am", s.now === "min-0", s.now);
  await clear();

  check("no page errors", errs.length === 0, errs.join("|"));
  await b.close();
  console.log(failed ? failed + " failed" : "all passed");
})().catch((e) => { console.error(e); process.exit(1); });
