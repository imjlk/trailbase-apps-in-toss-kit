---
npm/@trailbase-apps-in-toss-kit/ait-core: patch
npm/@trailbase-apps-in-toss-kit/ait-web: patch
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Session reads now give up on an SDK account lookup that does not answer within 10 seconds, the same bound session saves already use. A stalled `getAnonymousKey` call no longer hangs session restore: the read rejects without recording an account or clearing a session, and a late SDK answer is ignored. Treat the rejected read as no stored session, as for any failed lookup. RN session storage gets the same bound; RN apps that previously waited indefinitely now see the read reject after 10 seconds.
