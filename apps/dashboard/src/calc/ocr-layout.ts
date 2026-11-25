// Reconstruct PDF-like cells from the OCR word positions. Wide gaps separate columns.
export function ocrTextItems(tsv:string,canvasHeight:number,scale:number){
  const lines=new Map<string,{left:number;right:number;top:number;text:string}[]>();
  for(const row of tsv.split('\n')){
    const columns=row.split('\t'), text=columns[11]?.trim();
    if(columns[0]!=='5'||!text)continue;
    const key=columns.slice(1,5).join('/');
    const left=Number(columns[6]),top=Number(columns[7]),width=Number(columns[8]);
    if(![left,top,width].every(Number.isFinite))continue;
    const words=lines.get(key)??[];
    words.push({left,right:left+width,top,text});lines.set(key,words);
  }
  return [...lines.values()].flatMap(words=>{
    words.sort((a,b)=>a.left-b.left);
    const top=Math.min(...words.map(w=>w.top)),cells:{left:number;right:number;text:string}[]=[];
    for(const word of words){
      const last=cells.at(-1);
      if(last&&word.left-last.right<=4*scale){last.right=word.right;last.text+=' '+word.text;}
      else cells.push({...word});
    }
    return cells.map(cell=>({str:cell.text,transform:[1,0,0,1,cell.left/scale,(canvasHeight-top)/scale],width:(cell.right-cell.left)/scale}));
  });
}
