// ГЕЛИОФАГ: exact edge-connected raster planning and continuous-curvature flights.
const R = Math.PI / 180, C = 160, N = 16000;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const diff = (a,b) => ((a-b+540)%360+360)%360-180;
const angle = (x,y,tx,ty) => Math.atan2(ty-y,tx-x)/R;
const index = (x,y) => (y/10|0)*C+(x/10|0);
const stamp = new Int32Array(N), seen = new Int32Array(N), queue = new Int32Array(N);
let serial=0, floodSerial=0, mem;
export const debug=()=>mem;
function reset(){mem={plan:null,cells:112,deaths:0,next:0};}
function clearance(s){
  const d=new Int16Array(N).fill(-1);let first=0,last=0;
  for(let i=0;i<N;i++)if(s.land[i]!==1){d[i]=0;queue[last++]=i;}
  while(first<last){
    const i=queue[first++],cx=i%C;
    const add=j=>{if(d[j]===-1){d[j]=d[i]+1;queue[last++]=j;}};
    if(cx)add(i-1);if(cx<159)add(i+1);if(i>=160)add(i-160);if(i<N-160)add(i+160);
  }
  return d;
}
function sweep(x,y,nx,ny,visit){
  let cx=Math.floor(x/10),cy=Math.floor(y/10);
  for(let k=1;k<=4;k++){
    const ax=Math.floor((x+(nx-x)*k/4)/10),ay=Math.floor((y+(ny-y)*k/4)/10);
    if(ax===cx&&ay===cy)continue;
    if(ax!==cx&&ay!==cy&&!visit(cy*C+ax))return false;
    if(!visit(ay*C+ax))return false;
    cx=ax;cy=ay;
  }
  return true;
}
function simulate(s,policy,limit=260,attack=false){
  const tag=++serial,m=s.me,laid=new Map(),fresh=new Map(),actions=[],points=[],cells=[];
  let x=m.x,y=m.y,h=m.heading,outside=m.trailCells>0,cut=false;
  for(let k=Math.max(1,m.trail.length-6);k<m.trail.length;k++){
    const a=m.trail[k-1],b=m.trail[k];
    sweep(a.x,a.y,b.x,b.y,i=>{fresh.set(i,k-m.trail.length);return true;});
  }
  for(let t=0;t<limit;t++){
    const q=Math.round(clamp(policy(t,x,y,h),-1,1)*1000)/1000;
    h+=q*12;
    const nx=x+10*Math.cos(h*R),ny=y+10*Math.sin(h*R);
    if(nx<8||ny<8||nx>1592||ny>992)return null;
    if(!sweep(x,y,nx,ny,i=>{
      if(s.trail[i]===1&&t-(fresh.get(i)??-1000)>4)return false;
      if(laid.has(i)&&t-laid.get(i)>4)return false;
      if(s.trail[i]===2)cut=true;
      if(s.land[i]!==1&&!laid.has(i)){laid.set(i,t);stamp[i]=tag;cells.push(i);outside=true;}
      return true;
    }))return null;
    x=nx;y=ny;actions.push(q);points.push({x,y,h});
    if(attack&&cut)return{actions,points,cut,duration:t+1,gain:0,margin:Infinity};
    if(outside&&s.land[index(x,y)]===1){
      const ftag=++floodSerial;let first=0,last=0;
      const push=i=>{
        if(seen[i]===ftag||s.land[i]===1||stamp[i]===tag||s.trail[i]===1)return;
        seen[i]=ftag;queue[last++]=i;
      };
      for(let i=0;i<C;i++){push(i);push(N-C+i);}
      for(let i=0;i<100;i++){push(i*C);push(i*C+C-1);}
      while(first<last){
        const i=queue[first++],cx=i%C;
        if(cx)push(i-1);if(cx<C-1)push(i+1);
        if(i>=C)push(i-C);if(i<N-C)push(i+C);
      }
      let gain=0,stolen=0,margin=Infinity;
      for(let i=0;i<N;i++)if(seen[i]!==ftag&&s.land[i]!==1){
        const dx=(i%C+.5)*10-s.enemy.base.x,dy=((i/C|0)+.5)*10-s.enemy.base.y;
        if(dx*dx+dy*dy<=3600)continue;
        gain++;if(s.land[i]===2)stolen++;
      }
      {
        const delay=s.enemy.alive?0:s.enemy.respawnIn*10;
        for(let k=0;k<cells.length;k+=3){
          const i=cells[k],d=Math.hypot((i%C+.5)*10-(s.enemy.alive?s.enemy.x:s.enemy.base.x),((i/C|0)+.5)*10-(s.enemy.alive?s.enemy.y:s.enemy.base.y))+delay;
          margin=Math.min(margin,Math.max(d,laid.get(i)*10)-(t+1)*10);
        }
        for(let k=0;k<m.trail.length;k+=3){const p=m.trail[k];margin=Math.min(margin,Math.hypot(p.x-(s.enemy.alive?s.enemy.x:s.enemy.base.x),p.y-(s.enemy.alive?s.enemy.y:s.enemy.base.y))+delay-(t+1)*10);}
      }
      return{actions,points,duration:t+1,gain,stolen,margin,cut};
    }
  }
  return null;
}
function score(s,p,ret=false){
  if(!p)return-Infinity;
  if(ret)return-p.duration+p.gain*.008+Math.min(0,p.margin)*.06;
  if(p.duration*.05>s.timeLeft-.12)return-Infinity;
  const reserve=s.me.cells>1600&&s.me.cells>s.enemy.cells?110:45;
  if(p.margin<reserve)return-Infinity;
  const risk=p.margin<50?Math.exp((p.margin-50)/150):1;
  return(p.gain+p.stolen*.7)/(p.duration+24)*risk-.002*p.duration;
}
function expansion(s){
  let best=null,value=.1;
  const accept=p=>{const v=score(s,p);if(v>value){value=v;best=p;}};
  for(const prefix of[0,-8,8])for(const sign of[-1,1])for(const radius of[55,85,120,165,220,285,370]){
    const count=Math.round(2*Math.PI*radius/10),q=sign*30/count,half=Math.round(count/2);
    for(const straight of[0,16,36]){
      const pre=Math.abs(prefix);
      const p=simulate(s,t=>t<pre?Math.sign(prefix):(t-=pre)<straight?0:t<straight+half?q:t<2*straight+half?0:q,count+2*straight+pre+12);
      accept(p);
    }
  }
  for(const sign of[-1,1])for(const a of[10,22,38,55])for(const b of[10,22,38]){
    const runs=[a,8,b,8,a,8,b,8],ends=[];let total=0;
    for(const n of runs){total+=n;ends.push(total);}
    accept(simulate(s,t=>{let k=0;while(t>=ends[k]&&k<7)k++;return k%2?sign*.9375:0;},total+4));
  }
  return best;
}
function homeTargets(s){
  const bins=Array(16).fill(null),m=s.me;
  for(let i=0;i<N;i+=2)if(s.land[i]===1){
    const x=(i%C+.5)*10,y=((i/C|0)+.5)*10,d=Math.hypot(x-m.x,y-m.y);
    const b=((Math.atan2(y-m.y,x-m.x)+Math.PI)/(Math.PI*2)*16|0)%16;
    if(!bins[b]||d<bins[b].d)bins[b]={x,y,d};
  }
  return[...bins.filter(Boolean),{x:m.base.x,y:m.base.y}];
}
function returnHome(s){
  let best=null,value=-Infinity;
  const accept=p=>{const v=score(s,p,true);if(v>value){value=v;best=p;}};
  for(const p of homeTargets(s))for(const initial of[0,-1,1]){
    accept(simulate(s,(t,x,y,h)=>t<(initial?8:0)?initial:diff(angle(x,y,p.x,p.y),h)/12,210));
  }
  for(const q of[-1,-.65,-.4,-.2,.2,.4,.65,1])accept(simulate(s,()=>q,200));
  return best;
}
function hunt(s){
  const m=s.me,e=s.enemy;if(!e.alive||e.trail.length<8)return null;
  let homeD=Infinity;
  const dist=new Int16Array(N).fill(-1),start=index(e.x,e.y),recent=new Set(e.trail.slice(-4).map(p=>index(p.x,p.y)));
  let first=0,last=0;queue[last++]=start;dist[start]=0;
  while(first<last){
    const i=queue[first++],cx=i%C;
    if(s.land[i]===2){homeD=dist[i]*8;break;}
    const neighbors=[];if(cx)neighbors.push(i-1);if(cx<159)neighbors.push(i+1);if(i>=160)neighbors.push(i-160);if(i<N-160)neighbors.push(i+160);
    for(const j of neighbors)if(dist[j]===-1&&(s.trail[j]!==2||recent.has(j))){dist[j]=dist[i]+1;queue[last++]=j;}
  }
  const targets=e.trail.slice(0,-5).filter((_,i)=>i%5===0).map(p=>({...p,d:Math.hypot(p.x-m.x,p.y-m.y)})).sort((a,b)=>a.d-b.d).slice(0,5);
  let best=null;
  for(const target of targets){
    if(target.d>420||target.d>homeD-15)continue;
    const p=simulate(s,(t,x,y,h)=>diff(angle(x,y,target.x,target.y),h)/12,Math.min(70,Math.floor((homeD-15)/10)),true);
    if(p?.cut&&(!best||p.duration<best.duration))best=p;
  }
  return best;
}
function steer(s,wanted,homeOnly=false){
  let best=1,bestScore=-Infinity;
  for(const q of[wanted,-1,-.65,-.3,0,.3,.65,1]){
    let x=s.me.x,y=s.me.y,h=s.me.heading,safety=0,room=0;
    const visited=new Map(),recent=new Set(s.me.trail.slice(-4).map(p=>index(p.x,p.y)));
    for(let k=0;k<22;k++){
      h+=q*12;const nx=x+10*Math.cos(h*R),ny=y+10*Math.sin(h*R);
      if(nx<7||ny<7||nx>1593||ny>993)break;
      if(homeOnly&&s.land[index(nx,ny)]!==1)break;
      if(!sweep(x,y,nx,ny,i=>{
        if(s.trail[i]===1&&!recent.has(i))return false;
        if(visited.has(i)&&k-visited.get(i)>4)return false;
        if(s.land[i]!==1&&!visited.has(i))visited.set(i,k);
        return true;
      }))break;
      x=nx;y=ny;safety++;
      if(homeOnly)room+=Math.min(12,mem.clearance[index(x,y)]);
      if(s.enemy.alive&&Math.hypot(x-s.enemy.x,y-s.enemy.y)<32&&s.land[index(x,y)]!==1)break;
    }
    const v=safety*100+(homeOnly?room*1.8:0)-Math.abs(q-wanted)*15;if(v>bestScore){bestScore=v;best=q;}
  }
  return best;
}
function relocate(s){
  const m=s.me;let target=null,best=-Infinity;
  for(let i=0;i<N;i+=3)if(s.land[i]===1){
    const cx=i%C,cy=i/C|0;if(cx<8||cx>151||cy<8||cy>91)continue;
    if(mem.clearance[i]<(m.cells>700?6:2)||mem.clearance[i]>15)continue;
    const x=(cx+.5)*10,y=(cy+.5)*10,d=Math.hypot(x-m.x,y-m.y);if(d<70)continue;
    const enemyD=s.enemy.alive?Math.hypot(x-s.enemy.x,y-s.enemy.y):1000;
    let space=0;
    for(const [dx,dy] of[[0,-1],[0,1],[-1,0],[1,0]])for(const step of[8,16,24]){
      const xx=cx+dx*step,yy=cy+dy*step;
      if(xx>5&&xx<154&&yy>5&&yy<94&&s.land[yy*C+xx]!==1)space+=step;
    }
    const v=-Math.abs(enemyD-200)*.55+space*1.3-d*.25-Math.abs(diff(angle(m.x,m.y,x,y),m.heading))*.4;
    if(v>best){best=v;target={x,y};}
  }
  return target?diff(angle(m.x,m.y,target.x,target.y),m.heading)/12:.35;
}
export default{
  init(){reset();},
  tick(s){
    if(!mem||s.tick===0)reset();const m=s.me;
    if(!m.alive){mem.plan=null;mem.deaths=m.deaths;return{turn:0};}
    if(m.cells!==mem.cells||m.deaths!==mem.deaths){mem.plan=null;mem.cells=m.cells;mem.deaths=m.deaths;mem.clearance=clearance(s);}
    if(!mem.clearance||s.tick%20===0)mem.clearance=clearance(s);
    let p=mem.plan;
    if(s.tick%6===0&&s.enemy.trailCells&&m.cells<s.enemy.cells+2400){
      const attack=hunt(s);if(attack&&(m.home||attack.duration<16)){p=attack;p.pos=0;p.attack=true;mem.plan=p;}
    }
    if(p&&p.pos>=p.actions.length){mem.plan=null;p=null;}
    if(p&&m.trailCells&&s.tick%4===0&&!p.attack){
      let threat=Infinity;for(const q of m.trail)threat=Math.min(threat,Math.hypot(q.x-(s.enemy.alive?s.enemy.x:s.enemy.base.x),q.y-(s.enemy.alive?s.enemy.y:s.enemy.base.y))+(s.enemy.alive?0:s.enemy.respawnIn*10));
      if(threat<(p.actions.length-p.pos)*10+90||s.timeLeft<(p.actions.length-p.pos)*.05+.2){
        const ret=returnHome(s);if(ret&&ret.duration+3<p.actions.length-p.pos){p=ret;p.pos=0;mem.plan=p;}
      }
    }
    if(!p&&s.tick>=mem.next){
      p=m.trailCells?returnHome(s):expansion(s);
      if(p){p.pos=0;mem.plan=p;}else mem.next=s.tick+6;
    }
    if(p){
      const wanted=p.actions[p.pos++];
      if(s.enemy.alive&&Math.hypot(m.x-s.enemy.x,m.y-s.enemy.y)<65&&!m.home){
        const safe=steer(s,wanted);if(safe!==wanted){mem.plan=null;return{turn:safe};}
      }
      return{turn:wanted};
    }
    return{turn:steer(s,clamp(relocate(s),-1,1),m.home)};
  }
};
