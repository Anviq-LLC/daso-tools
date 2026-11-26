import type {TeamMember} from './types';
export type NuDirectory={companies:{id:string;name:string;aliases?:string[];archived?:boolean}[];workers:{companyId:string;name:string;role?:string;archived?:boolean}[];projectAgreements:{companyId:string;projectId?:string|null;allProjects?:boolean;fitterRateCents?:number|null;foremanRateCents?:number|null}[]};
const key=(v:string)=>v.trim().normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
// A firm's people and rates as the Nachunternehmer tool holds them; a project agreement wins over the all-projects rate.
export function nuTeam(dir:NuDirectory,firm:string,planProjectId:string):{companyId:string;name:string;members:TeamMember[]}|null{
 const company=dir.companies.find(c=>!c.archived&&[c.name,...(c.aliases||[])].some(n=>key(n)===key(firm)));if(!company)return null;
 const own=dir.projectAgreements.filter(a=>a.companyId===company.id),agreement=own.find(a=>!a.allProjects&&a.projectId===planProjectId)??own.find(a=>a.allProjects);
 const members=dir.workers.filter(w=>w.companyId===company.id&&!w.archived&&w.name.trim()).map(w=>{const role=/ober|foreman/i.test(w.role||'')?'foreman' as const:'fitter' as const,cents=role==='foreman'?agreement?.foremanRateCents:agreement?.fitterRateCents;return{name:w.name.trim(),role,hourlyRate:cents??null};});
 return{companyId:company.id,name:company.name,members};
}
// Members and rates follow the Nachunternehmer tool; a rate it has not set yet keeps what the project already had.
export function applyNuTeam<T extends {members?:TeamMember[];employees?:[string,string];hourlyRate?:number|null;nuId?:string}>(team:T,nu:{companyId:string;members:TeamMember[]},current:TeamMember[]):T{
 if(!nu.members.length)return team;
 return{...team,nuId:nu.companyId,members:nu.members.map(m=>({...m,hourlyRate:m.hourlyRate??current.find(c=>c.name===m.name)?.hourlyRate??null}))};
}
