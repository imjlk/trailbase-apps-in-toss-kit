---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: minor
---

Add a read-only owned-currency month-end report CLI with JSON and CSV output.
Existing databases must apply the forward-only event and policy migrations and
backfill `owned_currency_policies` before running the report; otherwise the CLI
fails closed with `REPORT_SCHEMA_UNAVAILABLE`.
