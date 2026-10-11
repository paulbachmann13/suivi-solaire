// La version affichée dans l'appli doit suivre la version du cache du service worker.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('APP_VERSION (index.html) = CACHE_VERSION (sw.js)',()=>{
  const app=read('index.html').match(/const APP_VERSION='([^']+)'/);
  const sw=read('sw.js').match(/const CACHE_VERSION='([^']+)'/);
  assert.ok(app&&sw,'constantes introuvables');
  assert.equal(app[1],sw[1]);
});
