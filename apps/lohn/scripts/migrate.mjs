import { execSync } from 'node:child_process';

// Workers Builds runs the build command for pull request branches too, which must not touch production.
if (process.env.WORKERS_CI_BRANCH === 'main') {
  execSync('pnpm exec wrangler d1 migrations apply DB --remote', { stdio: 'inherit' });
}
