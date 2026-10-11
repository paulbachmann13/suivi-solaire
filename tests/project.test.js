// Valeurs de référence du classeur Suivi_energie.xlsx.
// Les données personnelles ne sont pas dans le dépôt : ces tests lisent l'instantané privé
// prive/reference-classeur.json (données telles que dans le classeur, panneaux au 01/07/2025)
// et sont ignorés s'il est absent.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const {project}=require('../model.js');

const file=path.join(__dirname,'..','prive','reference-classeur.json');
const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
const skip=data?false:'instantané privé absent (prive/reference-classeur.json)';

// Mêmes entrées que runProject() dans index.html : équipements triés par date,
// consommation de base = somme des 12 mois du classeur (juillet 2025 à juin 2026).
let run=()=>null;
if(data){
  const parc=Object.entries(data.parc).map(([id,e])=>({id,...e})).sort((a,b)=>a.date<b.date?-1:1);
  const months=Object.keys(data.months).filter(k=>k<='2026-06').sort().map(k=>data.months[k]);
  const cb=months.slice(-12).reduce((a,m)=>a+m.conso,0);
  const s=data.settings.main;
  run=(over={})=>project(parc,{...s,...over},cb,s.startYear);
}
const row=(p,y)=>p.rows.find(r=>r.y===y);
const near=(actual,expected,digits)=>assert.equal(+actual.toFixed(digits),expected,`${actual} ≠ ${expected}`);

test('2025 : production et taux d\'autoconsommation',{skip},()=>{
  const r=row(run(),2025);
  near(r.E,4240.57,2);
  near(r.F,0.40,6);
});

test('2026 : production, taux, facture et économie batterie',{skip},()=>{
  const r=row(run(),2026);
  near(r.E,8369.94,2);
  near(r.F,0.578281,6);
  near(r.M,1903.93,2);
  near(r.P,230.55,2);
});

test('2027 : capacité batterie et plafond d\'autoconsommation',{skip},()=>{
  const r=row(run(),2027);
  near(r.capB,15.2064,4);
  near(r.F,0.90,6);
});

test('retour sur investissement',{skip},()=>{
  const p=run();
  assert.equal(p.payB,2038);
  assert.equal(p.payA,2040);
});

test('retour avec un prix qui augmente de 3 % par an',{skip},()=>{
  assert.equal(run({priceGrowth:0.03}).payA,2037);
});
