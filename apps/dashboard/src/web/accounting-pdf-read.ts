import { parseAccountingPdf, type AccountingReport } from '../calc/accounting-pdf.ts';

// pdf.js runs in the browser only; the file is read here and just the extracted lines go to the server.
// Pages without a text layer (scans) are read with local OCR.
export async function readAccountingPdf(file: File): Promise<AccountingReport & { ocr: boolean }> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Bitte ein PDF bis 20 MB auswählen.');
  const url = '/vendor/pdf.min.mjs';
  const pdfjs = await import(/* @vite-ignore */ url);
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    if (pdf.numPages > 100) throw new Error('Bitte einen Monatsbericht mit höchstens 100 Seiten auswählen.');
    const pages = [], scanned = [], indexes: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      if (items.filter((i: { str?: string }) => i.str?.trim()).length < 5) { indexes.push(pages.length); scanned.push(page); }
      pages.push(items);
    }
    if (scanned.length) {
      const { readScannedPages } = await import('./accounting-ocr.ts');
      const recognized = await readScannedPages(scanned);
      indexes.forEach((at, i) => { pages[at] = recognized[i]; });
    }
    return { ...parseAccountingPdf(pages), ocr: scanned.length > 0 };
  } finally { await pdf.destroy(); }
}
