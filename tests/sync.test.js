// Synchronisation avec un stockage distant simulé (même interface que sync.js).
const test=require('node:test'),assert=require('node:assert/strict');
const {createStore}=require('../store.js');

const m=(y,mo,v)=>({year:y,month:mo,prod:v,usage:v/2,conso:v*1.5,reseau:v});
const empty={months:{},parc:{},settings:{}};
function memoryStorage(){
  const mp=new Map();
  return {getItem:k=>mp.has(k)?mp.get(k):null,setItem:(k,v)=>mp.set(k,String(v)),removeItem:k=>mp.delete(k)};
}
/* « Serveur » partagé entre appareils : une Map par compte */
function fakeServer(){
  const rows=new Map(),subs=new Set();let down=false;
  const k=(c,i)=>c+'/'+i;
  const guard=()=>{if(down)throw new Error('Failed to fetch')};
  return {
    rows,setDown:v=>{down=v},
    remote(){
      const self={
        async list(){guard();return [...rows.values()].map(r=>({...r,data:JSON.parse(JSON.stringify(r.data))}))},
        async upsert(list){guard();for(const r of list){rows.set(k(r.col,r.id),{col:r.col,id:r.id,data:r.data});subs.forEach(s=>s!==self.cb&&s({type:'upsert',...r}))}},
        async remove(col,id){guard();rows.delete(k(col,id));subs.forEach(s=>s!==self.cb&&s({type:'delete',col,id}))},
        subscribe(cb){self.cb=cb;subs.add(cb);return ()=>subs.delete(cb)}
      };
      return self;
    }
  };
}
const months=db=>new Promise(res=>{const off=db.collection('months').onSnapshot(s=>{off();res(Object.fromEntries(s.docs.map(d=>[d.id,d.data()])))})});
const tick=(ms=350)=>new Promise(r=>setTimeout(r,ms));

test('1re connexion : les données du téléphone partent vers le serveur, rien n\'est perdu',async()=>{
  const srv=fakeServer();
  const phone=await createStore(memoryStorage(),async()=>({...empty,months:{'2025-07':m(2025,6,100),'2025-08':m(2025,7,90)}})).init();
  await phone.attachRemote(srv.remote(),'u1');
  assert.equal(srv.rows.size,2);
  assert.equal(phone.syncStatus().state,'ok');
  // l'iPad, vide, récupère tout
  const ipad=await createStore(memoryStorage(),async()=>empty).init();
  await ipad.attachRemote(srv.remote(),'u1');
  assert.deepEqual(Object.keys(await months(ipad)).sort(),['2025-07','2025-08']);
});

test('une saisie sur un appareil arrive sur l\'autre (temps réel)',async()=>{
  const srv=fakeServer();
  const a=await createStore(memoryStorage(),async()=>empty).init(),b=await createStore(memoryStorage(),async()=>empty).init();
  await a.attachRemote(srv.remote(),'u1');await b.attachRemote(srv.remote(),'u1');
  await a.doc('months/2026-10').set(m(2026,9,500));
  await tick();
  assert.equal((await months(b))['2026-10'].prod,500);
  await b.doc('months/2026-10').delete();
  await tick();
  assert.equal((await months(a))['2026-10'],undefined);
  a.detachRemote();b.detachRemote();
});

test('hors ligne : la saisie reste en file et part au retour du réseau',async()=>{
  const srv=fakeServer(),st=memoryStorage();
  const db=await createStore(st,async()=>empty).init();
  await db.attachRemote(srv.remote(),'u1');
  srv.setDown(true);
  await db.doc('months/2026-10').set(m(2026,9,400));
  await tick();
  assert.equal(db.syncStatus().state,'error');
  assert.equal(db.syncStatus().pending,1);
  assert.equal(JSON.parse(st.getItem('ss-queue')).length,1);
  assert.equal((await months(db))['2026-10'].prod,400,'la saisie reste visible');
  srv.setDown(false);
  await db.sync();
  assert.equal(db.syncStatus().pending,0);
  assert.ok(srv.rows.has('months/2026-10'));
  db.detachRemote();
});

test('appareil déjà synchronisé : une suppression faite ailleurs est appliquée, pas renvoyée',async()=>{
  const srv=fakeServer();
  const a=await createStore(memoryStorage(),async()=>({...empty,months:{'2025-07':m(2025,6,100)}})).init();
  await a.attachRemote(srv.remote(),'u1');
  a.detachRemote();                                   // a ne reçoit plus le temps réel
  const b=await createStore(memoryStorage(),async()=>empty).init();
  await b.attachRemote(srv.remote(),'u1');
  await b.doc('months/2025-07').delete();await tick();
  await a.attachRemote(srv.remote(),'u1');
  assert.deepEqual(await months(a),{});
  assert.equal(srv.rows.size,0);
  b.detachRemote();a.detachRemote();
});

test('import complet : les documents absents du fichier sont supprimés aussi sur le serveur',async()=>{
  const srv=fakeServer();
  const db=await createStore(memoryStorage(),async()=>({...empty,months:{'2025-07':m(2025,6,100),'2025-08':m(2025,7,90)}})).init();
  await db.attachRemote(srv.remote(),'u1');
  await db.importJSON(JSON.stringify({months:{'2025-08':m(2025,7,95)},parc:{},settings:{}}));
  await tick();
  assert.deepEqual([...srv.rows.keys()],['months/2025-08']);
  assert.equal(srv.rows.get('months/2025-08').data.prod,95);
  db.detachRemote();
});

test('sans compte, rien n\'est mis en file',async()=>{
  const st=memoryStorage(),db=await createStore(st,async()=>empty).init();
  await db.doc('months/2026-10').set(m(2026,9,1));
  assert.equal(st.getItem('ss-queue'),null);
  assert.equal(db.syncStatus().state,'off');
});
