/* ---------- stockage local ----------
   Remplace window.claude.use('db') avec la même interface :
     db.collection(nom).onSnapshot(cb, errCb)   cb({docs:[{id, data()}]})
     db.doc('col/id').set(data) / .delete()      promesses
   Les données vivent dans localStorage (clé ss-data). Au premier lancement,
   si rien n'est stocké, seed.json est chargé.
   Synchronisation (facultative) : db.attachRemote(remote, uid) branche un stockage distant
   ({list, upsert, remove, subscribe}). L'appli lit toujours la copie locale ; chaque
   modification part dans une file (ss-queue) envoyée dès que le réseau le permet. */
(function(root){
const KEY='ss-data',KEY_EXPORT='ss-last-export',KEY_FIRST='ss-first-run',KEY_QUEUE='ss-queue',KEY_SYNCED='ss-synced';
const COLS=['months','parc','settings'];
const clone=o=>JSON.parse(JSON.stringify(o));
const isObj=o=>o!=null&&typeof o==='object'&&!Array.isArray(o);

function fail(code,msg){const e=new Error(msg||code);e.code=code;return e}

function checkMonths(months){
  for(const [k,m] of Object.entries(months)){
    const ok=/^\d{4}-\d{2}$/.test(k)&&isObj(m)&&['year','month','prod','usage','conso','reseau'].every(f=>typeof m[f]==='number'&&isFinite(m[f]));
    if(!ok)throw fail('invalid_file','Mois invalide dans le fichier : '+k+'.');
  }
}
const toObj=input=>{
  if(typeof input!=='string')return input;
  try{return JSON.parse(input)}catch(e){throw fail('invalid_file','Ce fichier n\'est pas une sauvegarde valide.')}
};

/* Vérifie et normalise un contenu de sauvegarde ou de seed. */
function parseBackup(input){
  const o=toObj(input);
  if(!isObj(o)||!COLS.every(c=>isObj(o[c])))throw fail('invalid_file','Ce fichier n\'est pas une sauvegarde de Suivi solaire.');
  checkMonths(o.months);
  for(const [k,e] of Object.entries(o.parc))if(!isObj(e))throw fail('invalid_file','Équipement invalide dans la sauvegarde : '+k+'.');
  return {kind:'complet',months:clone(o.months),parc:clone(o.parc),settings:clone(o.settings),exportedAt:typeof o.exportedAt==='string'?o.exportedAt:null};
}

/* Fichier à importer : sauvegarde complète (remplace tout) ou ajout de mois
   ({type:'ajout-mois', months:{...}, parc?:{...}, settings?:{...}} : ajoute ou remplace
   ces documents-là, sans rien effacer). */
function parseFile(input){
  const o=toObj(input);
  if(!isObj(o)||o.type!=='ajout-mois')return parseBackup(o);
  if(!isObj(o.months))throw fail('invalid_file','Fichier d\'ajout sans mois.');
  checkMonths(o.months);
  if(o.settings!=null&&!isObj(o.settings))throw fail('invalid_file','Réglages invalides dans le fichier.');
  if(o.parc!=null&&(!isObj(o.parc)||!Object.values(o.parc).every(isObj)))throw fail('invalid_file','Équipements invalides dans le fichier.');
  return {kind:'ajout',months:clone(o.months),parc:clone(o.parc||{}),settings:clone(o.settings||{}),exportedAt:typeof o.exportedAt==='string'?o.exportedAt:null};
}

function createStore(storage,loadSeed){
  let data=null;const subs={};
  const read=()=>{const raw=storage.getItem(KEY);return raw?parseBackup(raw):null};
  function write(next){
    try{storage.setItem(KEY,JSON.stringify({months:next.months,parc:next.parc,settings:next.settings}))}
    catch(e){throw fail(e&&(e.name==='QuotaExceededError'||e.code===22)?'quota_exceeded':'unavailable')}
    data=next;
  }
  const snap=col=>{const o=data[col]||{};return {docs:Object.keys(o).map(id=>({id,data:()=>clone(o[id])}))}};
  const emit=col=>(subs[col]||[]).forEach(s=>{try{s.cb(snap(col))}catch(e){console.error(e)}});
  const split=path=>{const i=path.indexOf('/'),col=path.slice(0,i),id=path.slice(i+1);
    if(i<1||!id||!COLS.includes(col))throw fail('invalid_argument','Chemin invalide : '+path);return [col,id]};
  const now=()=>new Date().toISOString();
  const safeGet=k=>{try{return storage.getItem(k)}catch(e){return null}};

  /* ---- synchronisation ---- */
  let remote=null,remoteUid=null,unsub=null,running=null,rerun=false,timer=0;
  let queue=(()=>{try{return JSON.parse(storage.getItem(KEY_QUEUE)||'[]')}catch(e){return []}})();
  let status={state:'off',at:null,pending:queue.length,error:null};const statusSubs=[];
  const saveQueue=()=>{try{storage.setItem(KEY_QUEUE,JSON.stringify(queue))}catch(e){}};
  const setStatus=s=>{status={...status,...s,pending:queue.length};statusSubs.forEach(cb=>{try{cb(status)}catch(e){console.error(e)}})};
  /* on garde les modifications pour l'envoi dès qu'un compte est branché, ou l'a déjà été sur cet appareil */
  const tracking=()=>!!remote||!!safeGet(KEY_SYNCED);
  function enqueue(ops){
    if(!tracking()||!ops.length)return;
    for(const o of ops){queue=queue.filter(q=>!(q.col===o.col&&q.id===o.id));queue.push({col:o.col,id:o.id,data:o.data==null?null:clone(o.data)})}
    saveQueue();setStatus({});
    if(remote){clearTimeout(timer);timer=setTimeout(()=>db.sync(),300)}
  }
  function applyRemote(ev){
    if(!ev||!COLS.includes(ev.col)||queue.some(q=>q.col===ev.col&&q.id===ev.id))return;
    const c={...data[ev.col]};
    if(ev.type==='delete'){if(!(ev.id in c))return;delete c[ev.id]}
    else{if(JSON.stringify(c[ev.id])===JSON.stringify(ev.data))return;c[ev.id]=clone(ev.data)}
    try{write({...data,[ev.col]:c})}catch(e){return}
    emit(ev.col);
  }
  async function doSync(){
    if(!remote)return;
    const r=remote,uid=remoteUid;
    setStatus({state:'syncing',error:null});
    try{
      /* 1. envoyer les modifications en attente */
      const ops=queue.slice(),ups=ops.filter(o=>o.data!=null),dels=ops.filter(o=>o.data==null);
      if(ups.length)await r.upsert(ups.map(o=>({col:o.col,id:o.id,data:o.data})));
      for(const o of dels)await r.remove(o.col,o.id);
      queue=queue.filter(q=>!ops.includes(q));saveQueue();
      /* 2. reprendre l'état distant (il fait foi) */
      const rows=await r.list();
      if(r!==remote)return;
      const next={months:{},parc:{},settings:{}};
      rows.forEach(x=>{if(next[x.col])next[x.col][x.id]=x.data});
      if(safeGet(KEY_SYNCED)!==uid){
        /* première synchro de ce compte sur cet appareil : ce qui n'existe qu'ici est envoyé, rien n'est perdu */
        const extra=[];
        COLS.forEach(c=>Object.entries(data[c]).forEach(([id,d])=>{if(!(id in next[c])){next[c][id]=clone(d);extra.push({col:c,id,data:d})}}));
        if(extra.length)await r.upsert(extra);
      }
      queue.forEach(q=>{if(q.data==null)delete next[q.col][q.id];else next[q.col][q.id]=q.data});
      const changed=COLS.filter(c=>JSON.stringify(next[c])!==JSON.stringify(data[c]));
      write(next);
      storage.setItem(KEY_SYNCED,uid);
      changed.forEach(emit);
      setStatus({state:'ok',at:now()});
    }catch(e){
      const off=typeof navigator!=='undefined'&&navigator.onLine===false;
      setStatus({state:off?'offline':'error',error:(e&&e.message)||String(e)});
    }
  }

  const db={
    async init(){
      let stored=null;
      try{stored=read()}catch(e){console.error('Données locales illisibles',e)}
      if(stored)data=stored;
      else{data={months:{},parc:{},settings:{}};write(parseBackup(await loadSeed()))}
      if(!safeGet(KEY_FIRST))try{storage.setItem(KEY_FIRST,now())}catch(e){}
      return db;
    },
    collection(col){return {onSnapshot(cb,errCb){
      if(!COLS.includes(col)){if(errCb)errCb(fail('invalid_argument'));return ()=>{}}
      const s={cb};(subs[col]=subs[col]||[]).push(s);
      Promise.resolve().then(()=>{if(subs[col].includes(s))s.cb(snap(col))});
      return ()=>{subs[col]=subs[col].filter(x=>x!==s)};
    }}},
    doc(path){return {
      async set(doc){const [col,id]=split(path);write({...data,[col]:{...data[col],[id]:clone(doc)}});emit(col);enqueue([{col,id,data:doc}])},
      async delete(){const [col,id]=split(path);const c={...data[col]};delete c[id];write({...data,[col]:c});emit(col);enqueue([{col,id,data:null}])}
    }},
    /* rechargement depuis le stockage (modification dans un autre onglet) */
    reload(){try{const d=read();if(d){data=d;COLS.forEach(emit)}}catch(e){console.error(e)}},
    exportJSON(){return JSON.stringify({app:'suivi-solaire',format:1,exportedAt:now(),months:data.months,parc:data.parc,settings:data.settings},null,1)},
    inspectBackup(text){
      const b=parseFile(text),keys=Object.keys(b.months).sort();
      const n=o=>o?Object.keys(o).length:0;
      return {kind:b.kind,months:keys.length,keys,replaced:keys.filter(k=>k in data.months),parc:n(b.parc),parcN:b.kind==='ajout'?n(b.parc):0,settingsN:b.kind==='ajout'?n(b.settings):0,exportedAt:b.exportedAt};
    },
    async importJSON(text){
      const b=parseFile(text),before=data,ops=[];
      if(b.kind==='ajout'){
        write({...data,months:{...data.months,...b.months},parc:{...data.parc,...b.parc},settings:{...data.settings,...b.settings}});
        COLS.forEach(c=>Object.entries(b[c]).forEach(([id,d])=>ops.push({col:c,id,data:d})));
      }else{
        write(b);
        COLS.forEach(c=>{
          Object.keys(before[c]).forEach(id=>{if(!(id in b[c]))ops.push({col:c,id,data:null})});
          Object.entries(b[c]).forEach(([id,d])=>ops.push({col:c,id,data:d}));
        });
      }
      COLS.forEach(emit);
      enqueue(ops);
    },
    markExported(){try{storage.setItem(KEY_EXPORT,now())}catch(e){}},
    backupInfo(){return {last:safeGet(KEY_EXPORT),since:safeGet(KEY_FIRST)}},

    attachRemote(r,uid){
      db.detachRemote();
      remote=r;remoteUid=uid;
      unsub=r.subscribe?r.subscribe(applyRemote):null;
      return db.sync();
    },
    detachRemote(){
      if(unsub)try{unsub()}catch(e){}
      unsub=null;remote=null;remoteUid=null;clearTimeout(timer);
      setStatus({state:'off',error:null});
    },
    sync(){
      if(running){rerun=true;return running}
      running=doSync().finally(()=>{running=null;if(rerun){rerun=false;db.sync()}});
      return running;
    },
    onSync(cb){statusSubs.push(cb);cb(status);return ()=>{const i=statusSubs.indexOf(cb);if(i>=0)statusSubs.splice(i,1)}},
    syncStatus(){return status}
  };
  return db;
}

/* Ouverture dans le navigateur : localStorage + seed.json. */
async function open(){
  const storage=root.localStorage;
  const db=await createStore(storage,()=>fetch('seed.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw fail('unavailable');return r.json()})).init();
  try{root.addEventListener('storage',e=>{if(e.key===KEY)db.reload()})}catch(e){}
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  return db;
}

const api={open,createStore,parseBackup,parseFile};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.SolarStore=api;
})(typeof window!=='undefined'?window:globalThis);
