// Exercise the public controls on a landscape phone-sized viewport against a running build.
const assert = require("node:assert/strict");
const { chromium, executablePath, BASE } = require("./browser.cjs");

async function run() {
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 840, height: 393 }, hasTouch: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.getByRole("button", { name: "Tap to start" }).tap();
    const guide = page.getByRole("button", { name: "Progressions", exact: true });
    const trace = async (id) => {
      await guide.tap();
      await page.locator(`.picker [data-shape="${id}"]`).tap();
    };
    await trace("andalusian");
    await page.getByText("Start at ① · Am", { exact: true }).waitFor();
    for (const chord of ["Am", "G", "F", "E"]) {
      await page.locator(`[data-chord="${chord}"]`).press("Space");
    }
    await page.locator("[data-slot=ribbon]").getByText("ANDALUSIAN", { exact: true }).waitFor();
    await page.locator('[data-progress="done"]').waitFor();
    // Change straight to another from the caption, step off it, then put it away.
    await page.getByRole("button", { name: "Change progression" }).tap();
    await page.locator('.picker [data-shape="axis"]').tap();
    await page.locator('[data-chord="C"]').tap();
    await page.locator('[data-progress="1"]').waitFor();
    await page.locator('[data-chord="D"]').tap();
    await page.locator('[data-progress="off"]').waitFor();
    await page.getByRole("button", { name: "Put the shape away" }).press("Enter");
    await guide.waitFor();

    // Sustain holds the display while the player compares suggestions between collections.
    await page.getByLabel("Sustain").press("Space");
    await page.locator('[data-chord="C"]').tap();
    const odds = page.locator("[data-slot=controls] .row");
    await odds.first().waitFor();
    const modern = await odds.allTextContents();
    // The collection is a Menu setting; the chord keeps sounding while it's open.
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.locator("[data-slot=menu]").getByRole("button", { name: "Jazz", exact: true }).tap();
    await page.locator("[data-slot=menu]").getByRole("button", { name: "Done", exact: true }).tap();
    await page.locator('.likely[data-preset="jazz"]').waitFor();
    assert.notDeepEqual(await odds.allTextContents(), modern);
    const pad = (name) => page.locator(".pads").getByRole("button", { name, exact: true });
    const chord = (name) => page.locator(`[data-chord="${name}"]`);
    await chord("Am").tap();
    await pad("Major").tap();
    await chord("C").tap();
    assert.equal(await pad("Major").getAttribute("aria-pressed"), "true");
    await pad("Major").press("Enter");
    assert.equal(await pad("Major").getAttribute("aria-pressed"), "false");
    await chord("Am").tap();
    await page.locator(".readout .chord").filter({ hasText: /^Am$/ }).waitFor();
    await pad("9").press("Space");
    await pad("add9").tap();
    assert.equal(await pad("9").getAttribute("aria-pressed"), "false");
    assert.equal(await pad("add9").getAttribute("aria-pressed"), "true");
    await pad("add9").tap();

    await trace("two-five-one");
    await chord("Dm").tap();
    await pad("7").getByText("this chord").waitFor();
    assert.equal(await pad("7").getAttribute("aria-pressed"), "false");
    const auto = page.getByRole("button", { name: "Auto 7ths" });
    await page.getByRole("button", { name: "Put the shape away" }).press("Enter");
    await auto.press("Enter");
    await chord("C").tap();
    await page.locator(".readout .chord").filter({ hasText: /^Cmaj7$/ }).waitFor();
    await chord("Dm").tap();
    await page.locator(".readout .chord").filter({ hasText: /^Dm7$/ }).waitFor();
    await chord("G").tap();
    await page.locator(".readout .chord").filter({ hasText: /^G7$/ }).waitFor();
    assert.equal(await auto.getAttribute("aria-pressed"), "true");
    await auto.tap();
    assert.deepEqual(errors, []);
    console.log("Passed guided cadence, keyboard playing, touch, changing progression, stepping off the path and corpus switching.");
  } finally {
    await browser.close();
  }
}
run().catch((err) => { console.error(err); process.exitCode = 1; });
