---
npm/@trailbase-apps-in-toss-kit/ait-web: minor
---

Add a WebView adapter for separately consented user data. It checks SDK support,
keeps repeat prompts opt-in, redacts provider errors and does not cache or persist
returned personal data. Consumers still own consent-purpose configuration,
withdrawal callbacks, field minimization and their retention policy. Toss Login
is not required by this adapter.
