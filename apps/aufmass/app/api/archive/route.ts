import {identity,canPurge} from '@/lib/auth';
import {db,bucket} from '@/db/raw';
import type {Report,StoredFile} from '@/lib/types';

type Archived={report:Report;files:StoredFile[];reason:string;user:string;at:string};
const fail=(e:unknown,status=400)=>Response.json({error:e instanceof Error?e.message:'Aktion fehlgeschlagen.'},{status});

// Aufmaße that were deleted with a reason stay here until a person on the purge list removes them for good.
export async function GET(request:Request){
 try{
  await identity(request);
  const project=new URL(request.url).searchParams.get('project')||'';
  if(!project)throw Error('Bitte ein Projekt auswählen.');
  const rows=(await db().prepare("SELECT id,data FROM records WHERE project_id = ? AND kind = 'deletedreport'").bind(project).all<{id:string;data:string}>()).results;
  const archive=rows.map(r=>{const v=JSON.parse(r.data) as Archived;return{id:r.id,date:v.report.date,endDate:v.report.endDate,team:v.report.team,reason:v.reason,user:v.user,at:v.at,files:v.files.length};}).sort((a,b)=>b.at.localeCompare(a.at));
  return Response.json({archive},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return fail(e);}
}

export async function POST(request:Request){
 try{
  const user=await identity(request);
  if(!canPurge(user))return fail(Error('Endgültig löschen dürfen nur freigeschaltete Personen.'),403);
  const b=await request.json() as {projectId?:string;id?:string};
  if(!b.projectId||!b.id?.startsWith('deleted:'))throw Error('Eintrag nicht gefunden.');
  const row=await db().prepare("SELECT data FROM records WHERE id = ? AND project_id = ? AND kind = 'deletedreport'").bind(b.id,b.projectId).first<{data:string}>();
  if(!row)throw Error('Eintrag nicht gefunden.');
  const v=JSON.parse(row.data) as Archived,keys=v.files.flatMap(f=>[f.key,f.original?.key]).filter((k):k is string=>!!k);
  await db().batch([
   db().prepare("DELETE FROM records WHERE id = ? AND project_id = ? AND kind = 'deletedreport'").bind(b.id,b.projectId),
   db().prepare('INSERT INTO audit (id,project_id,action,user,detail,at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),b.projectId,'purgeReport',user.email||user.name,`${v.report.date} · ${v.report.team} · endgültig gelöscht (Grund: ${v.reason})`,new Date().toISOString()),
  ]);
  await Promise.all(keys.map(k=>bucket().delete(k).catch(()=>{})));
  return Response.json({ok:true});
 }catch(e){return fail(e);}
}
