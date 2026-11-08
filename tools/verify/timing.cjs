// How long a press takes with the CPU slowed to something like a phone's, ribbon redraw included.
const { chromium, executablePath, BASE, OUT } = require("./browser.cjs");
const fs=require("fs"),path=require("path"),os=require("os");
(async()=>{const b=await chromium.launch({executablePath,args:["--no-sandbox","--autoplay-policy=no-user-gesture-required"]});
const c=await b.newContext({viewport:{width:998,height:448}});const p=await c.newPage();
await p.goto(BASE + "?debug",{waitUntil:"networkidle"});await p.click("button.start");await p.waitForSelector("button.start",{state:"detached",timeout:20000});
const cdp=await c.newCDPSession(p);await cdp.send("Emulation.setCPUThrottlingRate",{rate:6});
const r=await p.evaluate(async()=>{const core=window.__almagest.core;const send=[],draw=[];const wait=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
 for(let i=0;i<120;i++){const ref={ring:i%2?"maj":"min",col:(i*5)%12};const t0=performance.now();core.send({type:"touch",phase:"down",pointer:1,ref,r:0,theta:0,time:0});const t1=performance.now();await Promise.resolve();await new Promise(r=>queueMicrotask(r));const t2=performance.now();send.push(t1-t0);draw.push(t2-t0);await wait();core.send({type:"touch",phase:"up",pointer:1,ref:null,r:0,theta:0,time:0});await wait();}
 const q=(a,x)=>{const s=[...a].sort((u,v)=>u-v);return +s[Math.floor(s.length*x)].toFixed(2)};return {send:{med:q(send,.5),p95:q(send,.95),max:q(send,.999)},redraw:{med:q(draw,.5),p95:q(draw,.95),max:q(draw,.999)}}});
console.log("6x slowdown, ms:",JSON.stringify(r));await b.close()})().catch(e=>{console.error(e);process.exit(1)});
