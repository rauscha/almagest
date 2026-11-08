// Draws the app icon in the panel language, thin lines with one cell filled, and renders the PNGs a
// manifest needs. Everything sits inside the middle 80%, the part of a maskable icon that's always shown.
const { chromium, executablePath, BASE, OUT } = require("./verify/browser.cjs");
const fs = require("fs"), path = require("path"), os = require("os");

const pol = (r, deg) => { const a = (deg * Math.PI) / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };
const xy = ([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`;
const R = { hub: 62, mid: 118, rim: 186 };
const cell = (i, o, half) =>
  `M${xy(pol(i, -half))}A${i} ${i} 0 0 1 ${xy(pol(i, half))}L${xy(pol(o, half))}A${o} ${o} 0 0 0 ${xy(pol(o, -half))}Z`;
const spokes = [...Array(12).keys()]
  .map((c) => { const [a, b] = [pol(R.hub, c * 30 + 15), pol(R.rim, c * 30 + 15)]; return `<line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}"/>`; })
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-256 -256 512 512">
<rect x="-256" y="-256" width="512" height="512" fill="#0B0C0D"/>
<path d="${cell(R.mid, R.rim, 15)}" fill="#F3F3EF"/>
<g fill="none" stroke="#A3A7AA" stroke-width="7">
<circle r="${R.rim}"/><circle r="${R.mid}"/><circle r="${R.hub}"/>${spokes}
</g>
</svg>
`;
const pub = path.resolve(__dirname, "../public");
fs.writeFileSync(path.join(pub, "icon.svg"), svg);

(async () => {
  const b = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  for (const size of [192, 512]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<!doctype html><style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await p.screenshot({ path: path.join(pub, `icon-${size}.png`) });
    await p.close();
  }
  await b.close();
})();
