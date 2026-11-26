import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Workers Builds only sees one app folder, so the shared tokens are copied into each app and committed.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'apps/nachunternehmer/dist/daso-tokens.css',
  'apps/mitarbeiter/dist/daso-tokens.css',
];
for (const t of targets) copyFileSync(join(root, 'design/daso-tokens.css'), join(root, t));
console.log('synced', targets.length, 'copies');
