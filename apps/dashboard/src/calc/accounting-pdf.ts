type PdfTextItem = { str?:string; transform?:number[]; width?:number };
type Cell = { text:string; x:number; right:number; y:number };
type Row = Cell[];
export type BwaRow = { label:string; month:number|null; ytd:number|null; prior:number|null };
export type SusaRow = { account:string; label:string; opening:number|null; debit:number; credit:number; ytdDebit:number|null; ytdCredit:number|null; balance:number|null };
export type AccountingReport =
  | {kind:'bwa';period:string;rows:BwaRow[];revenue:number;operating:number|null;beforeTax:number|null;result:number|null}
  | {kind:'susa';period:string;rows:SusaRow[]};

const months=['januar','februar','märz','april','mai','juni','juli','august','september','oktober','november','dezember'];
const short=['jan','feb','mär','apr','mai','jun','jul','aug','sep','okt','nov','dez'];
const word=String.raw`([\p{L}]+)\.?\s+(20\d{2})`;
const moneyPattern=/^(?<leading>[+-])?\s*(?<digits>(?:\d{1,3}(?:[. ]\d{3})+|\d+),\d{2})\s*(?<trailing>[+SH-])?$/i;
const signPattern=/^[+−‒–—﹣－-]$/u;
const normalized=(text:string)=>text.toLowerCase().normalize('NFC').trim();
export function bwaMetrics(rows:BwaRow[]){
  const metric=(pattern:RegExp)=>rows.find(row=>row.month!==null&&pattern.test(row.label.replace(/\s+/g,' ').trim()))?.month??null;
  return {revenue:metric(/^Umsatzerlöse$/i),operating:metric(/^Betriebsergebnis$/i),beforeTax:metric(/^Ergebnis vor Steuern$/i),result:metric(/^Vorläufiges Ergebnis$/i)};
}

function euros(text:string){
  const input=text.trim().replace(/[−‒–—﹣－]/gu,'-').replace(/[\u00a0\u202f]/gu,' ');
  const parentheses=input.startsWith('(')&&input.endsWith(')');
  const groups=(parentheses?input.slice(1,-1).trim():input).match(moneyPattern)?.groups;
  if(!groups||groups.leading&&groups.trailing)return null;
  const cents=Number(groups.digits.replace(/[. ,]/g,''));
  return parentheses||groups.leading==='-'||/^[H-]$/i.test(groups.trailing??'')?-cents:cents;
}
function periodFrom(text:string){
  const found=text.match(new RegExp('(?:per |Erfolgsrechnung |Saldenliste )'+word,'iu'));
  if(!found)throw new Error('Der Berichtsmonat konnte im PDF nicht erkannt werden.');
  const name=normalized(found[1]);
  const month=months.includes(name)?months.indexOf(name):short.indexOf(name);
  if(month<0)throw new Error('Der Berichtsmonat konnte im PDF nicht erkannt werden.');
  return found[2]+'-'+String(month+1).padStart(2,'0');
}
function textRows(items:PdfTextItem[]):Row[]{
  const rows:Row[]=[];
  const cells=items.flatMap(item=>item.str?.trim()&&item.transform?
    [{text:item.str.trim(),x:item.transform[4],right:item.transform[4]+(item.width??0),y:item.transform[5]}]:[]);
  cells.sort((a,b)=>b.y-a.y);
  for(const cell of cells){
    const row=rows.at(-1);
    if(row&&Math.abs(row[0].y-cell.y)<=1.8)row.push(cell);
    else rows.push([cell]);
  }
  return rows.map(row=>row.sort((a,b)=>a.x-b.x));
}
const rowText=(row:Row)=>row.map(cell=>cell.text).join(' ');
function moneyAt(row:Row,anchor:number|null){
  if(anchor===null)return null;
  for(let index=0;index<row.length;index++){
    const cell=row[index], value=euros(cell.text);
    if(value===null)continue;
    const next=row[index+1], previous=row[index-1];
    if(next&&signPattern.test(next.text)&&Math.abs(next.x-cell.right)<=5&&Math.abs(next.right-anchor)<=3){
      return euros(cell.text+next.text);
    }
    if(Math.abs(cell.right-anchor)>3)continue;
    if(previous&&signPattern.test(previous.text)&&Math.abs(cell.x-previous.right)<=5){
      return euros(previous.text+cell.text);
    }
    return value;
  }
  return null;
}
function rightColumns(rows:Row[]){
  const ends=rows.flatMap(row=>row.filter(cell=>euros(cell.text)!==null).map(cell=>cell.right)).sort((a,b)=>a-b);
  const clusters:{right:number;count:number}[]=[];
  for(const right of ends){
    const last=clusters.at(-1);
    if(last&&right-last.right<=2){last.right=(last.right*last.count+right)/(++last.count);}
    else clusters.push({right,count:1});
  }
  return clusters.filter(c=>c.count>=2).map(c=>c.right);
}
const findColumn=(columns:number[],near:number)=>columns.filter(x=>Math.abs(x-near)<=30).sort((a,b)=>Math.abs(a-near)-Math.abs(b-near))[0]??null;

