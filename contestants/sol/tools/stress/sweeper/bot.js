// A live stress opponent: full-height flank opening, broad sweeps, and cuts.
// This is a behavioral model; it does not contain the tournament bot's code.
import {farm,homePath,follow,safeSteer,threat,angleTo,path} from '../../../arena/sparring/common.js';
let st,opening;
export default {
 init(){st={points:[],loops:0};opening=true;},
 tick(s){
  const m=s.me,e=s.enemy;if(!m.alive){st.points=[];opening=true;return{turn:0};}
  if(opening){
   const flip=m.base.x>800,transform=p=>flip?{x:1600-p.x,y:1000-p.y}:p,b=transform(m.base);
   st.points=[{x:b.x+80,y:780},{x:25,y:810},{x:30,y:25},{x:b.x+90,y:45},{x:b.x,y:b.y}].map(transform);opening=false;
  }
  if(e.alive&&e.trail.length>5){
   let target=null,best=Infinity;
   for(const p of e.trail.slice(0,-4)){const d=Math.hypot(p.x-m.x,p.y-m.y);if(d<best){best=d;target=p;}}
   if(best<550){const home=path(s,e.x,e.y,i=>s.land[i]===2,i=>s.trail[i]===2);
    if(target&&best<(home?home.length*10:1000)+40){st.points=[];return safeSteer(s,{heading:angleTo(m,target.x,target.y)});}
   }
  }
  const home=m.trailCells?homePath(s):null;
  if(home&&threat(s)<home.length*10+100)st.points=[];
  while(st.points.length&&Math.hypot(st.points[0].x-m.x,st.points[0].y-m.y)<35)st.points.shift();
  if(st.points.length)return safeSteer(s,{heading:angleTo(m,st.points[0].x,st.points[0].y)});
  if(home)return safeSteer(s,follow(s,home,5));
  return farm(s,st,n=>560+(n%3)*100,100);
 }
};
