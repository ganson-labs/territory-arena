import {createCanvas} from '@napi-rs/canvas';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import skin from '../bot/skin.js';
const team=JSON.parse(readFileSync('bot/team.json','utf8'));
mkdirSync('art-preview',{recursive:true});
const rect=(x,y,w,h)=>new Float32Array([x,y,x+w,y,x+w,y+h,x,y+h]);
const arena={...team,mode:'arena',t:15,dt:1/60,width:1600,height:1000,unit:1,
  land:[new Float32Array([90,200,240,120,480,170,650,300,620,520,470,670,250,620,90,410])],
  base:{x:240,y:280,r:60},trail:new Float32Array([560,380,640,375,710,400,770,465,790,555,770,630,710,650]),
  head:{x:710,y:650,heading:168,speed:200,alive:true,respawnIn:0,home:false},
  percent:25.4,enemyPercent:18.6,timeLeft:72,
  enemy:{head:{x:1250,y:700,heading:180,alive:true},color:'#ee5555'},events:[]};
for(const mode of ['intro','victory','arena']){
  const f=mode==='arena'?arena:{...team,mode,t:2.4,dt:1/60,width:mode==='intro'?840:1152,height:mode==='intro'?860:648,percent:53.7};
  const canvas=createCanvas(f.width,f.height),c=canvas.getContext('2d');
  if(mode==='arena'){c.fillStyle='#10151f';c.fillRect(0,0,f.width,f.height);}
  skin.draw(c,f);writeFileSync('art-preview/'+mode+'.png',canvas.toBuffer('image/png'));
}
for(const type of ['capture','kill','death','respawn']){
  const canvas=createCanvas(1600,1000),c=canvas.getContext('2d');
  const f={...arena,t:30,events:[{type,x:740,y:470,percent:3.8,area:[rect(650,380,180,180)]}]};
  skin.draw(c,f);c.clearRect(0,0,1600,1000);c.fillStyle='#10151f';c.fillRect(0,0,1600,1000);
  skin.draw(c,{...f,t:30.4,events:[],head:{...f.head,alive:type!=='death'}});
  writeFileSync('art-preview/'+type+'.png',canvas.toBuffer('image/png'));
}
for(const mode of ['intro','victory','arena']){
  const f=mode==='arena'?arena:{...team,mode,t:2,dt:1/60,width:mode==='intro'?840:1152,height:mode==='intro'?860:648};
  const c=createCanvas(f.width,f.height).getContext('2d'),samples=[];
  for(let i=0;i<120;i++){
    const begin=performance.now();c.clearRect(0,0,f.width,f.height);skin.draw(c,{...f,t:2+i/60});samples.push(performance.now()-begin);
  }
  samples.sort((a,b)=>a-b);
  console.log(mode, 'mean', (samples.reduce((a,b)=>a+b)/samples.length).toFixed(2),'ms','p95',samples[114].toFixed(2),'max',samples.at(-1).toFixed(2));
}
