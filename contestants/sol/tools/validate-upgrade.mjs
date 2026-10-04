import {readFileSync,readdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import bot from '../bot/bot.js';
import {createRound,botView,stepRound,sanitizeTurn} from '../arena/engine.js';
const groups=['hunter','farmer','contour','recorded','mirror'];
if(process.argv.length===2){
 for(const group of groups){
  const run=spawnSync(process.execPath,[process.argv[1],group],{encoding:'utf8'});
  process.stdout.write(run.stdout);process.stderr.write(run.stderr);
  if(run.status)process.exit(run.status);
 }
 process.exit(0);
}
const group=process.argv[2],root='sandbox/after-round-1/'+group;
const files=readdirSync(root).filter(p=>/^round-\d+\.json$/.test(p)).sort();
let calls=0,mismatches=0,slow=0,total=0,max=0;
for(const file of files){
 const n=+file.match(/\d+/)[0],side=(n-1)%2,rep=JSON.parse(readFileSync(root+'/'+file,'utf8'));
 const r=createRound({mapIndex:rep.mapIndex,players:rep.players});
 bot.init({round:n-1,side,mapName:r.map.name,view:botView(r,side)});
 while(!r.over){
  const state=botView(r,side),begin=performance.now(),answer=bot.tick(state),ms=performance.now()-begin;
  calls++;total+=ms;max=Math.max(max,ms);if(ms>(r.tick<40?250:50))slow++;
  if(sanitizeTurn(answer,r.players[side].heading)!==rep.moves[side][r.tick])mismatches++;
  stepRound(r,rep.moves.map(p=>({turn:p[r.tick]/1000})));
 }
}
console.log(group,JSON.stringify({rounds:files.length,calls,mismatches,slow,meanMs:total/calls,maxMs:max}));
if(mismatches||slow)process.exitCode=1;
