import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRound,stepRound,botView} from '../arena/engine.js';
const rep=JSON.parse(readFileSync('rounds/round-1.json','utf8'));
console.log('Replay keys',Object.keys(rep));
const r=createRound({mapIndex:rep.mapIndex,players:rep.players});
let trail=[],samples=[];
while(!r.over){
 const v=botView(r,1),e=v.enemy,m=v.me;
 if(r.tick%40===0&&r.tick<1440){
  const nearest=e.trail.reduce((d,p)=>Math.min(d,Math.hypot(p.x-m.x,p.y-m.y)),Infinity);
  samples.push({t:r.tick/20,me:[m.x|0,m.y|0,m.heading|0],enemy:[e.x|0,e.y|0,e.heading|0],trail:e.trailCells,d:nearest|0,land:[m.percent.toFixed(1),e.percent.toFixed(1)]});
 }
 const events=stepRound(r,rep.moves.map(a=>({turn:a[r.tick]/1000})));
 for(const ev of events)if(ev.type==='capture'&&ev.side===0){
  const corners=trail.filter((p,k)=>k%20===0).map(p=>[p.x|0,p.y|0]);
  console.log('CAPTURE',r.tick/20,'gain',ev.count,'stolen',ev.stolen,'trail',ev.trailLength,'path',JSON.stringify(corners));
  trail=[];
 }
 if(r.players[0].trail.length)trail=r.players[0].trail;
}
console.log('EARLY POSITIONS',JSON.stringify(samples));
mkdirSync('sandbox/round-1-analysis',{recursive:true});
writeFileSync('sandbox/round-1-analysis/positions.json',JSON.stringify(samples,null,2));
