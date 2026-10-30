---
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Keep full-screen ad callbacks active after an ad starts so long viewing and delayed returns do not trigger a show timeout. The show deadline now only covers opening the ad; reward completion still requires the SDK reward event.
