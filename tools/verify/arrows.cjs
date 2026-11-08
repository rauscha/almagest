// Holds chords with a real pointer in a real browser, and photographs the arrows.
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
  // The likely next chords are stars on the circle, stepped by rank, and rows in the left column.
  const stars = () => page.locator(".star.next[data-rank]").count();
  const rows = () => page.locator("[data-rank]:not(circle)").count();
  const at = async (name) => { const b = await page.locator(`[data-chord="${name}"]`).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const tap = async (name) => { await page.mouse.move(...await at(name)); await page.mouse.down(); await page.mouse.up(); };
  const menu = async (label) => { await page.click('button:text-is("Menu")'); await page.click(`.menu button:text-is("${label}")`); await page.click('button:text-is("Done")'); };

  await tap("G");
  check("a tap shows V's three next chords at once", (await stars()) === 3, `${await stars()}`);
  check("and the left column lists the same three", (await rows()) === 3, `${await rows()}`);
  const radii = await page.locator(".star.next[data-rank]").evaluateAll((els) => els.map((e) => [+e.dataset.rank, +e.getAttribute("r")]).sort((a, b) => a[0] - b[0]).map((x) => x[1]));
  check("stepped by rank: 1 largest, 3 smallest", radii[0] > radii[1] && radii[1] > radii[2], radii.join(" > "));
  await page.waitForTimeout(300);
  check("they stay while the chord rings on", (await stars()) === 3);
  await page.screenshot({ path: `${OUT}/stars_V.png` });
  await page.waitForTimeout(1600);
  check("and go when the sound ends", (await stars()) === 0);
  for (const c of ["C", "Dm", "Am", "D"]) { await tap(c); await page.screenshot({ path: `${OUT}/stars_${c}.png` }); }
  await menu("Jazz");
  await tap("Dm");
  check("Jazz, chosen in the Menu, still shows stars", (await stars()) > 0);
  await page.screenshot({ path: `${OUT}/stars_ii_jazz.png` });
  await menu("Off");
  await tap("C");
  check("Off shows none", (await stars()) === 0);
  await menu("Modern");
  check("no page errors", errors.length === 0, errors.join(" | "));

  // What a press costs, with the next chords worked out on every press now.
  const t = await page.evaluate(() => {
    const { core } = window.__almagest;
    const refs = [{ ring: "maj", col: 0 }, { ring: "min", col: 11 }, { ring: "maj", col: 1 }, { ring: "min", col: 0 }];
    const start = performance.now();
    for (let i = 0; i < 400; i++) {
      core.send({ type: "touch", phase: "down", pointer: 5, ref: refs[i % 4], r: 0, theta: 0, time: 0 });
      core.send({ type: "touch", phase: "up", pointer: 5, ref: null, r: 0, theta: 0, time: 0 });
    }
    return (performance.now() - start) / 400;
  });
  check("a press and lift together stay under 2 ms here", t < 2, `${t.toFixed(3)} ms`);
  await browser.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
})().catch((e) => { console.error(e); process.exit(1); });
