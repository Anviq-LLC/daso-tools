# Daso tools

Monorepo for the DaSo Lüftungsbau internal tools. Each app under `apps/` keeps its own
dependencies, Cloudflare Worker and deploy settings.

| App | Worker | Purpose |
| --- | --- | --- |
| `apps/montageplanung` | daso-montageplanung | Crew planning, time clock, expense reports |
| `apps/aufmass` | daso-aufmasstool | Quantity surveys and daily reports |
| `apps/lohn` | daso-lohntool | Payroll preparation |
| `apps/dashboard` | daso-admin-dashboard, daso-data-api | Revenue and cost reporting |
| `apps/nachunternehmer` | daso-nachunternehmer | Subcontractor handling |

Run and deploy commands are in each app's README. Deployment runs through Cloudflare Workers Builds (see below). GitHub Actions in
`.github/workflows` only run the tests, per app and only when files under that app change.

## Cloudflare Workers Builds

For every Worker, including the Montageplanung, set the root directory to `apps/<app>` and
the build watch path to `apps/<app>/*`. Build and deploy commands stay as documented in the
app's README.
