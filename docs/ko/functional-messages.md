# 기능성 메시지

AppsInToss 메시지 발송은 정책상 두 흐름을 분리해서 봐야 합니다.

- 기능성 메시지: 보상 지급 결과, 계정 연동 해제, 사용자가 명시적으로 신청한 알림처럼
  서비스 이용에 필요한 알림입니다. 사용자가 특정 조건의 향후 알림을 신청하는 경우에는 서버
  발송 전에 Apps in Toss 알림 동의문 SDK를 사용해야 합니다.
- 마케팅 메시지: 혜택, 캠페인, 재방문 유도, 미션 리마인드처럼 홍보나 리텐션 목적의
  메시지입니다. 이 흐름은 마케팅 수신 동의와 분리하지 마세요.

kit는 헬퍼와 SQL 템플릿을 제공하지만, 실제 마이그레이션, 문구, 관리자 화면, 발송 잡은
도입 앱이 소유합니다.

## AppsInToss 콘솔 작업

1. AppsInToss 콘솔에 mTLS 인증서를 등록하고, 다운로드한 `*_public.crt`,
   `*_private.key` 파일은 프록시 컨테이너에만 마운트합니다. TrailBase나 RN 환경 변수에
   인증서 원문을 넣지 마세요.
2. 스마트 발송 콘솔에서 기능성 알림 템플릿을 만들고 문구 검수를 완료한 뒤 앱 발송을 켭니다.
   콘솔의 발송코드(`templateSetCode`)는 `message_templates.template_code`에 저장합니다.
3. 사전 알림 동의가 필요한 템플릿은 콘솔의 스마트 발송 알림 동의문 탭에서 동의문을
   등록합니다. SDK 호출에는 발송 템플릿 코드(`templateSetCode`)가 아니라, 알림 동의문에
   등록한 코드(`templateCode`)를
   `requestNotificationAgreement({ options: { templateCode } })`로 전달합니다. 1개의
   발송 템플릿이 1개의 동의문을 쓰는 단순한 앱은 같은 문자열을 `template_code`와
   `agreement_template_code`에 모두 저장할 수 있습니다. 여러 발송 템플릿이 하나의
   동의문을 공유한다면 `agreement_template_code`에 공유 동의문 코드를 저장해 발송 코드와
   동의문 코드를 분리하세요.
4. sandbox QA를 위해 테스트 `userKey`와 API scope를 준비합니다. 프록시는 사용자 키를
   `x-toss-user-key` 헤더로 Toss에 전달합니다.

기능성 문구는 정보 전달과 서비스 필수성에 초점을 맞춥니다. 혜택, 재방문 유도, 행동 유도
문구는 기능성 템플릿에 넣지 마세요. 제목은 명사형에 가깝게, 본문은 푸시와 알림함에서
잘리는 일이 적도록 짧게 유지합니다.

## SQL 템플릿

아래 템플릿을 앱 마이그레이션 묶음으로 복사한 뒤 앱에 맞게 편집하세요.

- `templates/trailbase/sql/message_templates.sql`
- `templates/trailbase/sql/notification_template_agreements.sql`
- `templates/trailbase/sql/message_outbox.core.sql`

이미 자체 `message_outbox`가 있는 앱은 테이블을 교체하지 말고 forward migration으로 provider
응답 요약 컬럼만 추가하세요.
이미 자체 `message_templates`가 있는 앱은 nullable `agreement_template_code`를 forward
migration으로 추가할 수 있습니다. 새 앱은 이 컬럼이 포함된 템플릿을 처음부터 복사하세요.

### 기존 템플릿 백필

기존 앱에서는 nullable 컬럼을 추가하는 것만으로 마이그레이션이 끝나지 않습니다.
이미 `requires_agreement = 1`인 row가 있다면 새 gate를 적용하기 전에 별도의 데이터
마이그레이션으로 `agreement_template_code`를 반드시 채우세요. 동의가 필요한 템플릿 row는
알림 동의문 코드가 null이 아니어야 한다는 제약을 전제로 동작합니다.

발송 템플릿과 알림 동의문이 1:1인 단순 구성에서는 아래처럼 발송 코드를 복사할 수 있습니다.

```sql
UPDATE message_templates
SET agreement_template_code = template_code
WHERE requires_agreement = 1
  AND agreement_template_code IS NULL;
```

여러 발송 템플릿이 하나의 알림 동의문을 공유한다면 `template_code`를 그대로 복사하지 말고,
각 row를 공유 동의문 `templateCode`로 매핑하세요.

Toss 콘솔 코드는 역할을 분리해서 앱별 DB에서 관리하세요.

- `templateSetCode`: `/api-partner/v1/apps-in-toss/messenger/send-message`에 전달하는
  기능성 메시지 발송 템플릿 코드입니다. kit SQL 템플릿에서는
  `message_templates.template_code`가 이 값을 담습니다. 여러 사용자에게 같은 템플릿을 보내는 경우에는
  `/api-partner/v1/apps-in-toss/messenger/send-bulk-message`를 사용하며, 한 요청당 최대
  2,500명까지 `contextList`에 담을 수 있습니다.
