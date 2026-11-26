// In-browser OCR. Images and documents never leave the device.
import { readIdentity, parseMrz } from './identity.mjs';

const base = new URL('./vendor/ocr/', import.meta.url).href;
let worker;

async function engine() {
  if (!worker) {
    const T = (await import('./vendor/ocr/tesseract.esm.min.js')).default;
    worker = await T.createWorker(['deu', 'pol', 'eng'], 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: true, workerBlobURL: false });
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
  }
  return worker;
}

async function toCanvas(file) {
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    try {
      const page = await pdf.getPage(1), vp = page.getViewport({ scale: 2.5 }), c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      return c;
    } finally { await pdf.destroy(); }
  }
  const bmp = await createImageBitmap(file), k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.filter = 'grayscale(1) contrast(1.3)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

// Text of a scanned PDF, up to 10 pages. onPage(done, total) reports progress.
export async function ocrPdfText(file, onPage = () => {}) {
  const w = await engine();
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const total = Math.min(pdf.numPages, 10);
    let text = '';
    for (let i = 1; i <= total; i++) {
      onPage(i - 1, total);
      const page = await pdf.getPage(i), vp = page.getViewport({ scale: 2.5 }), c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      text += (await w.recognize(c)).data.text + '\n';
    }
    return text;
  } finally { await pdf.destroy(); }
}

// Returns { text, identity }. The MRZ strip at the bottom gets a second, restricted pass.
export async function scanDocument(file) {
  const w = await engine(), c = await toCanvas(file);
  let text = (await w.recognize(c)).data.text, identity = readIdentity(text);
  if (!identity || identity.source !== 'mrz' || !identity.verified) {
    const h = Math.round(c.height * 0.4), strip = document.createElement('canvas');
    strip.width = c.width; strip.height = h;
    strip.getContext('2d').drawImage(c, 0, c.height - h, c.width, h, 0, 0, c.width, h);
    await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6' });
    const mrz = (await w.recognize(strip)).data.text;
    await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
    const m = parseMrz(mrz);
    if (m && (m.verified || !identity)) { identity = m; text += '\n' + mrz; }
  }
  return { text, identity };
}
