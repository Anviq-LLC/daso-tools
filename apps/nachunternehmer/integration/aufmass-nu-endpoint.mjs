// Einbau NACH bestehender API-Key-Prüfung. db = readOnly(env.DB).
// Kein eigener Worker und keine Änderung bestehender Views/SQL-Freigaben.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDate=s=>DAY.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export async function readAufmassNu(request,db){
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method!=='GET')return reply({error:'Nur GET erlaubt'},405);
 const u=new URL(request.url),from=u.searchParams.get('from')||'',to=u.searchParams.get('to')||'';
 const length=(Date.parse(to)-Date.parse(from))/86400000;
 if(!validDate(from)||!validDate(to)||length<=0||length>366)return reply({error:'from/to: gültiger Zeitraum bis 366 Tage, to exklusiv'},400);
 // Alle NULL-Werte bleiben unbekannt. Ausschließlich vorhandene NU-Aufmaß-Fakten.
 const result=await db.prepare(`SELECT day, project_id, label, firm, team, report_id, binding, estimated,
 SUM(customer_cents) AS revenue_cents,
 CASE WHEN COUNT(cost_cents)=COUNT(*) THEN SUM(cost_cents) ELSE NULL END AS cost_cents,
 CASE WHEN COUNT(hours_minutes)=COUNT(*) THEN SUM(hours_minutes) ELSE NULL END AS minutes
 FROM fact_sub WHERE day>=? AND day<?
 GROUP BY day, project_id, label, firm, team, report_id, binding, estimated
 ORDER BY day, project_id, firm, team, report_id LIMIT 10001`).bind(from,to).all();
 if(!result.success)return reply({error:'Aufmaßdaten nicht lesbar'},502);
 if(result.results.length>10000)return reply({error:'Zeitraum verkleinern; keine Teilübernahme'},413);
 const rows=result.results.map(r=>({sourceId:JSON.stringify([r.day,r.project_id,r.label,r.firm,r.team,r.report_id,r.binding,r.estimated]),day:r.day,projectId:r.project_id,project:r.label,firm:r.firm,team:r.team||null,reportId:r.report_id,minutes:r.minutes,revenueCents:r.revenue_cents,costCents:r.cost_cents,binding:r.binding,estimated:r.estimated}));
 return reply({schemaVersion:1,complete:true,from,to,fetchedAt:new Date().toISOString(),source:'Aufmaß via fact_sub',rows});
}
