// Runs the spectral survey on the sounds that are knob settings of their own, and merges the rows
// into tools/survey/results.json, replacing any of the same engine and name. The rest is left alone.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs = require("fs"), path = require("path"), os = require("os");
const RESULTS = path.resolve(__dirname, "../survey/results.json");
(async () => {
  const b = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const p = await b.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
  await p.goto(BASE + "tools/survey/", { waitUntil: "networkidle" });
  const rows = await p.evaluate(() => window.__surveyPresets());
  const old = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
  const kept = old.filter((r) => !rows.some((n) => n.engine === r.engine && n.name === r.name));
  fs.writeFileSync(RESULTS, JSON.stringify([...kept, ...rows], null, 1));
  const f = (v) => v.toFixed(2);
  console.log("tier    name          harm  root worst chord holds cents");
  for (const r of rows) {
    const s = r.summary;
    console.log(`${r.tier.padEnd(7)} ${r.name.padEnd(13)} ${f(s.harmonicity)} ${f(s.rootShare)} ${f(s.worstRootShare)} ${f(s.chord)} ${f(s.holds)} ${s.tuningCents.toFixed(0).padStart(4)}  ${r.why.join("; ")}`);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
