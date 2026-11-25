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

Run and deploy commands are in each app's README. GitHub Actions in `.github/workflows`
run per app and only when files under that app change. Cloudflare Workers Builds need the
root directory of the app set (see below).

## Cloudflare Workers Builds

For each Worker connected to this repository set the root directory to `apps/<app>` and
the build watch path to `apps/<app>/*`. Build and deploy commands stay as documented in the
app's README.
