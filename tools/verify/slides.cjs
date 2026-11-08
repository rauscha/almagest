// Measures slides and strikes through the real engines (tools/slides/), faster than real time, and saves
// tools/slides/results.json. Needs the dev server.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs=require("fs"),path=require("path"),os=require("os");
(async()=>{const b=await chromium.launch({executablePath,args:["--no-sandbox"]});const p=await b.newPage();
p.on("pageerror",e=>console.log("PAGEERROR",e.message.slice(0,300)));p.on("console",m=>{if(m.type()==="error")console.log("ERR",m.text().slice(0,200))});
await p.goto(BASE + "tools/slides/",{waitUntil:"networkidle"});
const t0=Date.now();const r=await p.evaluate(()=>window.__slides());console.log(`rendered in ${Math.round((Date.now()-t0)/1000)} s`);
fs.writeFileSync(path.resolve(__dirname, "../slides/results.json"),JSON.stringify(r,null,1));
for(const c of r.checks)console.log(`${c.pass?"pass":"FAIL"} ${c.engine.padEnd(5)} ${c.name.padEnd(48)} ${c.detail}`);
const f=(v)=>v===null?"  --":v.toFixed(2).padStart(5);
console.log("\nsound                         sl.jump sl.dip  st.jump st.dip  landed¢ lvl@1.2s");
for(const s of r.sounds)console.log(`${s.engine.padEnd(5)} ${s.name.padEnd(24).slice(0,24)} ${f(s.slideJump)}  ${f(s.slideDip)}   ${f(s.strikeJump)}  ${f(s.strikeDip)}  ${s.landedCents===null?"  --":s.landedCents.toFixed(0).padStart(5)}  ${f(s.level1s)}`);
await b.close();if(r.checks.some(c=>!c.pass))process.exitCode=1})().catch(e=>{console.error(e);process.exit(1)});
