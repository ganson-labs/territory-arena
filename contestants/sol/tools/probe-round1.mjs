import {readFileSync} from 'node:fs';
import bot,{debug} from '../sandbox/round-1-analysis/debug/bot.js';
import {createRound,stepRound,botView} from '../arena/engine.js';
const rep=JSON.parse(readFileSync('sandbox/round-1-analysis/sweep-safe/round-2.json','utf8')),r=createRound({mapIndex:rep.mapIndex,players:rep.players});
bot.init({});
while(!r.over&&r.tick<450){
 const s=botView(r,1),answer=bot.tick(s),mem=debug(),p=mem.plan;
 if(r.tick>=140&&r.tick%10===0)console.log(r.tick/20,JSON.stringify({
  me:[s.me.x|0,s.me.y|0,s.me.heading|0],home:s.me.home,trail:s.me.trailCells,
  enemy:[s.enemy.x|0,s.enemy.y|0,s.enemy.heading|0,s.enemy.alive,s.enemy.respawnIn],
  plan:p?{size:p.duration,remaining:p.actions.length-p.pos,attack:p.attack,approach:p.approach,margin:p.margin}:null
 }));
 const ev=stepRound(r,rep.moves.map(a=>({turn:a[r.tick]/1000})));
 for(const e of ev)if(['death','capture','respawn'].includes(e.type))console.log('EVENT',r.tick/20,e.type,e.side,e.cause,e.count,e.trailLength);
}
