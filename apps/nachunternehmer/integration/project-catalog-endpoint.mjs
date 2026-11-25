// Nach vorhandener API-Key-Prüfung aufrufen. PLAN ausschließlich lesend verwenden.
// Benötigte zusätzliche D1-Bindung siehe Projektstamm.md. Keine Änderungen an Datenbank/SQL-Guard.
export async function readProjectCatalog(request,planningReadOnlyDb){
 if(request.method!=='GET')return Response.json({error:'Nur GET erlaubt'},{status:405});
 const data=await planningReadOnlyDb.prepare('SELECT id,name,project_number,address,archived_at FROM projects ORDER BY sort_order,name').all();if(!data.success)return Response.json({error:'Projektkatalog nicht lesbar'},{status:502});
 return Response.json({source:'montageplanung',fetchedAt:new Date().toISOString(),projects:data.results.map(r=>({id:r.id,name:r.name,number:r.project_number||'',label:[r.project_number,r.name].filter(Boolean).join(' '),address:r.address||'',archived:!!r.archived_at}))},{headers:{'Cache-Control':'no-store'}});
}
