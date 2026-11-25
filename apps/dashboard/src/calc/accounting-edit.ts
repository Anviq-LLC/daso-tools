import { bwaMetrics, type AccountingReport, type BwaRow } from './accounting-pdf.ts';

export const bwaColumns = [
  { key: 'month', label: 'Monat' },
  { key: 'ytd', label: 'Seit Jahresbeginn' },
  { key: 'prior', label: 'Vorjahresmonat' },
] as const;

export type BwaDraftRow = Record<(typeof bwaColumns)[number]['key'], string>;
type BwaReport = Extract<AccountingReport, {kind:'bwa'}>;

const euroInput = new Intl.NumberFormat('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2});

export function bwaDraft(rows:BwaRow[]):BwaDraftRow[]{
  const format=(value:number|null)=>value===null?'':euroInput.format(value/100);
  return rows.map(({month,ytd,prior})=>({month:format(month),ytd:format(ytd),prior:format(prior)}));
}

export function correctedBwa<T extends BwaReport>(report:T,draft:BwaDraftRow[]):T{
  const rows=report.rows.map((row,index)=>{
    const updated={...row};
    for(const {key,label} of bwaColumns){
      const input=draft[index][key].trim().replace(/^−/u,'-');
      if(input===''){
        updated[key]=null;
        continue;
      }
      const parts=input.match(/^([+-]?)(\d+|\d{1,3}(?:[.\u00a0\u202f ]\d{3})+)(?:,(\d{1,2}))?$/u);
      if(!parts)throw new Error(`„${row.label}“, Spalte „${label}“: Bitte einen Betrag wie −1.234,56 eingeben.`);
      const [,sign,whole,decimal='']=parts;
      const cents=Number(whole.replace(/\D/g,'')+decimal.padEnd(2,'0'));
      if(!Number.isSafeInteger(cents))throw new Error(`„${row.label}“, Spalte „${label}“: Der Betrag ist zu groß.`);
      updated[key]=sign==='-'&&cents!==0?-cents:cents;
    }
    return updated;
  });
  const {revenue,...metrics}=bwaMetrics(rows);
  if(revenue===null)throw new Error('Bitte die Umsatzerlöse in der Spalte „Monat“ eintragen.');
  return {...report,rows,revenue,...metrics};
}
