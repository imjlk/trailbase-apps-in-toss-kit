# TrailBase v0.29.0

- Published at: 2026-06-23T18:17:24Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.29.0

## Release notes

- Authentication - Enable username-based auth and anonymous auth 🎉
  - This allows using TB's auth for more use-cases.
  - Previously, the strict dependence on email, while useful for outreach, may be unsuitable for more sensitive use-cases. Whether username and/or email is required is now governed by a user-identifier policy.
  - Anonymous logins on the other hand, allow signing up new users with an ephemeral user, which can then eventually be promoted to a "proper" user with password-based login (OAuth is TBD). Anonymous users can be useful for app trials where drop-off due to mandatory sign-up is a concern.
  - Ephemeral users are single-sign-in, i.e. they cannot re-auth, are tied to a token and thus cannot be shared across devices. Right now they have a hard-coded TTL of 3 months, after which they'll be garbage-collected if they haven't been promoted to a "proper" user.
- Make `_user.email` case insensitive and stop normalizing email, i.e. go with that the user provides.
- Add CSV clipboard button to admin UI's SQL editor.
- Minor: fix `TooltipTrigger` from triggering form submissions in admin UI.
- Update dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.28.6...v0.29.0