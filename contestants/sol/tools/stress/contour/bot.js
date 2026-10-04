import {farm,homePath,follow,safeSteer,threat,angleTo} from '../../../arena/sparring/common.js';
let st,opening;
export default {
 init(){st={points:[],loops:0};opening=true;},
 tick(s){
  const m=s.me;if(!m.alive){st.points=[];opening=true;return{turn:0};}
  if(opening){
   const flip=m.base.x>800,canonical=p=>flip?{x:1600-p.x,y:1000-p.y}:p;
   const b=canonical(m.base);
   st.points=[{x:b.x+45,y:915},{x:25,y:915},{x:25,y:25},{x:Math.min(800,b.x+315),y:25},{x:Math.min(800,b.x+315),y:b.y+50},{x:b.x,y:b.y}].map(canonical);
   opening=false;
  }
  const home=m.trailCells?homePath(s):null;
  if(home&&threat(s)<home.length*10+160)st.points=[];
  while(st.points.length&&Math.hypot(st.points[0].x-m.x,st.points[0].y-m.y)<40)st.points.shift();
  if(st.points.length)return safeSteer(s,{heading:angleTo(m,st.points[0].x,st.points[0].y)});
  if(home)return safeSteer(s,follow(s,home,5));
  return farm(s,st,n=>450+(n%3)*110,160);
 }
};
