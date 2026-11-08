// The key dial: drags from the hub with a real pointer in a real browser, and looks at what it does.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs = require("fs"), path = require("path"), os = require("os");
let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

(async () => {
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 998, height: 448 }, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.BASE || BASE + "?debug", { waitUntil: "networkidle" });
  const start = async () => { await page.click("button.start"); await page.waitForSelector("button.start", { state: "detached", timeout: 20000 }); };
  await start();
  const key = () => page.evaluate(() => window.__almagest.core.state.get().key);
  const hubName = () => page.locator(".dial-key").textContent();
  const sounding = () => page.evaluate(() => window.__almagest.core.state.get().sounding);
  const box = await page.locator("svg[aria-label='Circle of fifths']").boundingBox();
  const scale = box.width / 444;
  const at = (r, deg) => { const a = deg * Math.PI / 180; return [box.x + box.width / 2 + r * scale * Math.sin(a), box.y + box.height / 2 - r * scale * Math.cos(a)]; };
  const dial = async (col, ring) => {
    await page.mouse.move(...at(0, 0)); await page.mouse.down();
    await page.mouse.move(...at(30, col * 30), { steps: 4 });
    await page.mouse.move(...at(ring === "min" ? 120 : 178, col * 30), { steps: 6 });
    await page.mouse.up();
  };

  // A touch on the hub, without a drag, plays nothing and moves nothing.
  await page.mouse.move(...at(0, 0)); await page.mouse.down(); await page.mouse.up();
  check("a touch on the hub plays nothing", (await sounding()) === null);
  check("and moves nothing", (await hubName()) === "C", await hubName());

  // From the center, the key waits until the finger reaches a chord.
  await page.mouse.move(...at(0, 0)); await page.mouse.down();
  await page.mouse.move(...at(30, 60), { steps: 4 });
  check("from the hub, nothing changes while the finger is still in the middle", JSON.stringify(await key()) === JSON.stringify({ col: 0, mode: "major" }), JSON.stringify(await key()));
  await page.mouse.move(...at(120, 60), { steps: 6 });
  check("dragged onto a minor chord, that minor becomes the key", JSON.stringify(await key()) === JSON.stringify({ col: 2, mode: "minor" }), JSON.stringify(await key()));
  await page.mouse.move(...at(178, 60), { steps: 6 });
  await page.mouse.up();
  check("dragged on out to its major, the major becomes the key", JSON.stringify(await key()) === JSON.stringify({ col: 2, mode: "major" }), JSON.stringify(await key()));
  check("and dialing plays nothing", (await sounding()) === null);
  check("the hub names the new key", (await hubName()) === "D", await hubName());

  // A chord that's ringing keeps its notes while the key moves; its numeral follows the key.
  await dial(0, "maj");
  await page.evaluate(() => window.__almagest.core.send({ type: "ringChanged", ms: 3000 }));
  const [gx, gy] = at(176, 30);
  await page.mouse.move(gx, gy); await page.mouse.down(); await page.mouse.up();
  const before = JSON.stringify(await sounding());
  const num1 = await page.evaluate(() => window.__almagest.core.views.readout.get().numeral);
  await dial(1, "maj");
  const after = JSON.stringify(await sounding());
  const num2 = await page.evaluate(() => window.__almagest.core.views.readout.get().numeral);
  check("what's ringing keeps its notes while the key moves", before === after, after);
  check("and its numeral follows the key", num1 !== num2, `${num1} to ${num2}`);
  await page.screenshot({ path: `${OUT}/dial.png` });

  await dial(4, "min");
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: "networkidle" });
  await start();
  check("the key survives a reload", JSON.stringify(await key()) === JSON.stringify({ col: 4, mode: "minor" }), JSON.stringify(await key()));
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
})().catch((e) => { console.error(e); process.exit(1); });
