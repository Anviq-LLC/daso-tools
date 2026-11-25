import { createWorker, PSM } from 'tesseract.js';
import { ocrTextItems } from '../calc/ocr-layout.ts';

type Page = {
  getViewport(options:{scale:number}):{width:number;height:number};
  render(options:{canvasContext:CanvasRenderingContext2D;viewport:unknown}):{promise:Promise<void>};
};

export async function readScannedPages(pages:Page[]){
  if(pages.length>20)throw new Error('Bitte Bild-PDFs mit höchstens 20 gescannten Seiten auswählen.');
  const root=new URL('/vendor/',location.origin).href;
  const worker=await createWorker('deu',1,{
    workerPath:root+'ocr-worker.min.js',corePath:root+'tesseract-core-lstm.js',
    langPath:root,workerBlobURL:false,
  });
  const result=[];
  try{
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
    for(const page of pages){
      const original=page.getViewport({scale:1});
      const scale=Math.min(300/72,3600/Math.max(original.height,original.width));
      const viewport=page.getViewport({scale});
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const canvasContext=canvas.getContext('2d');
      if(!canvasContext)throw new Error('Der Browser kann die PDF-Seite nicht rendern.');
      await page.render({canvasContext,viewport}).promise;
      const {data}=await worker.recognize(canvas,{}, {tsv:true});
      result.push(ocrTextItems(data.tsv??'',canvas.height,scale));
      canvas.width=0;canvas.height=0;
    }
    return result;
  }finally{await worker.terminate();}
}
