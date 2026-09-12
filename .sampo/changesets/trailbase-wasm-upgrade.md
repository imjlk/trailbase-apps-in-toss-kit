---
cargo/trailbase-guest-common: minor
cargo/trailbase-toss-identity: minor
---

Upgrade trailbase-wasm to 0.6.1 and verify the 0.33.14 server with an isolated
component/auth/Record API/SSE integration smoke. Rebuild all consumer components
and coordinate the server/guest rollout; new binaries do not support pre-0.32
hosts. Update the first-party auth-ui component separately.

Fix anonymous bootstrap and password rotation for the post-0.31.2 _user schema,
which replaced verified with unverified_email. Existing flag-based schemas remain
supported by the SQL helpers; verified principals and pending email changes are
preserved. Official auth endpoints still issue tokens. The last verified server
moves to 0.33.14; the manual kit minimum stays TBD. Consumer production/device and
full migration checks remain required before rollout.

Trigger runtime smoke checks on client/parser dependency changes and verify the
read-only Record API ACL with valid auth, CSRF and a complete record payload.