- `templateCode`: `requestNotificationAgreement`에 전달하는 SDK 옵션 이름입니다. 이 값은
  콘솔에 등록한 알림 동의문 코드입니다. 공유 SQL 템플릿에는
  `message_templates.agreement_template_code`가 포함되어 있습니다. `requires_agreement = 1`인
  템플릿에는 이 값을 채우고, 동의 저장/검증은 그 알림 동의문 코드 기준으로 하세요. 단순
  1:1 구성에서는 `message_templates.template_code`와 같은 문자열이어도 됩니다.

## 런타임 흐름

1. RN 또는 WebView는 템플릿에 사전 동의가 필요할 때
   `requestNotificationAgreement({ options: { templateCode } })`를 호출합니다. 여기서
   `templateCode`는 발송 템플릿 코드가 아니라 알림 동의문 코드입니다. React Native 앱은
   `@trailbase-apps-in-toss-kit/ait-rn/notifications`로 SDK cleanup과 결과 정규화를 감쌀 수
   있습니다.
2. 앱은 `newAgreement`, `alreadyAgreed`를 `OPTED_IN`으로, `agreementRejected`를
   `OPTED_OUT`으로 저장합니다. TrailBase WASM 핸들러에서는 앱 흐름에서 SDK에 전달한
   `templateCode` 값과 함께 `upsert_notification_template_agreement_tx`를 사용할 수 있습니다.
   같은 `ait-rn` 하위 경로는 앱이 소유한 sync/request endpoint를 호출하는 generic 기능성
   메시지 client도 제공합니다.
3. 잡은 활성 Toss identity를 읽고, 템플릿 상태와 동의, 멱등 키, 쿨다운을 확인한 뒤 사설
   프록시의 `/internal/apps-in-toss/smart-message/send` 또는
   `/internal/apps-in-toss/smart-message/send-bulk`를 호출합니다. 대량 발송은 같은
   `templateSetCode`끼리 묶고, Toss 제한에 맞춰 한 요청을 2,500명 이하로 유지합니다.
4. 프록시는 `/api-partner/v1/apps-in-toss/messenger/send-message` 또는
   `/api-partner/v1/apps-in-toss/messenger/send-bulk-message`를 호출하고 Toss 응답의
   `resultType`, `msgCount`, `sentPushCount`, `sentInboxCount`, `detail`, `fail`,
   `reachFailReason`을 앱이 저장하기 쉬운 형태로 정규화합니다.

TrailBase WASM 핸들러는 `trailbase_guest_common::apps_in_toss_messages`로 outbox row를
멱등 enqueue하고, ready row를 claim/lock하며, gate에서 막힌 row를 skip하고, provider 예외를
failed로 표시하고, provider 응답을 complete할 수 있습니다. 대상자 선택, cooldown, 발송 주기와
enqueue 정책은 계속 앱이 소유합니다.

발송 잡은 claim batch 하나를 하나의 transaction 안에서 처리하는 방식을 권장합니다. ready row를
claim한 뒤 반환된 row를 `template_code`, `purpose`, `provider` 기준으로 묶고, 각 그룹마다 단건
또는 bulk proxy adapter를 호출하세요. row마다 별도 transaction을 열지 않습니다. bulk adapter를
사용할 때는 그룹을 나눠 proxy 요청 하나가 Toss 제한인 2,500명 이하가 되게 하고, 최종 outbox
상태 전이는 기존 complete/fail/skip helper를 사용합니다.

## QA 체크리스트

- 승인된 템플릿이 `message_templates`에 등록되어 있습니다.
- 사전 동의가 필요한 기능성 템플릿은 SDK에 전달한 알림 동의문 `templateCode`를
  `message_templates.agreement_template_code`에 저장합니다. 발송 `templateSetCode`와 같은
  문자열을 쓰는 단순 1:1 구성에서도 이 값을 명시해 둡니다.
- 사전 동의가 필요한 기능성 템플릿은 매칭되는 동의 row가 `OPTED_IN`이 되기 전까지
  차단됩니다.
- 마케팅 또는 재방문 유도 템플릿은 마케팅 동의 없이는 차단됩니다.
- provider 응답 요약에 `msgCount`, push/inbox 카운트, 실패 사유, 원본 응답이 저장됩니다.
- outbox enqueue는 안정적인 멱등 키를 사용하고 중복 발송하지 않습니다.
- 쿨다운과 일일 제한은 도입 앱 정책에 맞게 적용됩니다.
- 푸시나 알림함 진입 시 딥링크가 의도한 화면으로 이동합니다.

참고 문서:

- AppsInToss 스마트 메시지 API:
  <https://developers-apps-in-toss.toss.im/smart-message/develop.html>
- AppsInToss 스마트 메시지 알림 동의문 정책:
  <https://developers-apps-in-toss.toss.im/smart-message/intro.html#_2-1-%E1%84%8B%E1%85%A1%E1%86%AF%E1%84%85%E1%85%B5%E1%86%B7-%E1%84%83%E1%85%A9%E1%86%BC%E1%84%8B%E1%85%B4%E1%86%AB>
- AppsInToss 알림 동의문 SDK:
  <https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%ED%84%B0%EB%A0%89%EC%85%98/requestNotificationAgreement.html>
