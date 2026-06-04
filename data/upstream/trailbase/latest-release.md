# TrailBase v0.28.3

- Published at: 2026-06-04T16:36:14Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.28.3

## Release notes

- Stream-encode file contents with new admin dash file-upload UI.
- Since we're not using multipart forms, there are hard limits on upload size - both on the server and browser. Warn for larger (> 5MB) files. The effective limit is around 10MB right now.
- Minor: validate SMTP host as part of config validation.
- Update Rust and JavaScript dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.28.2...v0.28.3