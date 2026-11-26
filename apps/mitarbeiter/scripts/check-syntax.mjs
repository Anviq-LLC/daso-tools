import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const dir of ['src', 'dist']) {
  for (const file of readdirSync(dir).filter((f) => /\.m?js$/.test(f))) {
    execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
  }
}
