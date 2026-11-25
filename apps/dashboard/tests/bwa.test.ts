import test from 'node:test';
import { ocrTextItems } from '../src/calc/ocr-layout.ts';
import assert from 'node:assert/strict';
import { bucketOf, DEFAULT_MAPPING, linesFromRows, linesFromText, parseAmount, pdfLines, suggest, summarize } from '../src/calc/bwa.ts';

test('german amounts', () => {
  assert.equal(parseAmount('1.234,56'), 123_456);
  assert.equal(parseAmount('1.234,56-'), -123_456);
  assert.equal(parseAmount('500,00 H'), -50_000);
  assert.equal(parseAmount(12.5), 1_250);
  assert.equal(parseAmount('abc'), null);
});
test('rows and pasted pdf text give the same lines', () => {
  const a = linesFromRows([['4120', 'Gehälter', '', '12.000,00']]);
  const b = linesFromText('4120 Gehälter 12.000,00');
  assert.deepEqual(a, b);
  assert.deepEqual(a[0], { account: '4120', label: 'Gehälter', cents: 1_200_000 });
});
test('mapping, summary and the same period is not added twice', () => {
  const lines = [{ account: '8400', label: 'Erlöse', cents: 10_000_000 }, { account: '4120', label: 'Gehälter', cents: 3_000_000 }, { account: '', label: 'Summe Kosten', cents: 3_000_000 }]
    .map((l) => ({ ...l, bucket: bucketOf(l, DEFAULT_MAPPING) }));
  const s = summarize(lines);
  assert.equal(s.revenue, 10_000_000);
  assert.equal(s.costs, 3_000_000);
  assert.equal(s.operating, 7_000_000);
  assert.equal(summarize(lines).revenue, s.revenue);
});
test('cost suggestion shows deviation to the standard', () => {
  assert.deepEqual(suggest({ buero: 350_000 }, [{ name: 'Büro', monthly: 300_000 }]), [{ name: 'Büro', current: 300_000, proposed: 350_000, deviation: 50_000 }]);
});

test('DATEV style SuSa rows: account, label, soll, haben, saldo', () => {
  const rows = [
    ['Konto', 'Bezeichnung', 'Soll', 'Haben', 'Saldo'],
    ['4120', 'Gehälter', '12.000,00', '0,00', '12.000,00 S'],
    ['8400', 'Erlöse 19 % USt', '0,00', '95.000,00', '95.000,00 H'],
    ['4530', 'Laufende Kfz-Betriebskosten', 1850.5, 0, 1850.5],
  ];
  const lines = linesFromRows(rows);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.account), ['4120', '8400', '4530']);
  assert.equal(lines[1].cents, -9_500_000);
  assert.equal(lines[2].cents, 185_050);
  assert.equal(bucketOf(lines[2], DEFAULT_MAPPING), 'kfz');
  assert.equal(bucketOf(lines[0], DEFAULT_MAPPING), 'personal');
});

test('summary uses magnitudes so a SuSa credit counts as positive revenue', () => {
  const lines = linesFromRows([['8400', 'Erlöse', '95.000,00 H'], ['4120', 'Gehälter', '30.000,00 S']]).map((l) => ({ ...l, bucket: bucketOf(l, DEFAULT_MAPPING) }));
  const s = summarize(lines);
  assert.equal(s.revenue, 9_500_000);
  assert.equal(s.costs, 3_000_000);
  assert.equal(s.operating, 6_500_000);
});

test('parsed BWA keeps top-level rows and its own signed result', () => {
  const row = (label: string, month: number | null) => ({ label, month, ytd: null, prior: null });
  const lines = pdfLines({
    kind: 'bwa', period: '2026-10', revenue: 1_281_170, operating: -215_965, beforeTax: -213_957, result: -213_957,
    rows: [row('Umsatzerlöse', 1_281_170), row('Erlöse aus Leistungen nach § 13b', 1_281_170), row('Wareneinsatz', 585_868), row('Personalkosten', 558_184),
      row('Gehälter', 164_739), row('Versicherungen/Beiträge', 15_231), row('Versicherungen', 14_281), row('Betriebsergebnis', -215_965), row('Ergebnis vor Steuern', -213_957)],
  });
  assert.deepEqual(lines.map((l) => l.label), ['Umsatzerlöse', 'Wareneinsatz', 'Personalkosten', 'Versicherungen/Beiträge', 'Betriebsergebnis', 'Ergebnis vor Steuern']);
  const s = summarize(lines.map((l) => ({ ...l, bucket: l.bucket! })));
  assert.equal(s.revenue, 1_281_170);
  assert.equal(s.operating, -215_965);
  assert.equal(s.beforeTax, -213_957);
});
test('parsed SuSa gives net movement and skips accounts without one', () => {
  const acc = { opening: null, ytdDebit: null, ytdCredit: null, balance: null };
  const lines = pdfLines({ kind: 'susa', period: '2026-08', rows: [
    { account: '8337', label: 'Erlöse', debit: 0, credit: 23_113_192, ...acc },
    { account: '4120', label: 'Gehälter', debit: 500_000, credit: 0, ...acc },
    { account: '1200', label: 'Bank', debit: 100, credit: 40, ...acc },
    { account: '1210', label: 'Bank 1', debit: 0, credit: 0, ...acc },
  ] });
  assert.deepEqual(lines.map((l) => [l.account, l.cents, l.bucket]), [['8337', -23_113_192, ''], ['4120', 500_000, 'sonstige_kosten'], ['1200', 60, 'ignorieren']]);
});

test('OCR words in one line become cells split by wide gaps', () => {
  const word = (text: string, left: number, top: number) => ['5', 1, 1, 1, 1, 1, left, top, 40, 10, 90, text].join('\t');
  const tsv = ['5\t1\t1\t1\t1\t0\t0\t0\t0\t0\t-1\t', word('Ergebnis', 10, 100), word('vor', 52, 100), word('Steuern', 94, 100), word('-1.234,56', 400, 100)].join('\n');
  const items = ocrTextItems(tsv, 1000, 1);
  assert.deepEqual(items.map((i) => i.str), ['Ergebnis vor Steuern', '-1.234,56']);
  assert.equal(items[1].transform[4], 400);
});
