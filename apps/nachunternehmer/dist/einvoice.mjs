import{invoicePdfText}from'./pdf-text.mjs';
import{xml2js}from'./vendor/xml-js.mjs';
import{extractInvoice}from'./invoice.mjs';
const local=n=>String(n||'').split(':').at(-1);
const children=(node,name)=>(node?.elements||[]).filter(e=>e.type==='element'&&local(e.name)===name);
const one=(node,name)=>{const matches=children(node,name);if(matches.length>1)throw Error('Mehrdeutiges XML-Feld: '+name);return matches[0]};
const text=node=>(node?.elements||[]).filter(e=>e.type==='text'||e.type==='cdata').map(e=>e.text??e.cdata??'').join('').trim();
const amount=node=>{if(!node)return null;const s=text(node);if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('Ungültiger Rechnungsbetrag');const[x,y='']=s.split('.');const n=Number(x)*100+Number(y.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('Rechnungsbetrag zu groß');if(node.attributes?.currencyID&&node.attributes.currencyID!=='EUR')throw Error('Nur EUR-Rechnungen unterstützt');return n};
export function extractEInvoice(xml){
 if(xml.length>8*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('XML zu groß oder enthält nicht unterstützte Deklarationen');
 const doc=xml2js(xml,{compact:false,ignoreComment:true,ignoreDeclaration:true}),root=doc.elements?.find(e=>e.type==='element');if(!root)throw Error('Keine XML-Rechnung');
 let netCents,grossCents,payableCents,invoiceNumber,currency,format;
 if(local(root.name)==='Invoice'){
  currency=text(one(root,'DocumentCurrencyCode'));const sums=one(root,'LegalMonetaryTotal');
  netCents=amount(one(sums,'TaxExclusiveAmount'));grossCents=amount(one(sums,'TaxInclusiveAmount'));payableCents=amount(one(sums,'PayableAmount'));invoiceNumber=text(one(root,'ID'));format='XRechnung / UBL';
 }else if(local(root.name)==='CrossIndustryInvoice'){
  const document=one(root,'ExchangedDocument'),type=text(one(document,'TypeCode'));if(type&&type!=='380'&&type!=='384')throw Error('Dieser Rechnungsbelegtyp wird nicht unterstützt');
  const settlement=one(one(root,'SupplyChainTradeTransaction'),'ApplicableHeaderTradeSettlement'),sums=one(settlement,'SpecifiedTradeSettlementHeaderMonetarySummation');
  currency=text(one(settlement,'InvoiceCurrencyCode'));netCents=amount(one(sums,'TaxBasisTotalAmount'));grossCents=amount(one(sums,'GrandTotalAmount'));payableCents=amount(one(sums,'DuePayableAmount'));invoiceNumber=text(one(document,'ID'));format='ZUGFeRD / CII';
 }else throw Error('Unterstützt werden UBL Invoice und CII CrossIndustryInvoice');
 if(currency!=='EUR')throw Error('Nur EUR-Rechnungen unterstützt');if(netCents===null||grossCents===null||payableCents===null||!invoiceNumber||grossCents<netCents)throw Error('Rechnungssummen oder Rechnungsnummer fehlen / sind widersprüchlich');
 return{netCents,grossCents,payableCents,invoiceNumber,currency,format,structured:true};
}
export async function readInvoiceFile(file){
 if(file.size>20*1024*1024)throw Error('Maximal 20 MB je Rechnung');
 if(/\.xml$/i.test(file.name))return extractEInvoice(await file.text());
 if(!/\.pdf$/i.test(file.name))throw Error('Bitte PDF oder XML auswählen');
 const pdfjs=await import('./vendor/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
 const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href}).promise;
 try{
  const attachments=Object.values(await pdf.getAttachments()||{}),xmls=attachments.filter(a=>/\.xml$/i.test(a.filename||''));let invoice=null;
  for(const a of xmls){const xml=new TextDecoder().decode(a.content);if(!/<(?:\w+:)?(?:CrossIndustryInvoice|Invoice)(?:\s|>)/.test(xml))continue;const candidate=extractEInvoice(xml);if(invoice&&JSON.stringify(invoice)!==JSON.stringify(candidate))throw Error('Mehrere unterschiedliche XML-Rechnungen eingebettet');invoice=candidate;}
  if(invoice)return{...invoice,format:'ZUGFeRD-PDF · '+invoice.format};
  if(pdf.numPages>100)throw Error('PDF mit mehr als 100 Seiten bitte gesondert prüfen');let body='';for(let i=1;i<=pdf.numPages;i++){const data=await(await pdf.getPage(i)).getTextContent();body+=invoicePdfText(data.items)+'\n';}
  const result=extractInvoice(body);return{...result,payableCents:result.grossCents,format:'PDF-Texterkennung',structured:false};
 }finally{await pdf.destroy();}
}
export async function xmlInvoicePdf(xmlBytes,record){
 const lib=await import('./vendor/pdf-lib.min.mjs'),pdf=await lib.PDFDocument.create(),font=await pdf.embedFont(lib.StandardFonts.Helvetica),p=pdf.addPage([595.28,841.89]);
 const fmt=c=>(c/100).toFixed(2)+' EUR',clean=s=>String(s).replace(/[^\x20-\x7e\u00a0-\u00ff€]/g,'?');
 ['DaSo - Lesefassung der E-Rechnung','Original-XML ist als Anlage eingebettet.',`Rechnung: ${record.invoiceNumber}`,`Firma: ${record.companyName}`,`Projekt: ${record.project}`,`Netto: ${fmt(record.netCents)}`,`Brutto: ${fmt(record.grossCents)}`,`Offener Betrag: ${fmt(record.originalPayableCents??record.grossCents)}`].forEach((line,i)=>p.drawText(clean(line).slice(0,100),{x:35,y:790-i*24,size:11,font}));
 await pdf.attach(xmlBytes,'Originalrechnung.xml',{mimeType:'application/xml',description:'Unveraenderte eingelesene E-Rechnung'});return pdf.save();
}
