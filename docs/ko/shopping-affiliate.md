# 선택적으로 사용하는 토스쇼핑 제휴 링크

RN의 `./shopping` 진입점은 운영자가 발급받은 링크와 주입한 URL 열기 함수를
사용합니다. 제휴 가입, 추천 URL 생성, 상품 선정, 구매 검증, 포인트 지급은
수행하지 않습니다. TrailBase 마이그레이션이나 mTLS 어댑터는 필요하지 않습니다.
상품 선택과 노출 위치는 소비자 앱이 결정합니다.

```ts
import { openURL } from "@granite-js/react-native";
import {
  createAppsInTossShoppingBridge,
  normalizeAppsInTossShoppingLink,
} from "@trailbase-apps-in-toss-kit/ait-rn/shopping";

// 앱의 모든 노출 위치가 하나의 인스턴스를 공유합니다.
const shopping = createAppsInTossShoppingBridge({ openURL });
const link = normalizeAppsInTossShoppingLink(operatorConfiguredLink);
// link가 null이면 영역을 숨깁니다. 사용자가 버튼을 눌렀을 때만 호출합니다.
const result = await shopping.open(link);
// failed: 재시도 안내. busy: 중복 탭 무시.
// dispatched: 네이티브 URL 호출 완료이며 구매 전환 확인이 아닙니다.
```

`https://toss.shopping/...`과 `https://toss.im/...`만 허용하며, 사용자 정보가
포함된 주소, 별도 포트, 잘못된 URL, 유사 도메인은 거부합니다. 발급된 쿼리
문자열을 그대로 보존하며 사용자 ID나 추측한 제휴 파라미터를 붙이지 않습니다.
주소 검증만으로 쇼핑 링크인지, 운영자의 제휴 계정에 귀속되는지는 알 수 없습니다.
실제 링크를 발급받아 확인한 뒤 노출을 활성화하세요. 공통 쇼핑 진입 링크 하나를
여러 위치에서 사용하면 콘텐츠마다 상품을 수동 연결할 필요가 없습니다.

소비자 앱의 책임:

- 미설정 영역은 숨기고 기존 광고와 주요 기능은 유지합니다.
- 링크 옆에 “이 링크를 통해 구매하면 운영자가 수수료를 받을 수 있어요.”처럼
  수수료 고지를 눈에 보이게 표시합니다.
- “토스쇼핑 둘러보기”와 같은 중립적인 문구를 사용합니다. 별도 근거 없이
  맞춤 상품, 할인, 보상을 약속하지 않습니다.
- 화면을 보는 동안 선택된 배너를 유지하고 기존 광고 간격을 사용합니다.
- 이동 시 원래 화면과 선택을 보존합니다. 열기 성공만으로 상태를 지우지 않고,
  출시 전에 실제 Android/iOS에서 돌아오는 동작을 확인합니다.
- 위치와 `open_dispatched` / `open_failed` 같은 결과만 기록합니다. 전체 URL,
  네이티브 오류, 사용자 식별자를 기록하거나 클릭으로 구매를 추정하지 않습니다.
  구매 기여도는 제휴 제공자의 보고서로 확인합니다.

문서화된 [openURL API](https://developers-apps-in-toss.toss.im/documentation/common/screen/open-url.md)를 사용합니다.
브라우저나 연결된 앱을 열며 토스 내부 이동을 보장하지 않습니다.
공식 커뮤니티에는 [쇼핑 이동 전용 SDK가 없다는 답변](https://techchat-apps-in-toss.toss.im/t/topic/4102)과
[Android 복귀 동작 문제](https://techchat-apps-in-toss.toss.im/t/toss-im/4625)가 있습니다.
`intoss://shopping` 경로를 임의로 만들거나 다른 주소로 자동 재시도하지 않습니다.

RN에서는 위 예시처럼 Granite 함수를 주입합니다. Web 소비자도 순수 함수에
지원되는 열기 함수를 주입할 수 있지만 패키지 해석과 Web 이동을 별도로 검증해야
합니다. 이 변경은 `ait-web` 패키지의 계약을 확장하지 않습니다.
