import{knownSum}from'./aufmass.mjs';
export function editedGroup(group,edit){
 if(!edit)return group;
 const rows=group.rows.map(r=>({...r,...Object.fromEntries(Object.entries(edit.patches?.[r.id]||{}).filter(([k])=>k!=='revenueCents')),manual:!!edit.patches?.[r.id]}));
 for(const r of edit.added||[])if(!rows.some(x=>x.id===r.id))rows.push({...r,revenueCents:null,manual:true});
 return{...group,rows,minutes:knownSum(rows,'minutes'),costCents:knownSum(rows,'costCents'),revenueCents:group.revenueCents,edited:true,sourceChanged:edit.baseSignature!==JSON.stringify(group.rows)};
}
export function roleAdjustment(adjustment={},agreement){
 if(!('fitterHours'in adjustment)&&!('foremanHours'in adjustment))return{hours:Number(adjustment.hours||0),cents:Math.round(Number(adjustment.hours||0)*Math.round(Number(adjustment.rate||0)*100)),legacy:true,missingRates:[]};
 agreement={fitterRateCents:adjustment.rates?.fitterRateCents??agreement?.fitterRateCents,foremanRateCents:adjustment.rates?.foremanRateCents??agreement?.foremanRateCents};const fitter=Number(adjustment.fitterHours||0),foreman=Number(adjustment.foremanHours||0);if(!Number.isFinite(fitter)||!Number.isFinite(foreman))throw Error('Stunden prüfen.');
 const missingRates=[];if(fitter&&agreement?.fitterRateCents==null)missingRates.push('Monteur');if(foreman&&agreement?.foremanRateCents==null)missingRates.push('Obermonteur');
 return{hours:fitter+foreman,fitterHours:fitter,foremanHours:foreman,cents:missingRates.length?null:Math.round(fitter*(agreement?.fitterRateCents??0))+Math.round(foreman*(agreement?.foremanRateCents??0)),missingRates};
}

export function roleDayCost(fitterMinutes,foremanMinutes,agreement){
 const f=Number(fitterMinutes),o=Number(foremanMinutes);if(!Number.isInteger(f)||!Number.isInteger(o)||f<0||o<0)throw Error('Rollenstunden prüfen.');
 const missingRates=[];if(f&&agreement?.fitterRateCents==null)missingRates.push('Monteur');if(o&&agreement?.foremanRateCents==null)missingRates.push('Obermonteur');return{minutes:f+o,fitterMinutes:f,foremanMinutes:o,costCents:missingRates.length?null:Math.round(f*(agreement?.fitterRateCents??0)/60)+Math.round(o*(agreement?.foremanRateCents??0)/60),missingRates};
}

export function adjustmentHeading(adjustment){
 const hours=[adjustment.fitterHours,adjustment.foremanHours,adjustment.hours].map(Number);
 const addition=hours.some(value=>value>0),deduction=hours.some(value=>value<0);
 if(addition&&deduction)return 'Zuschlag und Abzug';
 if(addition)return 'Zuschlag';
 if(deduction)return 'Abzug';
 return '';
}
