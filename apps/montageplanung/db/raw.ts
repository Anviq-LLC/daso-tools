import { env } from 'cloudflare:workers';
import type { NuFirms } from '@/lib/nu-firms';
export function db(): D1Database { if(!env.DB) throw new Error('Datenbank nicht verfügbar'); return env.DB; }
// Read-only view of the nachunternehmer tool's firm list. Any failure counts as "switch off", so planning is never blocked by it.
export async function readNuFirms(): Promise<NuFirms> {
  const off: NuFirms = { master: false, firms: [] }
  try {
    const nu = env.NU_DB
    if (!nu) return off
    const flag = await nu.prepare("SELECT json_extract(data,'$.settings.nuMaster') AS m FROM state WHERE id = 'main'").first<{ m: number | null }>()
    if (!flag?.m) return off
    const rows = (await nu.prepare("SELECT json_extract(c.value,'$.name') AS name, json_extract(c.value,'$.aliases') AS aliases, json_extract(c.value,'$.archived') AS archived FROM state s, json_each(json_extract(s.data,'$.companies')) c WHERE s.id = 'main'").all<{ name: string | null; aliases: string | null; archived: number | null }>()).results
    return { master: true, firms: rows.filter((r) => r.name && !r.archived).map((r) => ({ name: r.name as string, aliases: r.aliases ? (JSON.parse(r.aliases) as string[]) : [] })) }
  } catch { return off }
}
// Read-only view of the Mitarbeiter tool. It counts only once its switch is on; any failure means "not in charge".
export type MaEmployees = { master: boolean; employees: { id: string; name: string; role: string; archived_at: string | null }[] }
export async function readMitarbeiter(): Promise<MaEmployees> {
  const off: MaEmployees = { master: false, employees: [] }
  try {
    const ma = env.MA_DB
    if (!ma) return off
    const flag = await ma.prepare("SELECT value FROM settings WHERE key = 'master'").first<{ value: string }>()
    if (flag?.value !== '1') return off
    return { master: true, employees: (await ma.prepare('SELECT id, name, role, archived_at FROM employees').all<MaEmployees['employees'][number]>()).results }
  } catch { return off }
}
export function bucket(): R2Bucket { if(!env.BUCKET) throw new Error('Dateispeicher nicht verfügbar'); return env.BUCKET; }
// Bumped after every write so idle clients can skip the full reload. Table is created on first write.
export async function dataVersion():Promise<number|null>{try{return (await db().prepare('SELECT v FROM data_version WHERE id=1').first<{v:number}>())?.v??null}catch{return null}}
export async function bumpVersion(res:Response):Promise<Response>{
  if(res.ok){const d=db();try{await d.batch([d.prepare('CREATE TABLE IF NOT EXISTS data_version(id INTEGER PRIMARY KEY, v INTEGER NOT NULL)'),d.prepare('INSERT INTO data_version(id,v) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET v=v+1')])}catch(e){console.error(e)}}
  return res;
}
export type AccessRole='planer'|'obermonteur'|'monteur'|'buchhaltung';
export type CurrentUser={id:string;email:string;name:string;accessRole:AccessRole;resourceId:string|null};
export async function currentUser(r:Request):Promise<CurrentUser|null>{
  const email=r.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
  if(!email) return null;
  const row=await db().prepare('SELECT u.* FROM users u LEFT JOIN resources r ON r.id=u.resource_id WHERE u.email=? AND r.archived_at IS NULL').bind(email).first<any>();
  if(!row) return null;
  return {id:row.id,email:row.email,name:row.name,accessRole:row.access_role,resourceId:row.resource_id};
}
