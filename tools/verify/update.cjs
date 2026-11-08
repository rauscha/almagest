// Each launch takes up the newest version, and airplane mode still opens at once.
// Serves two copies of dist/ from localhost (a secure context), switching from the old to the new between
// launches, in a fresh profile: node tools/verify/update.cjs (run `npm run build` first).
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
let failed = 0;
const check = (n, ok, x = "") => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };

// Two versions of the same build. The new one differs in index.html, and so in the precache list.
const dist = path.join(__dirname, "../../dist");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "almagest-update-"));
const copy = (name, mark) => {
  const to = path.join(work, name);
  fs.cpSync(dist, to, { recursive: true });
  const html = path.join(to, "index.html");
  fs.writeFileSync(html, fs.readFileSync(html, "utf8").replace("<head>", `<head><meta name="almagest-version" content="${mark}">`));
  const sw = path.join(to, "sw.js");
  fs.writeFileSync(sw, fs.readFileSync(sw, "utf8").replace(/(url:"index\.html",revision:")[0-9a-f]+/, `$1${mark}`));
  return to;
};
const roots = { old: copy("old", "old"), new: copy("new", "new") };
let serving = "old";
let slowSw = 0; // ms to hold back sw.js, so a tap can land before a new version has downloaded
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
// Served the way `tailscale serve` does it: /index.html redirects to /./, and files carry Last-Modified
// with no Cache-Control.
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/index.html") { res.writeHead(301, { location: "/./" + u.search }); return res.end(); }
  let file = path.join(roots[serving], decodeURIComponent(u.pathname));
  if (file.endsWith("/")) file += "index.html";
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  if (slowSw && u.pathname === "/sw.js") return setTimeout(() => send(file, res), slowSw);
  send(file, res);
});
function send(file, res) {
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "last-modified": fs.statSync(file).mtime.toUTCString() });
  fs.createReadStream(file).pipe(res);
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://localhost:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "almagest-update-profile-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath, args: ["--no-sandbox"], viewport: { width: 998, height: 448 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  // When asked, taps the start button the instant the page tells a new version to take over.
  await page.addInitScript(() => {
    if (!localStorage.getItem("tapOnSwap")) return;
    const post = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (msg, ...rest) {
      post.call(this, msg, ...rest);
      if (msg?.type === "SKIP_WAITING") { localStorage.removeItem("tapOnSwap"); document.querySelector("button.start")?.click(); }
    };
  });
  const version = () => page.evaluate(() => document.querySelector('meta[name="almagest-version"]')?.content);
  const launch = async () => {
    const t = Date.now();
    await page.goto(url);
    await page.waitForSelector("button.start", { timeout: 15000 });
    return Date.now() - t;
  };

  // First visit saves the copy; the second runs under it.
  await launch();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The Chrome tab it was installed from, left open: while it lives, Chrome won't switch versions by
  // itself, so only the app's own updater can. Common on a phone, and the case that leaves it stuck.
  const tab = await ctx.newPage();
  await tab.goto(url);
  await launch();
  check("the old version opens, running from the saved copy", (await version()) === "old" && (await page.evaluate(() => !!navigator.serviceWorker.controller)));

  // A new version is published. The very next launch should end up on it, not the one after.
  serving = "new";
  await launch();
  await page.waitForFunction(() => document.querySelector('meta[name="almagest-version"]')?.content === "new", null, { timeout: 15000 }).catch(() => {});
  check("the next launch swaps to the new version by itself", (await version()) === "new", await version());
  await page.waitForSelector("button.start", { timeout: 15000 });

  // A quick tap can't outrun it. Publish, launch and tap (it downloads meanwhile), then launch again
  // with the tap landing the instant the swap begins, as a quick thumb does on the phone: it must end on
  // the new version, not start the old one.
  serving = "old";
  slowSw = 1500;
  await launch();
  await page.click("button.start");
  check("(setup) the tap landed before the new version downloaded", (await version()) === "new");
  await page.waitForTimeout(4000);
  slowSw = 0;
  await page.evaluate(() => localStorage.setItem("tapOnSwap", "1"));
  await launch().catch(() => {});
  await page.waitForFunction(() => document.querySelector('meta[name="almagest-version"]')?.content === "old", null, { timeout: 8000 }).catch(() => {});
  check("tapping at once on the next launch still lands on the new version", (await version()) === "old", await version());
  await page.evaluate(() => localStorage.removeItem("tapOnSwap"));
  serving = "new";
  await launch();
  await page.click("button.start");
  await page.waitForTimeout(3000);

  // Once playing, a newer version waits rather than reloading the page.
  serving = "old"; // stands in for a third version: it differs from what's running
  await launch();
  await page.click("button.start");
  await page.waitForSelector("button.start", { state: "detached", timeout: 20000 }).catch(() => {});
  const playing = await version();
  serving = playing === "old" ? "new" : "old"; // a newer version is published mid-play
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update())).catch(() => {});
  await page.waitForTimeout(3000);
  check("after the tap, an update never reloads the page", (await version()) === playing && !(await page.$("button.start")), `${playing}`);

  // Airplane mode: it opens at once from the copy, with no hang waiting for the server.
  await ctx.setOffline(true);
  const ms = await launch();
  check("offline, it opens from the saved copy", !!(await version()), await version());
  check("offline, it opens without waiting on the network (< 3 s)", ms < 3000, `${ms} ms`);
  await page.waitForTimeout(2000);
  check("offline, nothing reloads or breaks after opening", !!(await page.$("button.start")));

  await ctx.close();
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(failed ? failed + " failed" : "all passed");
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
