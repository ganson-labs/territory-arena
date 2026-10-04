import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const base=readFileSync('bot/bot.js','utf8'),team=readFileSync('bot/team.json','utf8');
const configs=[
 ['bolder', [['?110:45','?65:20']]],
 ['careful', [['?110:45','?160:80']]],
 ['raid', [['p.stolen*.7','p.stolen*2.0']]],
 ['defend', [['Math.min(900,enemyD)*.55','-Math.abs(enemyD-200)*.55']]],
 ['wide', [['[55,85,120,165,220,285,370]','[55,70,100,140,190,250,320,410]'],['[10,22,38,55]','[12,28,45,65]']]],
 ['orient', [['[0,-8,8]','[0,-8,8,-14,14]']]],
 ['big', [['(p.duration+24)','(p.duration+65)']]],
 ['small', [['(p.duration+24)','(p.duration+5)']]],
 ['balanced', [['?110:45','?90:30'],['p.stolen*.7','p.stolen*1.3'],['Math.min(900,enemyD)*.55','-Math.abs(enemyD-300)*.35']]],
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
