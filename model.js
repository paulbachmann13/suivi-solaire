/* ---------- modèle de projection (identique au classeur) ----------
   Fonction reprise telle quelle de l'appli d'origine. Ne pas modifier :
   les tests (tests/project.test.js) vérifient les valeurs du classeur Excel. */
function project(parc,s,cb,startYear,n=20){
  const eq=parc.filter(e=>(e.type==='Panneaux'||e.type==='Batterie')&&e.date).map(e=>{const [y,m,d]=e.date.split('-').map(Number);return {...e,y0:y,m0:m,d0:d}});
  const bats=eq.filter(e=>e.type==='Batterie');
  const firstBat=bats.length?Math.min(...bats.map(e=>e.y0)):null;
  const firstEq=eq.length?Math.min(...eq.map(e=>e.y0)):null;
  let P=0,R=0;const rows=[];
  for(let i=0;i<n;i++){
    const y=startYear+i;let capP=0,capB=0,wP=0,wB=0;
    for(const e of eq){
      if(e.y0>y)continue;
      const k=1-e.deg*(y-e.y0),eff=k>0?e.cap*k:0;
      const frac=e.y0<y?1:(Date.UTC(y+1,0,1)-Date.UTC(e.y0,e.m0-1,e.d0))/86400000/365;
      if(e.type==='Panneaux'){capP+=eff;wP+=eff*frac}else{capB+=eff;wB+=eff*frac}
    }
    const E=wP*s.ratio,F=Math.min(s.plafond,s.tauxBase+s.bonus*wB),G=E*F;
    const H=cb*Math.pow(1+s.consoGrowth,y-startYear),I=Math.max(0,H-G);
    const pr=s.prix*Math.pow(1+s.priceGrowth,y-startYear);
    const J=I*pr,K=12*s.abo,L=Math.max(0,E-G)*s.rachat,M=J+K-L;
    const N=E*Math.max(0,F-s.tauxBase),O=N*(pr-s.rachat),Q=G*pr+L;
    const sans=H*pr+K;
    if(firstBat!=null&&y>=firstBat)P+=O;
    if(firstEq!=null&&y>=firstEq)R+=Q;
    rows.push({y,capP,capB,E,F,G,H,I,M,sans,P,R});
  }
  const costB=bats.reduce((a,e)=>a+(e.cost||0),0);
  const costAll=eq.reduce((a,e)=>a+(e.cost||0),0);
  const pb=rows.find(r=>costB>0&&r.P>=costB),pa=rows.find(r=>costAll>0&&r.R>=costAll);
  return {rows,costB,costAll,costP:costAll-costB,firstBat,firstEq,payB:pb?pb.y:null,payA:pa?pa.y:null,nBat:bats.length};
}

if(typeof module!=='undefined'&&module.exports)module.exports={project};
