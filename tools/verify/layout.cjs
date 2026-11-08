// Layout in a real browser, in every look: nothing wraps onto a second line, the Menu fits its slot
// with every engine, choices share their lines (no gaps between boxes), a pad's label stays put when
// its chord name appears, and the voicing slider works by touch and by drag.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs = require("fs"), path = require("path"), os = require("os");
const APP = BASE + "?debug";
let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

// Every button and caption whose text runs past one line or past its box.
// Only elements holding text alone, so a pad's label and its chord name count as two lines of their own.
const broken = () => [...document.querySelectorAll(".stage button, .stage .cap, .stage button span, .stage .cap span")].filter((el) => {
  if (!el.offsetParent || el.children.length || !el.textContent.trim()) return false;
  const range = document.createRange(); range.selectNodeContents(el);
  const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
  return tops.size > 1 || el.scrollWidth > el.clientWidth + 1;
}).map((el) => el.getAttribute("aria-label") || el.textContent.trim());

(async () => {
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 998, height: 448 }, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.click("button.start");
  await page.waitForSelector("button.start", { state: "detached", timeout: 20000 });
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const tap = async (sel) => { const [x, y] = await center(sel); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); };

  // One look: the star atlas.
  const looks = 1;
  for (let look = 0; look < looks; look++) {
    const lookName = "Star atlas";
    await page.waitForTimeout(300);
    check(`${lookName}: nothing wraps or overflows on the main screen`, (await page.evaluate(broken)).length === 0, (await page.evaluate(broken)).join(" | "));

    // Pads: nine cells touching, edge to edge.
    const gaps = await page.evaluate(() => {
      const cells = [...document.querySelectorAll(".pads .pad")].map((p) => p.getBoundingClientRect());
      return Math.max(Math.abs(cells[1].left - cells[0].right), Math.abs(cells[3].top - cells[0].bottom));
    });
    check(`${lookName}: pads share their lines, no gaps`, gaps < 0.5, `gap ${gaps.toFixed(2)} px`);

    // The label doesn't move when its chord name appears. Only the text pads have chord names.
    if (await page.locator(".pad .chord").count()) {
      const label = '.pad:has(:is(.label, .ring):text-is("maj7")) .label';
      const before = await page.locator(label).boundingBox();
      await tap('[data-chord="G"]');
      await page.waitForTimeout(250);
      const after = await page.locator(label).boundingBox();
      const shown = await page.locator('.pad:has(:is(.label, .ring):text-is("maj7")) .chord').evaluate((e) => [e.textContent, getComputedStyle(e).opacity]);
      check(`${lookName}: maj7's label stays put while Gmaj7 fades in`, Math.abs(before.y - after.y) < 0.5 && Math.abs(before.x - after.x) < 0.5 && shown[0].startsWith("Gmaj7") && shown[1] === "1",
        `moved ${(after.y - before.y).toFixed(1)} px, "${shown[0]}" at opacity ${shown[1]}`);
      await page.screenshot({ path: `${OUT}/layout_${look}_pads.png` });
    }

    // The Menu, with every engine: fits, and nothing wraps.
    await page.click('button:text-is("Menu")');
    for (const engine of ["Multi-model", "Pad synth"]) {
      await page.click(`.menu button:text-is("${engine}")`);
      await page.waitForTimeout(engine === "Multi-model" ? 300 : 1500);
      const fit = await page.evaluate(() => {
        const m = document.querySelector("[data-slot=menu] .menu").getBoundingClientRect();
        const lowest = Math.max(...[...document.querySelectorAll("[data-slot=menu] .menu > *")].map((c) => c.getBoundingClientRect().bottom));
        return m.bottom - 1 - lowest;
      });
      check(`${lookName}, ${engine}: the Menu fits its slot`, fit >= 0, `${fit.toFixed(1)} px to spare`);
      check(`${lookName}, ${engine}: nothing in the Menu wraps`, (await page.evaluate(broken)).length === 0, (await page.evaluate(broken)).join(" | "));
      if (look === 0) await page.screenshot({ path: `${OUT}/layout_menu_${engine.replace(/\W+/g, "_")}.png` });
    }
    await page.click('.menu button:text-is("Multi-model")');
    await page.click('button:text-is("Done")');


  }

  // The slider: a tap picks the nearest stop, a drag walks through them.
  const spread = () => page.evaluate(() => window.__almagest.core.views.controls.get().spread);
  await tap('[data-stop="wide"]');
  check("slider: a tap on Wide picks wide", (await spread()) === "wide", await spread());
  const [cx, cy] = await center('[data-stop="close"]');
  const [wx] = await center('[data-stop="wide"]');
  await page.mouse.move(wx, cy); await page.mouse.down();
  const seen = [];
  for (let x = wx; x >= cx - 10; x -= 8) { await page.mouse.move(x, cy + 6); seen.push(await spread()); }
  await page.mouse.up();
  check("slider: a drag from wide to close passes open", seen.includes("open") && seen.at(-1) === "close", [...new Set(seen)].join(" → "));
  await tap('[data-stop="open"]');

  // Re-strike and slide times are one row now.
  await page.click('button:text-is("Menu")');
  await page.click('.menu button:text-is("Re-strike")');
  check("menu: Re-strike turns slide off", !(await page.evaluate(() => window.__almagest.core.views.menu.get().slide)));
  await page.click('.menu button:text-is("80")');
  const m = await page.evaluate(() => window.__almagest.core.views.menu.get());
  check("menu: a slide time turns slide back on, at that time", m.slide && m.slideMs === 80, `slide ${m.slide}, ${m.slideMs} ms`);
  await page.click('.menu button:text-is("150")');
  await page.click('button:text-is("Done")');

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
