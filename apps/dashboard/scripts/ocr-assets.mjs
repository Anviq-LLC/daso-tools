// Copies the OCR engine and German language data next to the app so scanned PDFs can be read without a CDN.
import { copyFileSync, mkdirSync } from 'node:fs';

const files = {
  'ocr-worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.js',
  'tesseract-core-lstm.wasm': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
  'deu.traineddata.gz': 'node_modules/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz',
  'TESSERACT-LICENSE.txt': 'node_modules/tesseract.js-core/LICENSE',
  'TESSERACT-WORKER-LICENSE.txt': 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt',
};
mkdirSync('public/vendor', { recursive: true });
for (const [name, from] of Object.entries(files)) copyFileSync(from, 'public/vendor/' + name);
