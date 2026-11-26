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
    const guide = page.getByLabel("Trace a progression");
    await guide.selectOption("andalusian");
    await page.getByText("Start at ① · Am", { exact: true }).waitFor();
    for (const chord of ["Am", "G", "F", "E"]) {
      await page.locator(`[data-chord="${chord}"]`).press("Space");
    }
    await page.locator("[data-slot=ribbon]").getByText("ANDALUSIAN", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Put the shape away" }).press("Enter");
    await guide.waitFor();

    // Sustain holds the display while the player compares suggestions between collections.
    await page.getByLabel("Sustain").press("Space");
    await page.locator('[data-chord="C"]').tap();
    const odds = page.locator("[data-slot=controls] .row");
    await odds.first().waitFor();
    const modern = await odds.allTextContents();
    await page.getByLabel("NEXT CHORD IN").selectOption("jazz");
    assert.notDeepEqual(await odds.allTextContents(), modern);
    await page.getByLabel("About next-chord odds").tap();
    await page.getByText("Where the stars come from").waitFor();
    await page.getByRole("button", { name: "Back to playing" }).tap();
    assert.deepEqual(errors, []);
    console.log("Passed guided cadence, keyboard playing, touch, corpus switching and odds help.");
  } finally {
    await browser.close();
  }
}
run().catch((err) => { console.error(err); process.exitCode = 1; });
