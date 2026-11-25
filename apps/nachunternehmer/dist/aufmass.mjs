import {canonicalFirm,isoWeek} from './core.mjs';
const value=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))?Number(n):null;
export function normalizeSource(rows,{detailed=false}={}){
 const seen=new Map();
 return rows.filter(r=>r.source!=='own'&&r.firm&&r.project&&/^\d{4}-\d{2}-\d{2}$/.test(r.day)).map((r,i)=>{
  const id=detailed?String(r.sourceId||''):String(r.sourceId||`summary:${i}`);
  if(detailed&&!id)throw Error('Aufmaßzeile ohne sourceId');
  const row={id,day:r.day,firm:canonicalFirm(r.firm),originalFirm:r.firm,project:r.project,projectId:r.projectId||null,team:detailed?r.team||null:null,reportId:detailed?r.reportId||null:null,minutes:detailed?value(r.minutes):null,persons:detailed?value(r.persons):null,fitterMinutes:detailed?value(r.fitterMinutes):null,foremanMinutes:detailed?value(r.foremanMinutes):null,revenueCents:detailed?value(r.revenueCents):value(r.revenue_eur)===null?null:Math.round(Number(r.revenue_eur)*100),costCents:detailed?value(r.costCents):value(r.cost_eur)===null?null:Math.round(Number(r.cost_eur)*100),binding:Number(r.binding)===1,estimated:detailed?Number(r.estimated)!==0:false,detailed};
  if(row.minutes!==null&&row.minutes<0)throw Error('Negative Aufmaßstunden');
  if(detailed&&seen.has(id)){if(JSON.stringify(seen.get(id))!==JSON.stringify(row))throw Error('Widersprüchliche sourceId');return null;}seen.set(id,row);return row;
 }).filter(Boolean);
}
export const knownSum=(rows,key)=>rows.length&&rows.every(r=>r[key]!==null)?rows.reduce((s,r)=>s+r[key],0):null;
export function sourceGroups(rows,week,project='',firm=''){
 const map=new Map();for(const row of rows){if(!row.binding||isoWeek(row.day)!==week||(project&&row.project!==project)||(firm&&row.firm!==firm))continue;
 if(row.minutes===null&&row.revenueCents===null&&row.costCents===null)continue;
 const key=JSON.stringify([row.project,row.firm]);if(!map.has(key))map.set(key,{project:row.project,firm:row.firm,rows:[]});map.get(key).rows.push(row);}
 return [...map.values()].map(g=>({...g,minutes:knownSum(g.rows,'minutes'),costCents:knownSum(g.rows,'costCents'),revenueCents:knownSum(g.rows,'revenueCents'),printable:g.rows.every(r=>r.minutes!==null&&r.team&&!r.estimated)&&g.rows.some(r=>r.minutes>0)})).sort((a,b)=>a.project.localeCompare(b.project,'de')||a.firm.localeCompare(b.firm,'de'));
}
// Nur die ausdrücklich bestätigte Firma vereinigen; IDs und alle verknüpften Unterlagen behalten.
export function mergeKompanets(state){
 const s=structuredClone(state),matches=(s.companies||[]).filter(c=>canonicalFirm(c.name)==='Oleksii Kompanets');if(!matches.length)return s;
 const target=matches.find(c=>c.name==='Oleksii Kompanets')||matches[0],ids=new Set(matches.map(c=>c.id));target.name='Oleksii Kompanets';if(matches.length>1){const prior=matches.flatMap(c=>c.aliasRecords||[]),records=matches.map(c=>Object.fromEntries(Object.entries(c).filter(([k])=>k!=='aliasRecords')));target.aliasRecords=[...prior,...records];}
 for(const c of matches)for(const[k,v]of Object.entries(c))if(k!=='id'&&k!=='name'&&(target[k]===null||target[k]===undefined||target[k]==='')&&v!==null&&v!==undefined)target[k]=v;
 for(const list of ['workers','teams','docs','rows','projectAgreements'])for(const r of s[list]||[])if(ids.has(r.companyId))r.companyId=target.id;
 for(const r of Object.values(s.invoiceReviews||{}))if(ids.has(r.companyId)){r.companyId=target.id;r.companyName='Oleksii Kompanets';}
 for(const r of s.retentionReleases||[])if(ids.has(r.companyId)){r.companyId=target.id;r.companyName='Oleksii Kompanets';}
 // Legacy Freigaben bleiben archiviert; neue Aufmaß-Abrechnung verwendet eigenen Namensraum.
 s.companies=s.companies.filter(c=>!ids.has(c.id)||c.id===target.id);return s;
}

// /api/sub-teams liefert laut aktuellem API-Code ausschließlich verbindliche subB-Daten.
// Keine Einzelaufmaß-IDs: stabiler Schlüssel auf der tatsächlich gelieferten Aggregationsebene.
export function subTeamsExport(months,fetchedAt){
 const rows=[];
 for(const[month,entries]of Object.entries(months)){
  if(!Array.isArray(entries))throw Error('Ungültige Teamantwort');
  for(const r of entries){
   if(!r.day?.startsWith(month+'-')||!r.subcontractor||!r.project||!r.team)throw Error('Teamzeile unvollständig');
   const hours=value(r.hours),persons=value(r.persons);
   if(hours!==null&&hours<0)throw Error('Negative Stunden');
   rows.push({sourceId:JSON.stringify(['sub-teams',r.day,r.project,r.subcontractor,r.team]),day:r.day,firm:r.subcontractor,project:r.project,projectId:r.projectId||null,team:r.team,minutes:hours===null?null:Math.round(hours*60),persons,fitterMinutes:value(r.fitterHours)===null?null:Math.round(Number(r.fitterHours)*60),foremanMinutes:value(r.foremanHours)===null?null:Math.round(Number(r.foremanHours)*60),revenueCents:value(r.revenueEur)===null?null:Math.round(Number(r.revenueEur)*100),costCents:value(r.costEur)===null?null:Math.round(Number(r.costEur)*100),binding:1,estimated:r.estimated===false?0:1});
  }
 }
 // Widersprüchliche Schlüssel dürfen den aktuellen Bestand nicht ersetzen.
 normalizeSource(rows,{detailed:true});
 return{schemaVersion:1,complete:true,fetchedAt,source:'/api/sub-teams',months:Object.keys(months).sort(),rows};
}
export function sourceReadReport(rows,checks={}){
 const months=[...new Set(rows.map(r=>r.day.slice(0,7)))].sort();
 return months.map(month=>{const rr=rows.filter(r=>r.day.startsWith(month)),subCents=knownSum(rr,'revenueCents'),costCents=knownSum(rr,'costCents'),check=checks[month]||{},companyCostCents=Array.isArray(check.subs)?Math.round(check.subs.reduce((s,r)=>s+Number(r.costEur||0),0)*100):null;return{month,subCents,costCents,companyCostCents,companyCostDiffCents:companyCostCents===null||costCents===null?0:companyCostCents-costCents,revenueMatchesSummary:check.summary?subCents===Math.round(check.summary.subRevenueEur*100):null};});
}
