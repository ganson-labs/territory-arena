import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import bot from '../bot/bot.js';
import {createRound,botView,stepRound,sanitizeTurn} from '../arena/engine.js';
// Each opponent starts with a fresh worker/module, as in a new arena match.
if(process.argv.length===2){
  for(const group of ['hunter','farmer','longloop','mirror']){
    const run=spawnSync(process.execPath,[process.argv[1],group],{encoding:'utf8'});
    process.stdout.write(run.stdout);process.stderr.write(run.stderr);
    if(run.status)process.exit(run.status);
  }
  process.exit(0);
}
let mismatches=0,calls=0,max=0,sum=0,slow=0;
const groups=process.argv.length>2?process.argv.slice(2):['hunter','farmer','longloop','mirror'];
for(const group of groups){
 for(let n=1;n<=6;n++){
  const rep=JSON.parse(readFileSync('sandbox/final/'+group+'/round-'+n+'.json','utf8'));
  const r=createRound({mapIndex:rep.mapIndex,players:rep.players}),side=(n-1)%2;
  bot.init({round:n-1,side,mapName:r.map.name,view:botView(r,side)});
  while(!r.over){
    const state=botView(r,side),t=performance.now(),answer=bot.tick(state),elapsed=performance.now()-t;
    calls++;sum+=elapsed;max=Math.max(max,elapsed);if(elapsed>(r.tick<40?250:50)){slow++;console.log('Slow tick',group,n,r.tick,elapsed);}
    const turn=sanitizeTurn(answer,r.players[side].heading),wanted=rep.moves[side][r.tick];
    if(turn!==wanted){mismatches++;if(mismatches<4)console.log('Mismatch',group,n,r.tick,turn,wanted);}
    stepRound(r,rep.moves.map(a=>({turn:a[r.tick]/1000})));
  }
 }
 console.log(group+': all 6 replays verified');
}
console.log(JSON.stringify({calls,mismatches,meanMs:sum/calls,maxMs:max,budgetViolations:slow}));
if(mismatches||slow)process.exitCode=1;
