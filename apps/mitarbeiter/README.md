# DaSo Mitarbeiter

Employee master data for DaSo (name, role, login email) and the time recording of office staff: stamping with a
report, absences (sick, vacation, unpaid, homeoffice or a free label), vacation requests and an office calendar.
Planning, Aufmass and payroll keep using the same employee ids they always had. Access roles stay in the Montageplanung.

## Run

    pnpm install
    pnpm dev         # local worker with a dev identity
    pnpm typecheck
    pnpm test
    pnpm build       # dry run, deploys nothing

## Setup

1. `wrangler d1 create daso-mitarbeiter` and put the database id into `wrangler.jsonc`.
2. Create a Cloudflare Access application for the Worker and put its audience tag into `CF_ACCESS_AUD`.
3. Open the app and use "Aus der Einteilung übernehmen" once. It copies the current employees with their ids and can be repeated safely.
4. Switch the tool to "führend" when the list is right. Only then does the Montageplanung follow it.

## Deploy

Cloudflare Workers Builds with root directory `apps/mitarbeiter`, build watch path `apps/mitarbeiter/*`.
Leave the build command empty and keep the deploy command `npx wrangler deploy`. `wrangler.jsonc` applies the
D1 migrations on the main branch only. Access requires a Planer in the Montageplanung or an email in `MA_ALLOWED_EMAILS`.

## Access

A Planer in the Montageplanung (or an email in `MA_ALLOWED_EMAILS`) manages everything. An employee whose login
email is stored here can use the office features for themselves. The Cloudflare Access policy must admit those
emails, or they cannot sign in. Office staff are the employees whose role matches the office rule in `src/office.js`,
which must stay identical to `isOfficeRole` in the Lohntool.

## Payroll

The Lohntool reads stamps and absences of office staff from this database (`MA_DB`, read-only) in the same row
shapes as the planning. They only count once the employee exists in the Montageplanung, which happens when this
tool is switched to "führend".
