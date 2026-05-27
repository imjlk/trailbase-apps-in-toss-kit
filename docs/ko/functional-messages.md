# 기능성 메시지

AppsInToss 메시지 발송은 정책상 두 흐름을 분리해서 봐야 합니다.

- 기능성 메시지: 보상 지급 결과, 계정 연동 해제, 사용자가 명시적으로 신청한 알림처럼
  서비스 이용에 필요한 알림입니다. 템플릿에 따라
  `requestNotificationAgreement(templateCode)`가 필요할 수 있습니다.
- 마케팅 메시지: 혜택, 캠페인, 재방문 유도, 미션 리마인드처럼 홍보나 리텐션 목적의
  메시지입니다. 이 흐름은 마케팅 수신 동의와 분리하지 마세요.

kit는 헬퍼와 SQL 템플릿을 제공하지만, 실제 마이그레이션, 문구, 관리자 화면, 발송 잡은
도입 앱이 소유합니다.

## AppsInToss 콘솔 작업

1. AppsInToss 콘솔에 mTLS 인증서를 등록하고, 다운로드한 `*_public.crt`,
   `*_private.key` 파일은 프록시 컨테이너에만 마운트합니다. TrailBase나 RN 환경 변수에
   인증서 원문을 넣지 마세요.
2. 스마트 발송 콘솔에서 메시지 템플릿을 만들고 문구 검수를 완료한 뒤 앱 발송을 켭니다.
   콘솔의 `templateSetCode`는 `message_templates.template_code`에 저장합니다.
3. 사전 알림 동의가 필요한 템플릿은 콘솔에서 동의문을 등록하고, 그 `templateCode`를
   `requestNotificationAgreement`에 전달합니다.
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

## 런타임 흐름

1. RN은 템플릿에 사전 동의가 필요할 때
   `requestNotificationAgreement({ options: { templateCode } })`를 호출합니다.
2. 앱은 `newAgreement`, `alreadyAgreed`를 `OPTED_IN`으로, `agreementRejected`를
   `OPTED_OUT`으로 저장합니다.
3. 잡은 활성 Toss identity를 읽고, 템플릿 상태와 동의, 멱등 키, 쿨다운을 확인한 뒤 사설
   프록시의 `/internal/apps-in-toss/smart-message/send`를 호출합니다.
4. 프록시는 `/api-partner/v1/apps-in-toss/messenger/send-message`를 호출하고 Toss 응답의
   `resultType`, `msgCount`, `sentPushCount`, `sentInboxCount`, `detail`, `fail`,
   `reachFailReason`을 앱이 저장하기 쉬운 형태로 정규화합니다.

## QA 체크리스트

- 승인된 템플릿이 `message_templates`에 등록되어 있습니다.
- 사전 동의가 필요한 기능성 템플릿은 템플릿 동의 row가 `OPTED_IN`이 되기 전까지 차단됩니다.
- 마케팅 또는 재방문 유도 템플릿은 마케팅 동의 없이는 차단됩니다.
- provider 응답 요약에 `msgCount`, push/inbox 카운트, 실패 사유, 원본 응답이 저장됩니다.
- outbox enqueue는 안정적인 멱등 키를 사용하고 중복 발송하지 않습니다.
- 쿨다운과 일일 제한은 도입 앱 정책에 맞게 적용됩니다.
- 푸시나 알림함 진입 시 딥링크가 의도한 화면으로 이동합니다.

참고 문서:

- AppsInToss 스마트 메시지 API:
  <https://developers-apps-in-toss.toss.im/smart-message/develop.html>
- AppsInToss 알림 동의문 SDK:
  <https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%ED%84%B0%EB%A0%89%EC%85%98/requestNotificationAgreement.html>
