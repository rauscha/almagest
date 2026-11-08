// MIDI out in a real browser, against a stand-in for Chrome's Web MIDI: connecting, what's sent on a chord
// change, silencing the app's own sound, and what happens when the device goes away.
const { chromium, executablePath, BASE } = require("./browser.cjs");
let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

(async () => {
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 998, height: 448 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__sent = [];
    window.__port = { id: "synth", name: "Synth", state: "connected", send: (b) => window.__sent.push([...b]) };
    window.__access = { outputs: new Map([["synth", window.__port]]), inputs: new Map(), onstatechange: null };
    Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => window.__access });
  });
  await page.goto(BASE + "?debug", { waitUntil: "networkidle" });
  await page.click("button.start");
  await page.waitForSelector("button.start", { state: "detached", timeout: 20000 });

  const midi = () => page.evaluate(() => window.__almagest.core.views.menu.get().midi);
  const sounding = () => page.evaluate(() => window.__almagest.core.state.get().sounding);
  const sent = () => page.evaluate(() => window.__sent.splice(0));
  const level = () => page.evaluate(async () => {
    const { meter } = window.__almagest;
    const buf = new Float32Array(meter.fftSize);
    let peak = 0;
    const end = performance.now() + 300;
    while (performance.now() < end) {
      meter.getFloatTimeDomainData(buf);
      for (const x of buf) peak = Math.max(peak, Math.abs(x));
      await new Promise((r) => setTimeout(r, 30));
    }
    return peak;
  });
  const tap = async (name, hold = 60) => {
    const b = await page.locator(`[data-chord="${name}"]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.waitForTimeout(hold); await page.mouse.up();
  };
  const ons = (m) => m.filter(([s]) => (s & 0xf0) === 0x90);
  const offs = (m) => m.filter(([s]) => (s & 0xf0) === 0x80);

  await page.click("button:text-is('Menu')");
  check("offers to connect", (await midi()).device === "Connect", JSON.stringify(await midi()));
  await tap("Am");
  check("sends nothing before it's connected", (await sent()).length === 0);
  await page.waitForTimeout(1200);

  await page.click(".midi-device");
  await page.waitForFunction(() => window.__almagest.core.views.menu.get().midi.on);
  check("connects, and names the device", (await midi()).device === "Synth", JSON.stringify(await midi()));

  await tap("Am");
  const before = await sounding();
  let m = await sent();
  check("a chord strikes all five notes on channel 1", ons(m).length === 5 && m.every(([s]) => (s & 0x0f) === 0), JSON.stringify(m));
  await tap("Dm");
  const after = await sounding();
  m = await sent();
  const moved = after.filter((n, i) => n !== before[i]).length;
  check("the next chord sends only what moved", ons(m).length === moved && offs(m).length === moved, `moved ${moved}, ${JSON.stringify(m)}`);
  const kept = after.filter((n, i) => n === before[i]);
  check("a shared note sends nothing", kept.length > 0 && kept.every((n) => !m.some(([, note]) => note === n)), `kept ${kept}`);

  await page.waitForTimeout(1300);
  m = await sent();
  check("the ring ending lets every note go", offs(m).length === 5, JSON.stringify(m));

  await page.click(".midi-channel");
  check("the channel steps", (await midi()).channel === 2);
  await tap("C");
  m = await sent();
  check("notes go out on the new channel", ons(m).length === 5 && m.every(([s]) => (s & 0x0f) === 1), JSON.stringify(m));
  await page.waitForTimeout(1300);
  await sent();

  await page.click(".midi-sound");
  await page.waitForTimeout(2500); // the room's tail of the chord before has to die away first
  const b = await page.locator('[data-chord="F"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const silent = await level();
  check("with Sound off the app is silent", silent < 0.002, `peak ${silent}`);
  check("and the notes still go out", ons(await sent()).length === 5);
  await page.mouse.up();
  await page.waitForTimeout(1300);
  await sent();

  await page.click(".midi-off");
  check("turning MIDI off brings the app's sound back", (await midi()).ownSound === true && (await midi()).on === false);
  await tap("G");
  check("and sends nothing", (await sent()).length === 0);
  await page.waitForTimeout(1200);

  await page.click(".midi-device");
  await page.waitForFunction(() => window.__almagest.core.views.menu.get().midi.on);
  await tap("A", 300);
  await sent();
  await page.evaluate(() => window.__almagest.core.silence());
  check("leaving the app lets every note go", offs(await sent()).length === 5);

  await page.click(".midi-sound");
  await page.evaluate(() => { window.__port.state = "disconnected"; window.__access.onstatechange(); });
  await page.waitForFunction(() => !window.__almagest.core.views.menu.get().midi.on);
  const gone = await midi();
  check("unplugging says so, and brings the app's sound back", gone.device === "No device" && gone.ownSound === true, JSON.stringify(gone));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