function bwa(period:string,pages:Row[][]):AccountingReport{
  const month=Number(period.slice(5))-1, year=Number(period.slice(0,4));
  const isMonth=(text:string,y:number)=>[months[month],short[month],...(month===2?['mrz']:[])].some(m=>[m+' '+y,m+'. '+y].includes(normalized(text)));
  const yearHeading=(text:string)=>/^Jan\s*[-–]/i.test(text)||/^\d{2}\.\d{2}\s*[-–]\s*\d{2}\.\d{2}$/.test(text);
  const header=pages[0].find(row=>row.some(c=>isMonth(c.text,year))&&row.some(c=>/Bezeichnung/i.test(c.text)||yearHeading(c.text)||isMonth(c.text,year-1)));
  const monthCell=header?.find(c=>isMonth(c.text,year));
  if(!header||!monthCell)throw new Error('Die BWA-Monatsspalte wurde nicht eindeutig erkannt.');
  const yearCell=header.find(c=>yearHeading(c.text));
  const priorCell=header.find(c=>isMonth(c.text,year-1));
  const rows=pages.flatMap(page=>page.flatMap(row=>{
    const monthValue=moneyAt(row,monthCell.right);
    const ytd=moneyAt(row,yearCell?.right??null),prior=moneyAt(row,priorCell?.right??null);
    const firstAmount=row.findIndex(cell=>euros(cell.text)!==null||signPattern.test(cell.text));
    const label=firstAmount>0?row.slice(0,firstAmount).map(cell=>cell.text).join(' '):'';
    return label&&row[0].x<monthCell.x-25&&euros(label)===null&&(monthValue!==null||ytd!==null||prior!==null)
      ? [{label,month:monthValue,ytd,prior}]:[];
  }));
  const {revenue,...metrics}=bwaMetrics(rows);
  if(revenue===null)throw new Error('In der BWA wurde kein eindeutiger Monatsumsatz gefunden.');
  return {kind:'bwa',period,rows,revenue,...metrics};
}

function susa(period:string,pages:Row[][]):AccountingReport{
  const headerIndex=pages[0].findIndex(row=>row.filter(c=>/^Soll$|^Haben$/i.test(c.text)).length===4);
  if(headerIndex<1)throw new Error('Die Soll- und Haben-Spalten der SuSa wurden nicht erkannt.');
  const rowsWithAccounts=pages.flatMap(page=>page.filter(row=>/^\d{3,8}(?:\s+\D|$)/.test(row[0]?.text??'')&&row.some(c=>euros(c.text)!==null)));
  const edges=rightColumns(rowsWithAccounts);
  const header=pages[0][headerIndex], headings=pages[0][headerIndex-1];
  const targets=header.filter(c=>/^Soll$|^Haben$/i.test(c.text)).map(c=>c.right);
  const opening= headings.find(c=>/Anfangsbestand|EB-Wert/i.test(c.text));
  const saldo= headings.find(c=>/^Saldo$/i.test(c.text));
  const [debit,credit,ytdDebit,ytdCredit]=targets.map(x=>findColumn(edges,x));
  if(debit===null||credit===null||debit===credit)throw new Error('Die Monatsspalten der SuSa sind nicht eindeutig.');
  const rows=rowsWithAccounts.flatMap(row=>{
    const numbered=row[0].text.match(/^(\d{3,8})(?:\s+(.+))?$/);
    if(!numbered)return [];
    const label=[numbered[2],...row.slice(1).filter(c=>c.right<debit-55&&euros(c.text)===null).map(c=>c.text)].filter(Boolean).join(' ');
    if(!label)return [];
    return [{account:numbered[1],label,opening:moneyAt(row,opening?findColumn(edges,opening.right):null),
      debit:moneyAt(row,debit)??0,credit:moneyAt(row,credit)??0,
      ytdDebit:moneyAt(row,ytdDebit),ytdCredit:moneyAt(row,ytdCredit),balance:moneyAt(row,saldo?findColumn(edges,saldo.right):null)}];
  });
  if(!rows.length)throw new Error('Es wurden keine SuSa-Konten erkannt.');
  return {kind:'susa',period,rows};
}

export function parseAccountingPdf(rawPages:PdfTextItem[][]):AccountingReport{
  const pages=rawPages.map(textRows);
  const title=pages[0]?.slice(0,9).map(rowText).join(' ')??'';
  const isBwa=/Kurzfristige Erfolgsrechnung/i.test(title);
  const isSusa=/Summen- und Saldenliste|Saldenliste Sachkonten/i.test(title);
  if(!isBwa&&!isSusa)throw new Error('Dieses PDF-Format konnte nicht erkannt werden. Benötigt wird ein Bericht mit lesbarem Text.');
  const period=periodFrom(title);
  return isBwa?bwa(period,pages):susa(period,pages);
}
