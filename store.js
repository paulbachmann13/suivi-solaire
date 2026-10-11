/* ---------- stockage local ----------
   Remplace window.claude.use('db') avec la même interface :
     db.collection(nom).onSnapshot(cb, errCb)   cb({docs:[{id, data()}]})
     db.doc('col/id').set(data) / .delete()      promesses
   Les données vivent dans localStorage (clé ss-data). Au premier lancement,
   si rien n'est stocké, seed.json est chargé. */
(function(root){
const KEY='ss-data',KEY_EXPORT='ss-last-export',KEY_FIRST='ss-first-run';
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
   ({type:'ajout-mois', months:{...}, settings?:{...}} : complète sans rien effacer). */
function parseFile(input){
  const o=toObj(input);
  if(!isObj(o)||o.type!=='ajout-mois')return parseBackup(o);
  if(!isObj(o.months))throw fail('invalid_file','Fichier d\'ajout sans mois.');
  checkMonths(o.months);
  if(o.settings!=null&&!isObj(o.settings))throw fail('invalid_file','Réglages invalides dans le fichier.');
  return {kind:'ajout',months:clone(o.months),settings:clone(o.settings||{}),exportedAt:typeof o.exportedAt==='string'?o.exportedAt:null};
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
      async set(doc){const [col,id]=split(path);write({...data,[col]:{...data[col],[id]:clone(doc)}});emit(col)},
      async delete(){const [col,id]=split(path);const c={...data[col]};delete c[id];write({...data,[col]:c});emit(col)}
    }},
    /* rechargement depuis le stockage (modification dans un autre onglet) */
    reload(){try{const d=read();if(d){data=d;COLS.forEach(emit)}}catch(e){console.error(e)}},
    exportJSON(){return JSON.stringify({app:'suivi-solaire',format:1,exportedAt:now(),months:data.months,parc:data.parc,settings:data.settings},null,1)},
    inspectBackup(text){
      const b=parseFile(text),keys=Object.keys(b.months).sort();
      return {kind:b.kind,months:keys.length,keys,replaced:keys.filter(k=>k in data.months),parc:b.parc?Object.keys(b.parc).length:0,exportedAt:b.exportedAt};
    },
    async importJSON(text){
      const b=parseFile(text);
      if(b.kind==='ajout')write({...data,months:{...data.months,...b.months},settings:{...data.settings,...b.settings}});
      else write(b);
      COLS.forEach(emit);
    },
    markExported(){try{storage.setItem(KEY_EXPORT,now())}catch(e){}},
    backupInfo(){return {last:safeGet(KEY_EXPORT),since:safeGet(KEY_FIRST)}}
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
