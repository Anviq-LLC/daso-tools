// PDF text items are glyph runs, not words. Rebuild visual baselines before parsing.
export function invoicePdfText(items){
 const lines=[];for(const item of items){if(!item.str?.trim()||!item.transform||Math.abs(item.transform[1]||0)>.01||Math.abs(item.transform[2]||0)>.01)continue;
 const x=item.transform[4],y=item.transform[5],height=item.height||Math.abs(item.transform[3])||10;
 let line=lines.filter(l=>Math.abs(l.y-y)<=Math.min(2,height*.2,l.height*.2)).sort((a,b)=>Math.abs(a.y-y)-Math.abs(b.y-y))[0];
 if(!line){line={y,height,items:[]};lines.push(line);}line.items.push({text:item.str,x,width:item.width||0,height});}
 return lines.sort((a,b)=>b.y-a.y).map(l=>{let result='',prev=null;for(const item of l.items.sort((a,b)=>a.x-b.x)){
 const gap=prev?item.x-prev.x-prev.width:0,space=prev&&gap>Math.max(.7,Math.min(prev.height,item.height)*.14)&&!result.endsWith(' ')&&!item.text.startsWith(' ');
 result+=(space?' ':'')+item.text;prev=item;}return result.trim();}).join('\n');
}
