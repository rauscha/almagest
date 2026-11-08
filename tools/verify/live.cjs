// Real-time, not offline: the real app with a real AudioContext over the tailnet BASE.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs=require("fs"),path=require("path"),os=require("os");
let failed=0;const check=(n,ok,x="")=>{if(!ok)failed++;console.log(`${ok?"pass":"FAIL"}  ${n}${x?"  "+x:""}`)};
(async()=>{const b=await chromium.launch({executablePath,args:["--no-sandbox","--autoplay-policy=no-user-gesture-required"]});
const c=await b.newContext({viewport:{width:998,height:448}});const p=await c.newPage();const errs=[];p.on("pageerror",e=>errs.push(e.message));
await p.goto(BASE + "?debug",{waitUntil:"networkidle"});await p.click("button.start");await p.waitForSelector("button.start",{state:"detached",timeout:20000});await p.click('button:text-is("Menu")');
const press=async(ch)=>{const el=await p.$(`[data-chord="${ch}"]`);const bb=await el.boundingBox();await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);await p.mouse.down();};
const peak=()=>p.evaluate(()=>{const a=window.__almagest.meter;const d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);let m=0;for(const v of d)m=Math.max(m,Math.abs(v));return m});
// Every spread and both engines, moving through a progression with slides: audible, unclipped, and the state agrees.
for(const engine of ["Multi-model","Pad synth"]){await p.click(`button:text-is("${engine}")`);await p.waitForTimeout(2500);
 for(const spread of ["Close","Open","Wide"]){await p.click(`[data-stop="${spread.toLowerCase()}"]`);let top=0,low=9;
  for(const ch of ["C","Am","F","G","C"]){await press(ch);for(let i=0;i<5;i++){await p.waitForTimeout(30);const v=await peak();top=Math.max(top,v);if(i==4)low=Math.min(low,v)}await p.mouse.up();}
  await p.waitForTimeout(50);check(`${engine} ${spread}: sounds through the progression`,low>0.005,`quietest ${low.toFixed(3)}`);check(`${engine} ${spread}: doesn't clip`,top<0.98,`peak ${top.toFixed(3)}`);await p.waitForTimeout(1200);}
 await p.click('[data-stop="close"]');}
// Real-time slide: one voice's slide should really move through intermediate pitches on the live clock.
const track=await p.evaluate(async()=>{
  const {ctx}=window.__almagest;
  const mod=await import("/src/voices/engines.ts");
  const v=mod.makeEngine("multi");await v.init(ctx);
  const an=ctx.createAnalyser();an.fftSize=2048;v.output.connect(an);
  v.setParameter("model",8);
  const d=new Float32Array(2048);
  const pitch=()=>{an.getFloatTimeDomainData(d);let best=0,lag=-1,e0=0;for(let i=0;i<1024;i++)e0+=d[i]*d[i];if(e0<1e-5)return null;
    const ncc=new Float32Array(600);for(let l=40;l<600;l++){let n=0,e1=0;for(let i=0;i<1024;i++){n+=d[i]*d[i+l];e1+=d[i+l]*d[i+l]}ncc[l]=n/Math.sqrt(e0*e1+1e-12);if(ncc[l]>best)best=ncc[l]}
    for(let l=41;l<599;l++){if(ncc[l]>=best*.93&&ncc[l]>=ncc[l-1]&&ncc[l]>=ncc[l+1]){lag=l;break}}
    return lag>0?69+12*Math.log2(ctx.sampleRate/lag/440):null};
  const out=[];const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const sample=async(ms,tag)=>{const t0=performance.now();while(performance.now()-t0<ms){out.push([tag,Math.round(performance.now()),pitch()]);await sleep(15)}};
  v.noteOn(60);await sample(350,"held");
  v.glide(60,67,0.3);await sample(450,"slide");
  v.glide(60,55,0.3);await sample(120,"interrupt");
  v.glide(60,72,0.1);await sample(350,"second");
  v.noteOn(48);await sample(350,"strike");
  v.noteOff(48);await v.dispose?.();return out});
const seg=t=>track.filter(r=>r[0]===t&&r[2]!==null).map(r=>r[2]);const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[s.length>>1]};
const last=(a,n=4)=>med(a.slice(-n));
check("live: holds the note",Math.abs(med(seg("held").slice(5))-60)<0.3,med(seg("held").slice(5)).toFixed(2));
const sl=seg("slide");check("live: slide lands",Math.abs(last(sl)-67)<0.3,last(sl).toFixed(2));
const between=sl.filter(m=>m>60.7&&m<66.3).length;check("live: slide passes through the notes between",between>=3,`${between} readings between`);
check("live: a second slide lands",Math.abs(last(seg("second"))-72)<0.3,last(seg("second")).toFixed(2));
check("live: a strike afterwards has no bend",Math.abs(last(seg("strike"))-48)<0.3,last(seg("strike")).toFixed(2));
// Settings
await p.click('[data-stop="wide"]');await p.click('button:text-is("300")').catch(()=>{});await p.click('button:text-is("Re-strike")');await p.waitForTimeout(300);
await p.reload({waitUntil:"networkidle"});await p.click("button.start");await p.waitForSelector("button.start",{state:"detached",timeout:20000});await p.click('button:text-is("Menu")');await p.waitForTimeout(100);
const s=await p.evaluate(()=>{const b=[...document.querySelectorAll("button.on")].map(x=>x.textContent);b.push(document.querySelector("[data-spread-now]").dataset.spreadNow);return b});
check("voicing and slide survive a reload",s.includes("wide")&&s.includes("Re-strike"),s.join(", "));
check("no page errors",errs.length===0,errs.join("|"));await b.close();console.log(failed?failed+" failed":"all passed")})().catch(e=>{console.error(e);process.exit(1)});
