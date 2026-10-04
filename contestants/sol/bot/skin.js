// All art is native Canvas: the Solar Raven, its eclipse foundry and living gold.
const TAU=Math.PI*2, INK='#090f19', CYAN='#77e7ea', GOLD='#ffb52e', CREAM='#fff1c9';
let effects=[],lastMode='',lastT=0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function poly(c,p,fill,stroke,width=1){
  c.beginPath();c.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1]);c.closePath();
  if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
}
function circle(c,x,y,r,fill,stroke,w=1){
  c.beginPath();c.arc(x,y,Math.max(.01,r),0,TAU);
  if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=w;c.stroke();}
}
function line(c,p,color,width=1){
  c.beginPath();c.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1]);
  c.strokeStyle=color;c.lineWidth=width;c.stroke();
}
function star(c,x,y,r,color,rotation=0){
  c.save();c.translate(x,y);c.rotate(rotation);
  poly(c,[0,-r,r*.2,-r*.2,r,0,r*.2,r*.2,0,r,-r*.2,r*.2,-r,0,-r*.2,-r*.2],color);c.restore();
}
function feather(c,x,y,size,a,color=GOLD){
  c.save();c.translate(x,y);c.rotate(a);
  poly(c,[-size,0,size*.3,-size*.26,size,0,size*.3,size*.26],color);
  line(c,[-size*.5,0,size*.65,0],CREAM,Math.max(.6,size*.04));c.restore();
}
function contours(c,rings){
  c.beginPath();
  for(const r of rings){if(r.length<6)continue;c.moveTo(r[0],r[1]);for(let i=2;i<r.length;i+=2)c.lineTo(r[i],r[i+1]);c.closePath();}
}
function eclipse(c,x,y,r,t,alpha=1){
  c.save();c.globalAlpha*=alpha;c.translate(x,y);
  const g=c.createRadialGradient(0,0,r*.5,0,0,r*1.3);
  g.addColorStop(0,'rgba(255,181,46,0)');g.addColorStop(.63,'rgba(255,161,20,.2)');g.addColorStop(.78,'rgba(255,190,66,.08)');g.addColorStop(1,'rgba(255,181,46,0)');
  circle(c,0,0,r*1.3,g);
  circle(c,0,0,r*.91,INK,GOLD,Math.max(1,r*.025));
  c.save();c.rotate(t*.15);c.strokeStyle=CREAM;c.lineWidth=r*.009;
  for(let i=0;i<12;i++){const a=i*TAU/12;c.beginPath();c.arc(0,0,r*1.02,a,a+.32);c.stroke();}
  for(let i=0;i<24;i++){
    const a=i*TAU/24,rr=r*(i%3?1.1:1.15);
    line(c,[Math.cos(a)*r*1.05,Math.sin(a)*r*1.05,Math.cos(a)*rr,Math.sin(a)*rr],i%3?GOLD:CREAM,r*.008);
  }c.restore();
  // A bright corona is lopsided, so the eclipse has an immediately recognizable eye.
  c.strokeStyle=CREAM;c.lineWidth=r*.035;c.beginPath();c.arc(0,0,r*.92,-.72,.18);c.stroke();
  star(c,r*.9,-r*.22,r*.12,CREAM,t*.12);c.restore();
}
function raven(c,x,y,scale,heading,t,spread=1){
  c.save();c.translate(x,y);c.rotate(heading);c.scale(scale,scale);
  const flap=Math.sin(t*10)*4*spread;
  // Two articulated wings: dark metal bones and seven blades of sunlight.
  for(const sign of[-1,1]){
    c.save();c.scale(1,sign);
    poly(c,[8,5,-3,17,-21,32+flap,-50,47+flap,-38,23,-18,8], '#131c28',GOLD,1.2);
    for(let i=0;i<7;i++){
      const yy=11+i*4.9*spread,xx=-9-i*4.6;
      poly(c,[xx+14,yy-4,xx-8,yy+7+flap,xx-25,yy+15+flap,xx-12,yy-2],
        i%2?'#b87617':GOLD,INK,1.4);
      line(c,[xx+8,yy-1,xx-19,yy+10+flap],i%2?GOLD:CREAM,.7);
    }
    poly(c,[3,9,-12,18,-27,23,-14,7],'#1e2a39',GOLD,1);
    circle(c,-11,14,2.5,CYAN);c.restore();
  }
  // Three split tail vanes, with a ceramic white tip.
  poly(c,[-15,-8,-47,-14,-37,0,-50,15,-14,10],INK,GOLD,1.1);
  poly(c,[-26,-5,-49,-11,-39,-2],GOLD);
  poly(c,[-27,6,-50,14,-38,6],CREAM);
  circle(c,0,0,18.5,INK,GOLD,2);
  circle(c,1,0,13,'#17212e','#81541a',1);
  c.save();c.rotate(-t*.9);c.strokeStyle=CREAM;c.lineWidth=1.6;c.beginPath();c.arc(1,0,15,-.7,1.7);c.stroke();c.restore();
  poly(c,[-9,-3,5,-13,19,-11,26,-4,19,6,6,13,-9,7],'#101722',GOLD,1.2);
  poly(c,[20,-10,34,-1,22,3,27,-2],CREAM);
  poly(c,[7,-15,17,-22,16,-11],GOLD);
  poly(c,[9,-6,20,-5,16,-1,8,-2],CYAN);
  line(c,[10,-5,18,-4],CREAM,1.2);
  circle(c,-2,2,5,GOLD);circle(c,-1,1,3,INK);
  star(c,-1,1,3,CREAM,t*.6);
  // Quiet violet-grey exhaust gives the bright tail room to breathe.
  c.globalAlpha=.45;line(c,[-21,0,-37,0],'#77e7ea',1.6);c.restore();
}
function land(c,f){
  if(!f.land.length)return;
  const u=f.unit,b=f.base;
  c.save();contours(c,f.land);
  c.fillStyle='rgba(255,171,38,.23)';c.fill('evenodd');
  c.save();c.clip('evenodd');
  const wash=c.createRadialGradient(b.x,b.y,20*u,b.x,b.y,850*u);
  wash.addColorStop(0,'rgba(255,177,42,.22)');wash.addColorStop(1,'rgba(6,20,35,.12)');
  c.fillStyle=wash;c.fillRect(0,0,f.width,f.height);
  // The gilded foundry: a sparse hexagonal circuit, anchored to the base.
  const spacing=86*u,dy=spacing*.866,ox=b.x%spacing,oy=b.y%dy;
  c.beginPath();
  for(let row=-1,y=oy-dy;y<f.height+dy;y+=dy,row++){
    for(let x=ox-spacing+(row%2)*spacing/2;x<f.width+spacing;x+=spacing){
      const rr=24*u;c.moveTo(x+rr,y);
      for(let k=1;k<=6;k++)c.lineTo(x+Math.cos(k*TAU/6)*rr,y+Math.sin(k*TAU/6)*rr);
    }
  }
  c.strokeStyle='rgba(255,208,112,.11)';c.lineWidth=.7*u;c.stroke();
  c.strokeStyle='rgba(255,220,151,.11)';c.lineWidth=u;
  for(let r=140;r<1100;r+=170){c.beginPath();c.arc(b.x,b.y,r*u,0,TAU);c.stroke();}
  // Small diamond junctions instead of a screen-filling particle field.
  for(let y=oy;y<f.height;y+=dy*2)for(let x=ox;x<f.width;x+=spacing*2)star(c,x,y,2*u,'rgba(255,221,148,.28)');
  c.restore();contours(c,f.land);c.strokeStyle='rgba(255,179,42,.85)';c.lineWidth=2.1*u;c.lineJoin='round';c.stroke();
  c.strokeStyle='rgba(255,241,201,.24)';c.lineWidth=.65*u;c.stroke();c.restore();
}
function tail(c,f){
  const p=f.trail,u=f.unit;if(p.length<4)return;
  const path=()=>{c.beginPath();c.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1]);};
  c.save();c.lineCap='round';c.lineJoin='round';
  path();c.strokeStyle='rgba(255,134,12,.16)';c.lineWidth=15*u;c.stroke();
  path();c.strokeStyle=INK;c.lineWidth=8*u;c.stroke();
  path();c.strokeStyle=GOLD;c.lineWidth=4.6*u;c.stroke();
  path();c.strokeStyle=CREAM;c.lineWidth=1.25*u;c.stroke();
  path();c.setLineDash([3*u,24*u]);c.lineDashOffset=-f.t*75*u;c.strokeStyle=CYAN;c.lineWidth=2.3*u;c.stroke();c.setLineDash([]);
  for(let i=8;i<p.length-4;i+=24){
    const a=Math.atan2(p[i+3]-p[i+1],p[i+2]-p[i]);
    feather(c,p[i],p[i+1],6*u,a+(i%48?1:-1)*.5,GOLD);
  }c.restore();
}
function collect(f){
  if(lastMode!=='arena'||f.t<lastT)effects=[];
  for(const e of f.events||[]){
    const life=e.type==='capture'?1.6:e.type==='death'?2.3:e.type==='respawn'?1.8:1.5;
    effects.push({...e,born:f.t,life,wx:(e.x-f.base.x)/f.unit,wy:(e.y-f.base.y)/f.unit,
      rings:e.type==='capture'?(e.area||[]).map(r=>Array.from(r,(v,i)=>(v-(i%2?f.base.y:f.base.x))/f.unit)):null});
  }
  effects=effects.filter(e=>f.t-e.born<e.life).slice(-20);
}
function bursts(c,f){
  const u=f.unit;
  for(const e of effects){
    const age=f.t-e.born,p=age/e.life,x=f.base.x+e.wx*u,y=f.base.y+e.wy*u,fade=(1-p)**2;
    c.save();c.translate(x,y);
    if(e.type==='capture'){
      c.save();c.translate(-x,-y);
      contours(c,e.rings.map(r=>r.map((v,i)=>v*u+(i%2?f.base.y:f.base.x))));
      c.fillStyle='rgba(255,236,173,'+(.32*fade)+')';c.fill('evenodd');c.restore();
      circle(c,0,0,(18+160*p)*u,null,'rgba(255,222,136,'+fade+')',2*u);
      c.globalAlpha=fade;
      for(let k=0;k<12;k++){const a=k*TAU/12+p*.3;feather(c,Math.cos(a)*(15+100*p)*u,Math.sin(a)*(15+100*p)*u,(5+7*p)*u,a,GOLD);}
      c.textAlign='center';c.font='bold '+Math.round(12*u)+'px Arial, sans-serif';c.fillStyle=CREAM;
      if(e.percent>=.15)c.fillText('+'+e.percent.toFixed(1)+'%',0,-(28+25*p)*u);
    }else if(e.type==='kill'){
      c.globalAlpha=fade;
      for(let k=0;k<3;k++)line(c,[(-32+k*15)*u,(-40+p*20)*u,(28+k*12)*u,(28+p*20)*u],k===1?CREAM:GOLD,4*u);
      star(c,0,0,(10+55*p)*u,CYAN,.75);
      circle(c,0,0,(20+100*p)*u,null,GOLD,2*u);
      c.fillStyle=CREAM;c.textAlign='center';c.font='bold '+Math.round(11*u)+'px Arial, sans-serif';c.fillText('СОЛНЦЕ ПОГЛОЩЕНО',0,-45*u);
    }else if(e.type==='death'){
      c.globalAlpha=fade;
      circle(c,0,0,(15+40*p)*u,INK,'#75624a',u);
      for(let k=0;k<18;k++){
        const a=k*2.399,r=(14+110*p)*u;
        feather(c,Math.cos(a)*r,Math.sin(a)*r+p*p*42*u,(4+((k*7)%8))*u,a+p*3,k%3?'#bd8735':CYAN);
      }
      circle(c,0,0,(20+130*p)*u,null,'rgba(255,181,46,.3)',u);
    }else if(e.type==='respawn'){
      c.globalAlpha=fade;
      circle(c,0,0,(95*(1-p)+12)*u,null,CREAM,2*u);
      for(let k=0;k<10;k++){const a=k*TAU/10-p*2,r=(80*(1-p)+10)*u;feather(c,Math.cos(a)*r,Math.sin(a)*r,7*u,a+Math.PI/2,GOLD);}
      line(c,[0,-110*(1-p)*u,0,-20*u],CYAN,2*u);star(c,0,0,(15+25*Math.sin(p*Math.PI))*u,CREAM);
    }c.restore();
  }
}
function arena(c,f){
  collect(f);const u=f.unit,b=f.base,h=f.head;
  land(c,f);eclipse(c,b.x,b.y,b.r*.73,f.t,.85);
  c.save();c.translate(b.x,b.y);c.rotate(-f.t*.15);
  for(let k=0;k<4;k++){const a=k*TAU/4;star(c,Math.cos(a)*b.r*.9,Math.sin(a)*b.r*.9,3*u,CYAN,a);}c.restore();
  tail(c,f);bursts(c,f);
  if(h.alive){
    c.save();c.globalAlpha=.25;circle(c,h.x,h.y+5*u,21*u,INK);c.restore();
    raven(c,h.x,h.y,.61*u,h.heading*Math.PI/180,f.t,h.home?.55:1);
    if(!h.home){c.save();c.globalAlpha=.7;star(c,h.x-Math.cos(h.heading*Math.PI/180)*27*u,h.y-Math.sin(h.heading*Math.PI/180)*27*u,3.5*u,CYAN,f.t);c.restore();}
  }else{
    circle(c,b.x,b.y,18*u,INK,'rgba(255,181,46,.4)',u);
    c.beginPath();c.arc(b.x,b.y,25*u,-Math.PI/2,-Math.PI/2+TAU*(1-clamp(h.respawnIn/60,0,1)));
    c.strokeStyle=CYAN;c.lineWidth=2*u;c.stroke();
  }
}
function tracked(c,text,x,y,size,color,spacing=4){
  c.font='700 '+size+'px Arial, sans-serif';c.fillStyle=color;c.textAlign='left';
  let width=0;for(const ch of text)width+=c.measureText(ch).width+spacing;
  let cursor=x-width/2;
  for(const ch of text){c.fillText(ch,cursor,y);cursor+=c.measureText(ch).width+spacing;}
}
function stars(c,w,h,t,alpha=.5){
  c.save();
  for(let i=0;i<52;i++){
    const x=((i*173+67)%809)/809*w,y=((i*293+37)%839)/839*h;
    c.globalAlpha=alpha*(.3+.7*(.5+.5*Math.sin(t*.8+i)));
    star(c,x,y,i%7===0?3:1.1,i%3?CREAM:CYAN,t*.05);
  }c.restore();
}
function intro(c,f){
  c.save();c.scale(f.width/840,f.height/860);
  const bg=c.createLinearGradient(0,0,840,860);bg.addColorStop(0,'#071521');bg.addColorStop(.55,'#111821');bg.addColorStop(1,'#20160f');
  c.fillStyle=bg;c.fillRect(0,0,840,860);
  stars(c,840,860,f.t,.6);
  // Observatory card frame, deliberately spacious for the camera.
  line(c,[31,84,31,30,85,30],GOLD,2);
  line(c,[755,30,809,30,809,84],GOLD,2);
  line(c,[31,775,31,830,85,830],GOLD,2);
  line(c,[755,830,809,830,809,775],GOLD,2);
  tracked(c,'ОРДЕН ЧЁРНОГО СОЛНЦА',420,85,15,CYAN,5);
  c.textAlign='center';c.fillStyle='#a69270';c.font='11px Consolas, monospace';c.fillText('SOLAR CORVID  /  TERRITORY DIVISION  /  001',420,112);
  eclipse(c,420,362,194,f.t);
  c.save();c.translate(420,365);c.rotate(f.t*.035);
  c.strokeStyle='rgba(255,181,46,.2)';c.lineWidth=1;
  for(let k=0;k<3;k++){c.beginPath();c.ellipse(0,0,250+k*12,88+k*6,k*Math.PI/3,0,TAU);c.stroke();}
  c.restore();
  // Flare behind the raven's crown.
  const gl=c.createRadialGradient(420,347,10,420,347,130);
  gl.addColorStop(0,'rgba(255,213,103,.25)');gl.addColorStop(1,'rgba(255,160,20,0)');circle(c,420,347,130,gl);
  raven(c,420,360,3.35,-Math.PI/2,f.t*.32,1.15);
  for(let k=0;k<6;k++){
    const a=k*TAU/6+f.t*.08,r=237+Math.sin(f.t+k)*4;
    feather(c,420+Math.cos(a)*r,362+Math.sin(a)*r,14,a+Math.PI/2,k%2?CYAN:GOLD);
  }
  line(c,[226,604,614,604],'rgba(255,181,46,.5)',1);
  star(c,420,604,8,GOLD,Math.PI/4);
  tracked(c,f.name,420,682,69,CREAM,6);
  c.textAlign='center';c.fillStyle=GOLD;c.font='21px Arial, sans-serif';c.fillText(f.motto,420,727);
  tracked(c,'ЗАМКНИ КРУГ · ЗАБЕРИ СВЕТ',420,781,12,'#9aafbd',3);
  c.restore();
}
function victory(c,f){
  c.save();c.scale(f.width/1152,f.height/648);
  const bg=c.createRadialGradient(576,285,50,576,285,650);
  bg.addColorStop(0,'#35220f');bg.addColorStop(.45,'#121923');bg.addColorStop(1,'#060e18');
  c.fillStyle=bg;c.fillRect(0,0,1152,648);stars(c,1152,648,f.t,.8);
  const reveal=1-Math.exp(-f.t*2),cx=576,cy=265;
  c.save();c.translate(cx,cy);c.rotate(f.t*.04);
  for(let k=0;k<32;k++){
    const a=k*TAU/32,r=150+(k%4)*10,len=(k%2?75:130)*reveal;
    c.globalAlpha=.18+.15*Math.sin(k+f.t);
    poly(c,[Math.cos(a-.018)*r,Math.sin(a-.018)*r,Math.cos(a)*(r+len),Math.sin(a)*(r+len),Math.cos(a+.018)*r,Math.sin(a+.018)*r],GOLD);
  }c.restore();
  eclipse(c,cx,cy,149,f.t);
  // The stolen sun ignites, and its raven opens both wings.
  circle(c,cx,cy,118*reveal,'rgba(255,181,46,.09)');
  raven(c,cx,cy,2.65*(.9+.1*reveal),-Math.PI/2,f.t*.32,1.25);
  poly(c,[cx-49,cy-117,cx-39,cy-145,cx-15,cy-126,cx,cy-159,cx+15,cy-126,cx+39,cy-145,cx+49,cy-117],GOLD,CREAM,1);
  for(let i=0;i<45;i++){
    const a=i*2.399+f.t*.1,r=180+((i*47+f.t*48)%400);
    const x=cx+Math.cos(a)*r*1.6,y=cy+Math.sin(a)*r*.7;
    c.save();c.globalAlpha=.25+.65*(.5+.5*Math.sin(i+f.t));feather(c,x,y,6+i%9,a+f.t*.3,i%5?GOLD:CYAN);c.restore();
  }
  tracked(c,'ПОЛЕ ПОД КРЫЛОМ',576,500,43,CREAM,5);
  tracked(c,f.name,576,551,23,GOLD,9);
  c.textAlign='center';c.font='14px Arial, sans-serif';c.fillStyle='#a7bcc7';c.fillText(f.motto,576,594);
  c.restore();
}
export default{
  draw(c,f){
    c.save();c.lineCap='round';c.lineJoin='round';
    if(f.mode==='arena')arena(c,f);else if(f.mode==='intro')intro(c,f);else victory(c,f);
    c.restore();lastMode=f.mode;lastT=f.t;
  }
};
