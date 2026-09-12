# Apps in Toss 응답 계약 fixture

`apps-in-toss.v1.json`은 Rust guest, 프록시, RN 클라이언트 전송, 원장 진단 테스트가
공유하는 합성 데이터입니다. 실제 사용자 기록이나 현재 구현에서 자동 생성한 결과,
실제 제공사 호출 테스트가 아닙니다.

IAP 사례는 모든 허용 별칭, 명시적 실패, 제공사 SKU 없는 결제 성공 응답을 포함하며
원장 상태와 검증된 제공사 증거를 구분합니다. 메시지는 채널별 부분 발송을 유지하고
빈 응답을 UNKNOWN으로 분류합니다. 프로모션 실패 응답에 성공 상태가 섞여 있어도
지급 완료로 처리하지 않습니다.

예상 결과는 구현과 독립적으로 관리하세요. 계약을 변경할 때 관련 fixture와 사용처를
함께 검증합니다. Fixture 수정은 Rust, JS, 프록시 워크플로를 실행합니다. 상태 문자열만으로
지급하지 말고 소유권·SKU·동의·원래 거래키·기존 상태 전이 helper를 계속 확인하세요.

`cargo test --workspace`와
`bun test packages/trailbase-runtime packages/trailbase-client packages/ait-rn services/toss-mtls-client-proxy`로 실행합니다.
Fixture 형식은 버전으로 구분하고 지원 입력을 추가할 때 기존 호환 사례를 유지하세요.
