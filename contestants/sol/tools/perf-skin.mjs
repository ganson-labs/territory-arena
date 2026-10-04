import {createCanvas} from '@napi-rs/canvas';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import skin from '../bot/skin.js';
const team=JSON.parse(readFileSync('bot/team.json','utf8'));
for(const mode of ['intro','victory','arena']){
 const f={...team,mode,t:1,dt:1/60,width:mode==='intro'?1680:mode==='victory'?2304:3840,height:mode==='intro'?1720:mode==='victory'?1296:2400,unit:2.4,
 land:[new Float32Array([10,10,3000,10,3200,1700,1800,2250,10,2250])],base:{x:576,y:576,r:144},
 trail:new Float32Array([3000,1400,3300,1500,3400,1700,3300,1900]),
 head:{x:3300,y:1900,heading:150,alive:true,home:false,respawnIn:0},events:[],percent:47};
 const c=createCanvas(f.width,f.height).getContext('2d'),samples=[];
 for(let i=0;i<60;i++){const t=performance.now();c.clearRect(0,0,f.width,f.height);skin.draw(c,{...f,t:i/60});samples.push(performance.now()-t);}
 samples.sort((a,b)=>a-b);console.log(mode,'4K mean',(samples.reduce((a,b)=>a+b)/samples.length).toFixed(2),'p95',samples[57].toFixed(2),'max',samples.at(-1).toFixed(2));
}
