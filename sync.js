/* ---------- synchronisation Supabase ----------
   Compte (e-mail + mot de passe) et accès à la table public.docs.
   La clé publishable est faite pour être publique : sans connexion elle ne donne
   accès à rien (RLS, voir supabase/schema.sql). */
(function(root){
const SUPABASE_URL='https://flbvyamkrxrghdxexnzf.supabase.co';
const SUPABASE_KEY='sb_publishable_LBMkOe4NjazsouB7OdUzmA_i9giWBCG';
let client=null;

const available=()=>!!(root.supabase&&root.supabase.createClient);
function sb(){
  if(!client&&available())client=root.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'ss-auth'}});
  return client;
}
const check=r=>{if(r.error)throw r.error;return r.data};

/* Stockage distant au format attendu par SolarStore.attachRemote */
function adapter(uid){
  const c=sb();
  return {
    async list(){return check(await c.from('docs').select('col,id,data'))},
    async upsert(rows){
      if(!rows.length)return;
      check(await c.from('docs').upsert(rows.map(r=>({user_id:uid,col:r.col,id:r.id,data:r.data})),{onConflict:'user_id,col,id'}));
    },
    async remove(col,id){check(await c.from('docs').delete().match({user_id:uid,col,id}))},
    subscribe(cb){
      const ch=c.channel('docs-'+uid)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'docs',filter:'user_id=eq.'+uid},p=>cb({type:'upsert',col:p.new.col,id:p.new.id,data:p.new.data}))
        .on('postgres_changes',{event:'UPDATE',schema:'public',table:'docs',filter:'user_id=eq.'+uid},p=>cb({type:'upsert',col:p.new.col,id:p.new.id,data:p.new.data}))
        /* les suppressions ne sont pas filtrables côté serveur : on vérifie le propriétaire ici */
        .on('postgres_changes',{event:'DELETE',schema:'public',table:'docs'},p=>{const o=p.old||{};if(o.user_id===uid&&o.col&&o.id)cb({type:'delete',col:o.col,id:o.id})})
        .subscribe();
      return ()=>c.removeChannel(ch);
    }
  };
}

/* Messages d'erreur en français */
function authMessage(e){
  const code=e&&(e.code||e.error_code),msg=String(e&&e.message||'');
  if(code==='invalid_credentials'||/invalid login/i.test(msg))return 'E-mail ou mot de passe incorrect.';
  if(code==='user_already_exists'||/already registered/i.test(msg))return 'Ce compte existe déjà : connecte-toi.';
  if(code==='email_not_confirmed'||/not confirmed/i.test(msg))return 'Confirme d\'abord ton e-mail avec le lien reçu, puis connecte-toi.';
  if(code==='weak_password'||/password should be/i.test(msg))return 'Mot de passe trop court (6 caractères minimum).';
  if(code==='signup_disabled'||/signups not allowed/i.test(msg))return 'La création de compte est désactivée.';
  if(code==='validation_failed'||/invalid.*email|email.*invalid/i.test(msg))return 'Adresse e-mail invalide.';
  if(/rate limit/i.test(msg))return 'Trop de tentatives, réessaie dans quelques minutes.';
  if(/fetch|network/i.test(msg))return 'Pas de réseau, réessaie plus tard.';
  return 'Connexion impossible : '+msg;
}

root.SolarSync={
  available,adapter,authMessage,
  signIn:async(email,password)=>check(await sb().auth.signInWithPassword({email,password})),
  signUp:async(email,password)=>check(await sb().auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}})),
  signOut:async()=>{await sb().auth.signOut({scope:'local'})},
  /* cb(user|null) à chaque changement de session, différé : on ne doit pas appeler Supabase
     depuis l'intérieur de onAuthStateChange */
  onAuth(cb){if(available())sb().auth.onAuthStateChange((ev,session)=>setTimeout(()=>cb(session?session.user:null),0))}
};
})(window);
