import type { AccountingMonth } from './accounting-history.ts';
import { adjustForWinterClosure, type YearPoint } from './forecast.ts';

type Month = {
  month:string; revenue:number|null; revenueThrough:string|null;
  book?:AccountingMonth;
};

const sum=(values:number[])=>values.reduce((total,value)=>total+value,0);
const average=(values:number[])=>values.length?Math.round(sum(values)/values.length):null;
const yearRevenueValues=(months:Month[])=>months.flatMap(row=>row.revenue===null?[]:[row.revenue]);

export function dashboardYear(months:Month[],today:string,runningForecast:number|null){
  const currentMonth=today.slice(0,7);
  const observed=months.filter(row=>row.month<=currentMonth);
  const values=yearRevenueValues(observed);
  const total=values.length?sum(values):null;
  const revenueThrough=observed.flatMap(row=>row.revenue!==null&&row.revenueThrough?[row.revenueThrough]:[]).sort().at(-1)??null;
  const current=observed.find(row=>row.month===currentMonth);
  const completed=yearRevenueValues(observed.filter(row=>row.month<currentMonth));
  const recordedForecast=current?(current.book?.revenue??runningForecast):null;
  const currentForecast=current?(recordedForecast??adjustForWinterClosure(currentMonth,average(completed))):null;
  const future=average(recordedForecast===null?completed:[...completed,recordedForecast]);
  const points=months.map(({month,revenue})=>{
    const kind:YearPoint['kind']=month===currentMonth&&current?.book?.revenue==null?'prognose':month>currentMonth?'hochrechnung':'ist';
    return {month,kind,revenue:kind==='prognose'?currentForecast:kind==='hochrechnung'?adjustForWinterClosure(month,future):revenue};
  });
  const yearForecast=current&&points.some(row=>row.revenue!==null)?sum(points.map(row=>row.revenue??0)):null;

  const books=observed.flatMap(row=>row.book?[row.book]:[]);
  const base=books.findLast(book=>book.beforeTaxYtd!=null);
  const individual=books.filter(book=>(!base||book.period>base.period)&&book.beforeTax!=null);
  const profitThrough=individual.at(-1)?.period??base?.period??null;
  const profit=profitThrough===null?null:(base?.beforeTaxYtd??0)+sum(individual.map(book=>book.beforeTax!));
  const estimatedTax=profit===null?null:Math.round(Math.max(profit,0)*0.3);
  const marginBase=books.findLast(book=>book.period<currentMonth&&book.beforeTaxYtd!=null&&book.revenueYtd!=null&&book.revenueYtd>0);
  const marginMonths=books.filter(book=>book.period<currentMonth&&(!marginBase||book.period>marginBase.period)&&book.beforeTax!=null&&book.revenue!=null);
  const marginRevenue=(marginBase?.revenueYtd??0)+sum(marginMonths.map(book=>book.revenue!));
  const margin=marginRevenue>0?((marginBase?.beforeTaxYtd??0)+sum(marginMonths.map(book=>book.beforeTax!)))/marginRevenue:null;
  const currentProfit=current?.book?.beforeTax??(currentForecast!==null&&margin!==null?Math.round(currentForecast*margin):null);
  return {total,revenueThrough,current,currentForecast,yearForecast,points,profit,profitThrough,estimatedTax,margin,currentProfit,cumulative:!!base};
}
