---
npm/@trailbase-apps-in-toss-kit/ait-rn: minor
---

Remove the retired `contactsViral` share-reward bridge, including the root exports and `@trailbase-apps-in-toss-kit/ait-rn/share-reward` subpath. Consumers must remove `createAppsInTossContactsViralBridge`, `runContactsViralReward`, and direct legacy SDK calls, then disable new attempts and unpaid claims for affected placements before deploying. Keep committed receipts readable; ordinary sharing, ad rewards, and separate promotion campaigns remain available.
