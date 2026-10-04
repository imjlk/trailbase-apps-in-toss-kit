# 어필리에이트 상품 매칭

비공개 백엔드 또는 카탈로그 워커에서 `@trailbase-apps-in-toss-kit/trailbase-runtime/affiliate/matching`을 사용합니다. 정규화된 어댑터 상품을 받는 헬퍼이며, 공급자 검색·인증정보 발급·DB 저장·쿠팡 어댑터는 구현하지 않습니다.

`matchAffiliateProducts`는 **카테고리(하위 분류 포함)와 상품명 키워드 모두** 일치해야 합니다. NFKC·대소문자·공백 정규화에 기반한 문자열 매칭이며 의미 분석이나 동의어 추론은 하지 않습니다. 공급자 순서를 유지합니다. 앱이 키워드를 검토하고 모호한 단어의 제외 조건을 관리해야 합니다(예: 베개 상품에서 ‘커버’ 제외).

```js
import { matchAffiliateProducts, issueAffiliateCandidateLink }
  from '@trailbase-apps-in-toss-kit/trailbase-runtime/affiliate/matching';

const candidates = matchAffiliateProducts({
  categories: await provider.categories(),
  products: await provider.list({ source: 'category-best', categoryId }),
  categoryId, // 실제 공급자 카테고리 트리와 대조한 ID.
  keywords: ['베개'],
  excludedKeywords: ['커버'],
  excludedCategoryIds: [],
  excludedProductIds: [],
  limit: 3,
});
const result = await issueAffiliateCandidateLink({
  candidates,
  issueLink: (id) => provider.issueLink(id),
  validateLink: isAllowedIssuedLink, // 공급자별 동기 URL 검증 함수.
});
// 결과: { product, url, attempts }; 후보 소진 시 product/url은 null.
```

호출자가 `isAllowedIssuedLink`를 제공합니다. 발급된 HTTPS URL의 정확한 허용 호스트를 검사하고 사용자정보·제어문자·역슬래시를 거부하세요. 제휴 파라미터를 임의 생성하지 않습니다. 인증·요청 제한시간·쿨다운·링크 만료 정책은 공급자 어댑터가 담당합니다. 예시처럼 `issueLink`의 메서드 바인딩을 보존하세요.

## 계약과 제한

상품은 `id`(영문/숫자/밑줄/하이픈 1–80자), `title`(제어문자 없는 1–180자), `categoryIds`(최대 32개 ID), 명시적 `soldOut: false`, 선택적 유한 epoch 밀리초 `endAt`을 가집니다. 판매 가능 상태가 없으면 제외합니다. 카테고리 노드는 `id`와 선택적 `children`을 가지며 ID는 중복될 수 없습니다. 선택한 카테고리를 찾지 못하면 빈 결과를 반환합니다. 제외 분류의 하위 분류도 제외하며 상품이 허용 분류에 동시에 속해도 제외가 우선합니다.

매칭 입력은 상품 1,000개, 분류 노드 1,000개, 깊이 8(루트 0), 긍정/제외 키워드 각각 8개(2–40자), 제외 상품/분류 ID 각각 1,000개까지입니다. 잘못된 설정은 선택 범위를 넓히지 않고 예외를 발생시킵니다. 후보 `limit` 기본값은 3, 최대 10입니다. 적격 상품 ID 중복을 제거합니다. `now`는 epoch 밀리초 숫자이며 `minValidityMs` 기본값은 60초입니다.

발급은 후보 최대 10개, `maxAttempts` 기본값 3(최대 3)을 받습니다. 무효·만료·중복 후보는 시도 횟수를 소모하지 않습니다. 링크 발급 전후로 상품 유효기간을 검사합니다. 여기서 `now`는 매칭의 숫자 스냅샷과 달리 시계 함수입니다. `null` 또는 `code`가 `item-unavailable`인 오류만 다음 후보로 넘어갑니다. 인증·쿼터·통신 등 다른 오류는 즉시 전파하며 잘못된 URL은 `invalid-link`를 발생시킵니다. 원본 공급자 오류를 로그에 남기지 마세요. 호출자의 갱신 루프도 전역 오류 후 멈추거나 어댑터 쿨다운을 존중해야 하며 나머지 모든 규칙을 재시도하면 안 됩니다.

반환 상품은 원본 객체입니다. 발급 도중 입력을 수정하지 마세요. 상품 `endAt`은 발급 링크의 유효기간 보장이 아닙니다. 어댑터 링크 정책과 상품 만료 중 짧은 기간으로 저장하고 사용 시 재검증/갱신하세요. DB 트랜잭션, 규칙 revision 비교 후 저장, 수동 링크 우선순위, 일별 배치, CTR 순위, 고지 UI는 앱이 관리합니다. 기존 카탈로그 선택기나 소비자 동작은 자동으로 바뀌지 않습니다.

하위 분류만 가진 상품, 모호한 키워드 제외, 품절/만료, 개별 상품 거절 후 다음 상품 성공, 인증/쿼터 실패 시 두 번째 요청 없음 등을 검증하세요. 운영 활성화 전 실제 공급자 승인·키·발급 링크 검증은 여전히 필요합니다.
