const test=require('node:test'),assert=require('node:assert/strict');
const {createStore}=require('../store.js');

// Données fictives : les vraies ne sont pas dans le dépôt.
const m=(y,mo,v)=>({year:y,month:mo,prod:v,usage:v/2,conso:v*1.5,reseau:v});
const seed={
  months:{'2025-07':m(2025,6,100),'2025-08':m(2025,7,90),'2025-09':m(2025,8,80)},
  parc:{p1:{type:'Panneaux',name:'Panneaux',date:'2025-07-01',cap:3,unit:'kWc',deg:.005,cost:5000},
        p2:{type:'Batterie',name:'Batterie',date:'2026-01-01',cap:5,unit:'kWh',deg:.02,cost:3000}},
  settings:{main:{ratio:1300,tauxBase:.4,bonus:.03,plafond:.9,startYear:2025,prix:.2,abo:15,rachat:0,consoGrowth:0,priceGrowth:0}}
};
const N=Object.keys(seed.months).length;

function memoryStorage(){
  const mp=new Map();
  return {getItem:k=>mp.has(k)?mp.get(k):null,setItem:(k,v)=>mp.set(k,String(v)),removeItem:k=>mp.delete(k)};
}
const snapshot=(db,col)=>new Promise(res=>{const off=db.collection(col).onSnapshot(s=>{off();res(s)})});
const asObj=s=>Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));

test('charge le seed quand le stockage est vide, et seulement dans ce cas',async()=>{
  const st=memoryStorage();let loads=0;
  const load=async()=>{loads++;return seed};
  let db=await createStore(st,load).init();
  assert.deepEqual(asObj(await snapshot(db,'months')),seed.months);
  await db.doc('months/2025-07').delete();
  db=await createStore(st,load).init();
  assert.equal(loads,1);
  assert.equal((await snapshot(db,'months')).docs.length,N-1);
});

test('un seed vide démarre sans données',async()=>{
  const db=await createStore(memoryStorage(),async()=>({months:{},parc:{},settings:{}})).init();
  assert.equal((await snapshot(db,'months')).docs.length,0);
});

test('set et delete notifient les abonnés et persistent',async()=>{
  const st=memoryStorage(),db=await createStore(st,async()=>seed).init();
  const seen=[];db.collection('parc').onSnapshot(s=>seen.push(s.docs.length));
  await new Promise(r=>setTimeout(r));
  await db.doc('parc/p9').set({type:'Batterie',date:'2028-01-01',cap:5,deg:.02,cost:0});
  await db.doc('parc/p1').delete();
  assert.deepEqual(seen,[2,3,2]);
  assert.ok(JSON.parse(st.getItem('ss-data')).parc.p9);
});

test('export puis import restitue les mêmes données',async()=>{
  const a=await createStore(memoryStorage(),async()=>seed).init();
  await a.doc('settings/main').set({...seed.settings.main,priceGrowth:.03});
  const txt=a.exportJSON();
  const b=await createStore(memoryStorage(),async()=>({months:{},parc:{},settings:{}})).init();
  const info=b.inspectBackup(txt);
  assert.equal(info.kind,'complet');
  assert.equal(info.months,N);
  await b.importJSON(txt);
  assert.equal(asObj(await snapshot(b,'settings')).main.priceGrowth,.03);
  assert.deepEqual(asObj(await snapshot(b,'months')),seed.months);
});

test('un fichier d\'ajout complète les mois sans rien effacer',async()=>{
  const db=await createStore(memoryStorage(),async()=>seed).init();
  await db.doc('parc/p3').set({type:'Batterie',date:'2027-01-01',cap:5,deg:.02,cost:3000});
  const add=JSON.stringify({type:'ajout-mois',months:{'2025-09':m(2025,8,85),'2025-10':m(2025,9,70)},settings:{tempo:{kwh:[1,2,3,4,5,6]}}});
  const info=db.inspectBackup(add);
  assert.equal(info.kind,'ajout');
  assert.deepEqual(info.keys,['2025-09','2025-10']);
  assert.deepEqual(info.replaced,['2025-09']);
  await db.importJSON(add);
  const months=asObj(await snapshot(db,'months')),settings=asObj(await snapshot(db,'settings'));
  assert.equal(Object.keys(months).length,N+1);
  assert.equal(months['2025-09'].prod,85);
  assert.equal(months['2025-07'].prod,100);
  assert.equal((await snapshot(db,'parc')).docs.length,3);
  assert.deepEqual(settings.tempo.kwh,[1,2,3,4,5,6]);
  assert.equal(settings.main.ratio,1300);
});

test('refuse un fichier qui n\'est pas une sauvegarde',async()=>{
  const db=await createStore(memoryStorage(),async()=>seed).init();
  await assert.rejects(db.importJSON('{"foo":1}'),{code:'invalid_file'});
  await assert.rejects(db.importJSON('pas du json'),{code:'invalid_file'});
  await assert.rejects(db.importJSON('{"type":"ajout-mois","months":{"2025-13x":{}}}'),{code:'invalid_file'});
  assert.equal((await snapshot(db,'months')).docs.length,N);
});

test('stockage plein : erreur quota_exceeded, données inchangées',async()=>{
  const st=memoryStorage(),db=await createStore(st,async()=>seed).init();
  st.setItem=()=>{const e=new Error('full');e.name='QuotaExceededError';throw e};
  await assert.rejects(db.doc('months/2025-10').set(m(2025,9,1)),{code:'quota_exceeded'});
  assert.equal((await snapshot(db,'months')).docs.length,N);
});
