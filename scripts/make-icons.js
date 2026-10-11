// Génère icons/icon-{180,192,512}.png : un soleil simple sur fond bleu nuit.
// Aucune dépendance : encodeur PNG minimal (zlib + CRC32). Usage : npm run icons
const fs=require('fs'),path=require('path'),zlib=require('zlib');

const BG=[0x1f,0x3a,0x5f],SUN=[0xf5,0xa6,0x23];
const RAYS=12,R_DISC=.19,R_IN=.27,R_OUT=.37,RAY_W=.05; // en fraction de la taille
const SS=4; // sur-échantillonnage pour l'anticrénelage

function segDist(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(px-ax-t*dx,py-ay-t*dy);
}
const rays=Array.from({length:RAYS},(_,i)=>{const a=i*2*Math.PI/RAYS-Math.PI/2;
  return [.5+R_IN*Math.cos(a),.5+R_IN*Math.sin(a),.5+R_OUT*Math.cos(a),.5+R_OUT*Math.sin(a)]});
const inSun=(x,y)=>Math.hypot(x-.5,y-.5)<=R_DISC||rays.some(r=>segDist(x,y,...r)<=RAY_W/2);

const CRC=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c});
const crc32=b=>{let c=-1;for(const x of b)c=CRC[(c^x)&255]^(c>>>8);return (c^-1)>>>0};
function chunk(type,data){
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const td=Buffer.concat([Buffer.from(type),data]),crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len,td,crc]);
}
function png(size){
  const raw=Buffer.alloc(size*(size*3+1));
  for(let y=0;y<size;y++){
    raw[y*(size*3+1)]=0;
    for(let x=0;x<size;x++){
      let hit=0;
      for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++)if(inSun((x+(sx+.5)/SS)/size,(y+(sy+.5)/SS)/size))hit++;
      const a=hit/(SS*SS),o=y*(size*3+1)+1+x*3;
      for(let c=0;c<3;c++)raw[o+c]=Math.round(BG[c]*(1-a)+SUN[c]*a);
    }
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),
    chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
const dir=path.join(__dirname,'..','icons');
fs.mkdirSync(dir,{recursive:true});
for(const s of [180,192,512]){fs.writeFileSync(path.join(dir,`icon-${s}.png`),png(s));console.log('icons/icon-'+s+'.png')}
