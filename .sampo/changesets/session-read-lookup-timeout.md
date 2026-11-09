---
npm/@trailbase-apps-in-toss-kit/ait-core: patch
npm/@trailbase-apps-in-toss-kit/ait-web: patch
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Session reads now give up on an SDK account lookup that does not answer within 10 seconds, the same bound session saves already use. A stalled `getAnonymousKey` call no longer hangs session restore: the read rejects without recording an account or clearing a session, and a late SDK answer is ignored. Treat the rejected read as no stored session, as for any failed lookup. RN session storage gets the same bound; RN apps that previously waited indefinitely now see the read reject after 10 seconds.

With account revalidation on (the WebView default, or RN `revalidateAnonymousHash: true`), a session save made before a read has confirmed the Toss account in the current app process now checks the account first. An app that treats a failed read as no stored session and signs in again therefore records the new account instead of storing its session under the previous account's hash, where a later read as that account would restore it. If that check also fails, the save rejects without writing. RN storage without revalidation is unchanged.
