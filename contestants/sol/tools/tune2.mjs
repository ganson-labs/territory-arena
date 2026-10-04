import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const base=readFileSync('bot/bot.js','utf8'),team=readFileSync('bot/team.json','utf8');
const configs=[
 ['orient-bold', [['?110:45','?80:30']]],
 ['orient-raid', [['p.stolen*.7','p.stolen*1.5']]],
 ['orient-defend', [['Math.min(900,enemyD)*.55','-Math.abs(enemyD-250)*.4']]],
 ['orient-radii', [['[55,85,120,165,220,285,370]','[55,75,105,145,195,260,340,420]']]],
 ['orient-many', [['[0,-8,8,-14,14]','[0,-5,5,-10,10,-15,15]']]],
 ['orient-short', [['p.gain*.008','p.gain*.001']]],
 ['orient-rect', [['[10,22,38,55]','[8,16,28,40,58]'],['[10,22,38]','[8,16,28,40]']]],
 ['orient-slant', [['[0,-8,8,-14,14]','[0,-7,7,-12,12]']]],
 ['orient-dense', [['[55,85,120,165,220,285,370]','[55,70,85,105,120,145,165,190,220,250,285,325,370]']]],
];
mkdirSync('tools/tuning',{recursive:true});
for(const [name,replacements] of configs){
  const path='tools/tuning/'+name;mkdirSync(path,{recursive:true});
  let source=base;for(const [a,b] of replacements)source=source.replaceAll(a,b);
  writeFileSync(path+'/bot.js',source);writeFileSync(path+'/team.json',team);
  let wins=0,loss=0,deaths=0,kills=0,margin=0;
  for(const vs of['raider','farmer']){
    const p=spawnSync(process.execPath,['arena/cli.mjs',path,'--vs',vs],{encoding:'utf8'});
    if(p.status){console.log(name,'ERROR',p.stderr);break;}
    const score=p.stdout.match(/Итог: (\d+) побед, (\d+) поражений/);wins+=+score[1];loss+=+score[2];
    const stats=p.stdout.match(/Средняя территория: ты ([\d.]+)%, соперник ([\d.]+)%\. Срезал (\d+), погиб (\d+)/);
    margin+=+stats[1]-+stats[2];kills+=+stats[3];deaths+=+stats[4];
    console.log(name,vs,score[1]+'W',stats[1]+' vs '+stats[2],'deaths '+stats[4]);
  }
  console.log('TOTAL',name,wins+'W',loss+'L','diff '+(margin/2).toFixed(1),'kills '+kills,'deaths '+deaths);
}

