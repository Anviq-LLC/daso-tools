const kompanetsAliases=new Set(['olexii kompanets','olexi kompanets','oleksii kompanets','olexi compartments']);
export const canonicalFirm=s=>kompanetsAliases.has(String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('de-DE'))?'Oleksii Kompanets':s;
export const addDays=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
export function weekStart(week){const [y,w]=week.split('-W').map(Number);const jan4=new Date(Date.UTC(y,0,4,12));jan4.setUTCDate(jan4.getUTCDate()-(jan4.getUTCDay()+6)%7+(w-1)*7);return jan4.toISOString().slice(0,10)}
export function isoWeek(iso){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+3-(d.getUTCDay()+6)%7);const y=d.getUTCFullYear();const j=new Date(Date.UTC(y,0,4,12));const w=1+Math.round(((d-j)/86400000-3+(j.getUTCDay()+6)%7)/7);return `${y}-W${String(w).padStart(2,'0')}`}
export const daysFor=week=>Array.from({length:7},(_,i)=>addDays(weekStart(week),i));
export const rowHours=r=>r.hours.reduce((a,b)=>a+Number(b||0),0);
export const rowCents=r=>r.hours.reduce((a,h,i)=>a+Math.round(Number(h||0)*Math.round(r.rate*100)),0);
export const totalCents=rows=>rows.reduce((a,r)=>a+rowCents(r),0);
export const totals=rows=>({hours:rows.reduce((a,r)=>a+rowHours(r),0),cents:totalCents(rows),workers:new Set(rows.map(r=>r.workerId)).size});
export function aggregate(rows){const map=new Map();for(const r of rows){const k=r.project;if(!map.has(k))map.set(k,{project:k,revenue:0,cost:0,days:new Set(),firms:new Set()});const v=map.get(k);if(r.revenue_eur==null)v.missingRevenue=true;else v.revenue+=Math.round(r.revenue_eur*100);if(r.cost_eur===null||r.cost_eur===undefined)v.missingCost=true;else v.cost+=Math.round(r.cost_eur*100);v.days.add(r.day);v.firms.add(canonicalFirm(r.firm))}return [...map.values()].map(v=>({...v,profit:v.revenue-v.cost}));}
export function expiryState(validUntil,today,days=14){if(!validUntil)return 'missing';const delta=Math.round((new Date(validUntil+'T12:00:00Z')-new Date(today+'T12:00:00Z'))/86400000);return delta<0?'expired':delta<=days?'soon':'valid'}
export function extractExpiry(text){const patterns=[/(?:gültig\s*(?:bis|zum)|gilt\s*bis|befristet\s*bis|bis\s*(?:zum|einschließlich))[\s:–-]*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/giu,/(?:gültig\s*(?:bis|zum)|gilt\s*bis)[\s:–-]*(\d{4})-(\d{2})-(\d{2})/giu];const found=[];patterns.forEach((p,i)=>{for(const m of text.matchAll(p)){const d=i?`${m[1]}-${m[2]}-${m[3]}`:`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;const dt=new Date(d+'T12:00:00Z');if(!isNaN(dt)&&dt.toISOString().slice(0,10)===d)found.push(d)}});const u=[...new Set(found)];return u.length===1?u[0]:null}
export const csvCell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
export function settlement(rows,adjustment={}){const baseCents=totalCents(rows),adjustmentHours=Number(adjustment?.hours||0),adjustmentCents=Math.round(adjustmentHours*Math.round(Number(adjustment?.rate||0)*100));return{baseCents,adjustmentHours,adjustmentCents,totalCents:baseCents+adjustmentCents};}

