import { format } from 'date-fns';
type P={resource_id:string;project_id:string|null;started:string;ended:string|null;pause:number|null};
type A={resource_id:string;project_id:string|null;day:string;assignment_type:string};
export const absentTypes=['vacation','unpaid','sick'];
const hrs=(a:string,b:string,pause=0)=>Math.max(0,(Date.parse(b)-Date.parse(a))/3600000-pause/60);
const hm=(s:string)=>format(new Date(s),'HH:mm');
export const meal=(type:string,absenceHours:number)=>absentTypes.includes(type)?0:absenceHours>=24?28:absenceHours>=8?14:0;

const easter=(y:number)=>{const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,k=c%4,l=(32+2*(b%4)+2*Math.floor(c/4)-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;return Date.UTC(y,Math.floor(n/31)-1,n%31+1)};
// Public holidays of Rheinland-Pfalz; returns the name or ''.
export function holiday(day:string){const y=day.slice(0,4),e=easter(+y),off=(n:number)=>new Date(e+n*864e5).toISOString().slice(0,10);
  const names:Record<string,string>={[y+'-01-01']:'Neujahr',[off(-2)]:'Karfreitag',[off(1)]:'Ostermontag',[y+'-05-01']:'Tag der Arbeit',[off(39)]:'Christi Himmelfahrt',[off(50)]:'Pfingstmontag',[off(60)]:'Fronleichnam',[y+'-10-03']:'Tag der Deutschen Einheit',[y+'-11-01']:'Allerheiligen',[y+'-12-25']:'1. Weihnachtstag',[y+'-12-26']:'2. Weihnachtstag'};
  return names[day]||''}
// Working time is capped at 10 h per day (holiday credit of 8 h comes on top) unless a note gives the reason.
export const capWork=(h:string|number|undefined,notes:string|undefined,hol:string)=>{const max=hol?18:10;return Number(h)>max&&!(notes||'').trim()?max.toFixed(2):h};
export const toHm=(v:unknown)=>{if(v===''||v==null||isNaN(Number(v)))return '';const m=Math.round(Number(v)*60);return `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`};
// "7:30" or plain hours ("7,5") to a decimal-hours string; null when invalid.
export const fromHm=(s:string)=>{const t=s.trim();if(!t)return '';const m=/^(\d{1,3}):([0-5]\d)$/.exec(t);if(m)return ((+m[1]*60+ +m[2])/60).toFixed(2);const n=Number(t.replace(',','.'));return isNaN(n)||n<0?null:n.toFixed(2)};

// Derives one day of the timesheet from punches. Stamps without a project are travel;
// absence runs from the first travel stamp to the last stamp-out of the day.
export function dayInfo(assignments:A[],punches:P[],resourceId:string,day:string){
  const a=assignments.find(x=>x.resource_id===resourceId&&x.day===day);
  const type=a?.assignment_type||'';
  const ps=punches.filter(x=>x.resource_id===resourceId&&x.ended&&format(new Date(x.started),'yyyy-MM-dd')===day).sort((x,y)=>x.started.localeCompare(y.started));
  const travel=ps.filter(p=>!p.project_id),work=ps.filter(p=>p.project_id);
  const sum=(l:P[])=>l.reduce((n,p)=>n+hrs(p.started,p.ended!,p.pause||0),0);
  const lastEnd=ps.reduce((m,p)=>p.ended!>m?p.ended!:m,'');
  const away=absentTypes.includes(type);
  const hol=holiday(day),wd=new Date(day+'T00:00:00').getDay(),credit=!!hol&&wd>0&&wd<6&&!away;
  return {
    type,
    holiday:hol,
    projectId:work[0]?.project_id||a?.project_id||null,
    travelStart:travel.length?hm(travel[0].started):'',
    travelEnd:travel.length?hm(lastEnd):'',
    travelHours:travel.length?sum(travel).toFixed(2):'',
    absence:away?'0':travel.length?hrs(travel[0].started,lastEnd).toFixed(2):'',
    workStart:work.length?hm(work[0].started):'',
    workEnd:work.length?hm(work.reduce((m,p)=>p.ended!>m?p.ended!:m,'')):'',
    pause:work.some(p=>p.pause)?String(work.reduce((n,p)=>n+(p.pause||0),0)):'',
    workHours:away?'8.00':credit?(8+sum(work)).toFixed(2):work.length?sum(work).toFixed(2):'',
  };
}
