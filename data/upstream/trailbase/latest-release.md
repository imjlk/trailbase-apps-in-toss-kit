# TrailBase v0.37.0

- Published at: 2026-11-26T19:57:51Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.37.0

## Release notes

Early multi-tenancy support: similar to multi-DB before, API calls are routed to independent databases but rather than being static, routing happens based on a user's tenant-association.
- Flow:
  - You can register a "tenant template" using the CLI (`trail tenant new-template <template-name>`) or configuration. Templates represents sets of database-schema migrations that will be applied to existing and newly created databases for each tenant referencing said template. Failure to apply a new migration to any tenant, will halt all migations to keep databases consistent.
  - Afterwards, you can create new migrations to define your "template" database schema, i.e. `TABLE`s and `VIEW`s for your APIs to use (`trail tenant new-migration <template-name>`).
  - You can then configure APIs referencing your template:
  ```textproto
  # file: <traildepot>/config.textproto
  # schema-file: <repo>/crates/core/proto/config.proto
  tenant_templates: [
    { name: "<template-name>" }
  ]
  record_apis: [
    {
      name: "<api-name>"
      table_name: "<template-name>.<table-name>"
      tenant_template: "<template-name>"
    },
  ]
  ```
  - With your template and APIs set up, create a first tenant: `trail new-tenant <template-name> <tenant-name>`, and add users as members to it: `trail user add-to-tenant admin@localhost <tenant-name>`.
  - Afterwards, members can sign-in with a tenant association and access the multi-tenant APIs with a separate database per tenant: `<depot>/data/<template-name>/<tenant-id>.db`.
  - Tenants and membership associations can be inspected in the admin UI on the "accounts" page.
- Use-cases:
  - Complete physical separation of data for different tenants, e.g. no cross-tenant lock congestion. Moreover, databases can be served from independent physical media potentially in different locales.
- Limitations:
  - `ForeignKey` constraints are not enforceable across database boundaries.
  - Change subscriptions are not (yet) supported but seems quite doable.
  - The admin dashboard does not (yet) allow managing template migrations or managing user-tenant memberships. However, all operations are covered by the CLI. Tenants and memberships are inspectable via the accounts page.
  - Not all client libraries (yet) support user sign-in with a tenant.
  - No hot-reload for tenant-template migrations.
  - Postgres is not supported.
- We're looking for loads and loads of feedback 🙏. Multi-tenancy support can take many different shapes across the product landscape.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.36.3...v0.37.0