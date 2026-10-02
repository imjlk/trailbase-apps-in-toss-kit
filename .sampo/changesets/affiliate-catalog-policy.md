---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: minor
npm/@trailbase-apps-in-toss-kit/ait-rn: minor
---

Add a server-only Toss Shopping Sharelink client and provider-neutral category/deal selection policy. Consumers explicitly configure topic/default category groups, source weights, exclusions, persistent private cache and internal authentication. Overall best is opt-in; unavailable products/providers yield no offer. Live use requires Sharelink approval, OAuth keys, publisher ID and registered server egress IP. No mTLS or schema migration is required. A development preview can return non-navigable offers without credentials. RN validates server offers and refuses previews unless explicitly opted in.
