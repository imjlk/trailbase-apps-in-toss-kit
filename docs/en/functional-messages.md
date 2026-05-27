# Functional Messages

AppsInToss message delivery has two policy lanes:

- Functional messages: service-necessary notifications such as reward delivery
  results, account unlink notices, or reminders explicitly requested by the
  user. Some templates still require `requestNotificationAgreement(templateCode)`.
- Marketing messages: benefits, campaigns, re-engagement, mission reminders, or
  other promotional copy. Keep these on the marketing consent path.

The kit provides helpers and SQL templates, but the consuming app owns the final
migrations, copy, admin workflow, and dispatch jobs.

## AppsInToss Console Setup

1. Register the mTLS certificate in the AppsInToss console, then mount the
   downloaded `*_public.crt` and `*_private.key` files only into the proxy
   container. Do not put certificate contents in TrailBase or RN environment
   variables.
2. Create message templates in the smart-message console and complete Toss copy
   review before enabling app dispatch. Store the console `templateSetCode` as
   `message_templates.template_code`.
3. For templates that require prior notification agreement, register the
   agreement copy in the console and use its `templateCode` with
   `requestNotificationAgreement`.
4. Prepare test `userKey` values and API scopes for sandbox QA. The proxy sends
   the user key through the `x-toss-user-key` header.

Functional copy should be informational and service-bound. Avoid benefit,
retention, or action-driving copy in functional templates. Keep titles noun-like
and bodies short enough for push and inbox surfaces.

## SQL Templates

Copy the templates into the app migration set before editing:

- `templates/trailbase/sql/message_templates.sql`
- `templates/trailbase/sql/notification_template_agreements.sql`
- `templates/trailbase/sql/message_outbox.core.sql`

Existing apps with their own `message_outbox` should add the provider response
summary columns with a forward migration instead of replacing the table.

## Runtime Flow

1. RN calls `requestNotificationAgreement({ options: { templateCode } })` when a
   template requires prior agreement.
2. The app stores `newAgreement` and `alreadyAgreed` as `OPTED_IN`, and
   `agreementRejected` as `OPTED_OUT`.
3. The job loads the active Toss identity, checks template status and consent,
   applies idempotency and cooldown rules, then calls
   `/internal/apps-in-toss/smart-message/send` on the private proxy.
4. The proxy calls `/api-partner/v1/apps-in-toss/messenger/send-message` and
   normalizes Toss response fields such as `resultType`, `msgCount`,
   `sentPushCount`, `sentInboxCount`, `detail`, `fail`, and `reachFailReason`.

## QA Checklist

- Approved template exists in `message_templates`.
- Functional templates that require agreement are blocked until the template
  agreement row is `OPTED_IN`.
- Marketing or re-engagement templates are blocked without marketing consent.
- Provider response summaries persist `msgCount`, push/inbox counts, failure
  reasons, and the raw provider response.
- Repeated outbox enqueue uses a stable idempotency key and does not duplicate
  sends.
- Cooldown and daily-limit policy are enforced by the consuming app.
- Deep links land on the intended screen after push or inbox entry.

References:

- AppsInToss smart-message API:
  <https://developers-apps-in-toss.toss.im/smart-message/develop.html>
- AppsInToss notification agreement SDK:
  <https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%ED%84%B0%EB%A0%89%EC%85%98/requestNotificationAgreement.html>
