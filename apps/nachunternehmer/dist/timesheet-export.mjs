import {PDFDocument,StandardFonts,rgb} from './vendor/pdf-lib.min.mjs';
const safe=s=>String(s??'').replace(/[^\x20-\x7e\xa0-\xff]/g,'-');
function wrapNote(text,font,size,width){
 const lines=[];
 for(const paragraph of text.split(/\r\n?|\n/).map(safe)){
  let current='';
  for(const character of paragraph){
   if(current&&font.widthOfTextAtSize(current+character,size)>width){
    const split=current.lastIndexOf(' ');
    lines.push(split>0?current.slice(0,split):current);
    current=split>0?current.slice(split+1):'';
   }
   current+=character;
  }
  lines.push(current);
 }
 return lines;
}
export function sheetFilename({firm,project,week},index=0){const [year,kw]=week.split('-W');const clean=s=>String(s??'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\s+/g,'_');return `KW_${kw}_${year}_${clean(firm).slice(0,70)}_${clean(project).slice(0,100)}${index?'_'+(index+1):''}.pdf`;}
export async function timesheetPdf(sheet){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);let page,y;const next=()=>{page=pdf.addPage([595.28,841.89]);y=795;};next();const line=(text,size=10,strong=false)=>{if(y<55)next();page.drawText(safe(text),{x:40,y,size,font:strong?bold:font,color:rgb(.12,.18,.25)});y-=size+9;};const euro=c=>c===null?'Offen':(c/100).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' EUR';line('DaSo Lueftungsbau GmbH',15,true);line('WOCHENSTUNDENZETTEL - '+sheet.week,13,true);line('Nachunternehmer: '+sheet.firm);for(let i=0;i<sheet.project.length;i+=85)line((i?'':'Projekt: ')+sheet.project.slice(i,i+85));line('Zeitraum: '+sheet.period);y-=10;line('Datum       Team                       Stunden       Kosten',10,true);for(const r of sheet.rows){const team=safe(r.team||'Team');line(`${r.day||r.date}   ${team.slice(0,24).padEnd(25)}   ${r.minutes===null?'Offen':(r.minutes/60).toLocaleString('de-DE')} Std.   ${euro(r.costCents)}`);if(r.estimated)line('Geschaetzter Tages-/Teamwert',8);if(r.edited)line('Manuell bearbeitet',8);}y-=10;line('Erfasste Stunden: '+(sheet.minutes===null?'Offen':(sheet.minutes/60).toLocaleString('de-DE')),11,true);if(sheet.adjustmentTitle)line(sheet.adjustmentTitle,10,true);for(const a of sheet.adjustments||[])line(a);if(sheet.adjustmentNote)for(const note of wrapNote('Notiz: '+sheet.adjustmentNote,font,9,510))line(note,9);line('Wochenpauschale netto: '+euro(sheet.costCents),12,true);line('Hiermit werden die aufgefuehrten Teamstunden bestaetigt.');line('Fehlende Angaben bleiben offen und sind nicht als Null bestaetigt.',9);return pdf.save();}
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
export function zipFiles(files){const encoder=new TextEncoder(),parts=[],central=[];let offset=0;const header=(len)=>{const b=new Uint8Array(len);return[b,new DataView(b.buffer)];};for(const f of files){const name=encoder.encode(f.name),data=new Uint8Array(f.bytes),crc=crc32(data);const[b,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);parts.push(b,name,data);const[c,w]=header(46);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);central.push(c,name);offset+=30+name.length+data.length;}const size=central.reduce((s,b)=>s+b.length,0),[end,v]=header(22);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);const out=new Uint8Array(offset+size+22);let p=0;for(const b of [...parts,...central,end]){out.set(b,p);p+=b.length;}return out;}
