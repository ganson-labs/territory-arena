import {readFileSync,writeFileSync} from 'node:fs';
import bot,{debug} from '../sandbox/round-2-analysis/debug/bot.js';
import {createRound,stepRound,botView,sanitizeTurn} from '../arena/engine.js';
const rep=JSON.parse(readFileSync('rounds/round-2.json','utf8'));
const r=createRound({mapIndex:rep.mapIndex,players:rep.players});
const begin=+(process.argv[2]||0),end=+(process.argv[3]||120);
bot.init({});let samples=[],mismatches=0;
while(!r.over){
 const s=botView(r,0),answer=bot.tick(s),mem=debug(),p=mem.plan;
 if(sanitizeTurn(answer,s.me.heading)!==rep.moves[0][r.tick])mismatches++;
 const nearest=s.enemy.trail.reduce((d,q)=>Math.min(d,Math.hypot(q.x-s.me.x,q.y-s.me.y)),Infinity);
 const threat=s.me.trail.reduce((d,q)=>Math.min(d,Math.hypot(q.x-s.enemy.x,q.y-s.enemy.y)),Infinity);
 if(r.tick%10===0&&r.tick/20>=begin&&r.tick/20<=end){
  const row={t:r.tick/20,me:[s.me.x|0,s.me.y|0,s.me.heading|0],enemy:[s.enemy.x|0,s.enemy.y|0,s.enemy.heading|0],home:s.me.home,
   trails:[s.me.trailCells,s.enemy.trailCells],nearest:Math.round(nearest),threat:Math.round(threat),land:[+s.me.percent.toFixed(1),+s.enemy.percent.toFixed(1)],forecast:mem.forecast?{ticks:mem.forecast.duration,lost:mem.forecast.lost}:null,
   plan:p?{total:p.duration,left:p.actions.length-p.pos,attack:p.attack||false,approach:p.approach||false,escape:p.escape||false,sweep:p.sweep||false,margin:Math.round(p.margin)}:null};
  samples.push(row);console.log(JSON.stringify(row));
 }
 const paths=r.players.map(p=>p.trail.slice());
 const ev=stepRound(r,rep.moves.map(a=>({turn:a[r.tick]/1000})));
 for(const e of ev)if(r.tick/20>=begin&&r.tick/20<=end){
  if(e.type==='capture')console.log('EVENT',r.tick/20,e.side,'capture',JSON.stringify({count:e.count,stolen:e.stolen,trail:e.trailLength,path:e.count>900?paths[e.side].filter((_,k)=>k%12===0).map(p=>[p.x|0,p.y|0]):undefined}));
  if(e.type==='death')console.log('EVENT',r.tick/20,JSON.stringify(e));
 }
}
console.log('mismatches',mismatches);
writeFileSync('sandbox/round-2-analysis/positions.json',JSON.stringify(samples,null,2));
writeFileSync('tools/stress/sonet-round2/turns.js','export default '+JSON.stringify(rep.moves[1])+';\n');
