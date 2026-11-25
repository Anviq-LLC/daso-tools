# DaSo Montageplanung

Internal scheduling and timesheet app for DaSo Lüftungsbau: crew and subcontractor
planning by calendar week, project/document management, a geolocation-stamped
clock-in/out, and monthly expense/hours reporting. Access is restricted to DaSo
staff via Cloudflare Access (email one-time code, `@dasoluft.com` domain).

## Stack

- Next.js on [vinext](https://github.com/cloudflare/vinext), deployed as a Cloudflare Worker
- Cloudflare D1 (Drizzle ORM) for data, Cloudflare R2 for project files
- Cloudflare Access for authentication; app-level role checks (Planer / Obermonteur / Monteur) in `app/api/data/route.ts`

## Local development

Requires Node.js `>=22.13.0` and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

## Build & deploy

```bash
pnpm exec wrangler deploy
```

Pushes to `main` deploy through Cloudflare Workers Builds with root directory
`apps/montageplanung`. Leave the build command empty and keep the deploy command
`npx wrangler deploy`; `wrangler.jsonc` runs `pnpm run build` itself.

## Database migrations

```bash
pnpm run db:generate   # after editing db/schema.ts
wrangler d1 execute DB --remote --file drizzle/<new-migration>.sql
```
