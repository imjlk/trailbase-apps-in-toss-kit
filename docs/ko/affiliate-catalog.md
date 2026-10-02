# 서버 제휴 상품 선택

`trailbase-runtime/affiliate/*`는 선택적으로 사용하는 서버 상품 선택 모듈입니다.
기존 RN `ait-rn/shopping`은 명시적인 링크 검증·열기를 담당합니다. 인증서,
mTLS 프록시 변경, DB 마이그레이션, 구매 보상, 사용자 식별정보는 사용하지 않습니다.
첫 실제 어댑터는 토스쇼핑 쉐어링크입니다. 선택 계약은 다른 제공자로 확장할 수
있지만 **쿠팡 어댑터는 이번 구현에 포함하지 않습니다.**

## 역할

- 제공자 어댑터: 인증, 카테고리, 지원 소스, 응답 검증, 추적 링크, 갱신 기준.
  일반 `productUrl`을 제휴 링크로 사용하지 않습니다.
- 공통 선택기: 주제별·기본 카테고리, 소스 가중치, 제외, 제한된 후보 순환,
  상품 없음 처리, 화면 진입 키에 따른 안정적인 선택.
- 소비자: 노출 가능한 공개 콘텐츠에서 주제 ID 추출, 요청 권한 검사, 배치와
  기존 광고 대체 UI, 내부 서비스와 캐시 운영.

`@trailbase-apps-in-toss-kit/trailbase-runtime/affiliate/{toss-sharelink,selection,cache,service}`의
각 진입점에서 `createTossSharelinkProvider`, `createAffiliateCatalog`,
`createAffiliateCache`, `createAffiliateService`를 가져옵니다. 새 의존성은 없으며
Bun 또는 최신 Node 서버에서 사용합니다.

```js
const cache = createAffiliateCache({ directory: '/private/affiliate-cache' });
const provider = createTossSharelinkProvider({ accessKey, secretKey, publisherId,
  subTagId, cache });
const catalog = createAffiliateCatalog({ provider, cache, policy: {
  groups: {
    household: { categoryIds: approvedHouseholdCategoryIds },
    food: { categoryNames: ['식품'] },
  },
  defaultGroups: ['household', 'food'],
  sourceWeights: { 'category-best': 1, 'today-deals': 1 },
  allowOverallBest: false,
  excludedCategoryIds: [], blockedProductIds: [],
} });
const fetch = createAffiliateService({ catalog, token: internalToken, enabled: true });
```

실제 분류 트리에서 ID를 선택합니다. 정규화한 이름의 정확한 일치도 지원하지만
예시 이름이 실제 분류와 일치한다고 보장하지 않습니다. 상위 분류 제외는 하위까지
적용합니다. 분류를 찾지 못하면 상품 없음이며 전체 베스트로 자동 전환하지 않습니다.
소스 가중치는 0–10 정수이고 미지원 소스는 건너뜁니다. 요청마다 관련 3개·기본
3개 분류, 목록당 첫 30개 상품, 링크 후보 3개로 제한합니다. 전체 상품 검색이 아닙니다.

인증된 `POST /select`에 `{topics, rotationKey, excludeProductIds}`를 전달합니다.
화면이 유지되는 동안 같은 키를 쓰고 다음 진입에서 바꿉니다. 같은 키는 같은
소스·분류 선택을 만듭니다. 최근 상품 제외는 엄격하게 적용하며 후보가 부족해도
강제로 재노출하지 않습니다. 품절·차단·종료·분류 불일치 특가를 제외하고 특가는
5분 이상 남아 있어야 합니다. 반환 상품은 최대 5분 후 만료되므로 소비자가 숨기고
클릭 직전에도 확인해야 합니다. 자동으로 링크를 열지 않습니다.

`GET /health`는 모드·프로토콜 준비 상태이며 실제 승인이나 외부 연결 확인이 아닙니다.
서비스는 비공개로 두고 24자 이상 별도 내부 bearer token을 사용합니다. 소비자 API에서
사용자를 인증합니다. 브라우저가 제공자 경로·주소·비밀키·비공개 원문을 지정하지 못하게 합니다.

## 토스 설정과 제한

[쉐어링크 승인·인증](https://sharelink-docs.toss.im/developers/open-api/auth)에 따라
서비스·노출 지면 승인, Access Key·Secret Key·publisher ID·서버 출발지 IP를 준비합니다.
인증은 `https://oauth2.cert.toss.im/token`의 OAuth이며 앱인토스 mTLS API와 별개입니다.
공식 API는 운영 환경만 제공합니다. 앱별 실적 구분용 `subTagId`는 먼저 등록해야 합니다.

HTTP 상태와 `resultType`을 모두 검사하고 HTTP 200 FAIL을 성공으로 처리하지 않습니다.
코드 없는 링크 거절은 해당 상품을 잠시 제외합니다. 다른 오류는 선택을 중단하고
대기하며 일 사용량 초과는 KST 자정까지 기다립니다. 즉시 무작정 재시도하지 않습니다.
OAuth는 동시 재발급을 합치며 HTTP 401이면 캐시 토큰을 무효화해 다음 요청에서 갱신합니다.
제공자 오류 원문이나 비밀정보는 반환하지 않습니다.

카테고리 트리·카테고리 베스트는 24시간, 전체 베스트는 1시간, 특가는 15분 캐시합니다.
특가 `endAt`은 매 선택마다 별도로 검사합니다. 발급 링크는 재사용하고 토큰은 만료
직전까지 보관합니다. 파일 캐시는 atomic rename과 비공개 권한을 사용하며 bearer
credential도 포함합니다. 비공개 영속 디렉터리로 마운트하고 노출·커밋하지 마세요.
제공자 계정마다 캐시를 분리합니다. 직렬 4 rps 제한은 **인스턴스별**이므로 같은 계정을
여러 인스턴스가 쓰면 전체 호출량을 조율하거나 서비스 하나를 공유해야 합니다.
한도·사용 범위·이미지 권한은 [공식 규약](https://sharelink-docs.toss.im/developers/open-api/convention)을 따릅니다.

이번 공개 상품 응답에는 가격과 이미지가 없습니다. 승인된 상품명, 소스 표시, 명시적
버튼, 수수료 고지를 사용합니다. 결제 시점 가격·재고와 실제 수익은 제공자가 확정합니다.

## 개발 검증

`preview: true`인 fixture 제공자를 주입하면 `url: null`이며 링크를 발급하지 않습니다.
운영 환경에서 mock 모드를 거부해야 합니다. RN의 `normalizeAppsInTossShoppingOffer`는
기본적으로 미리보기를 거부하며 로컬에서만 `allowPreview`를 켭니다. 클릭·분석은 비활성화합니다.

`bun test packages/trailbase-runtime/test/affiliate.test.mjs`와
`bun test packages/ait-rn/test/shopping-offer.test.ts`를 실행합니다. mock 검증이며
실제 키·서비스 승인·수익 귀속·지급 검증을 뜻하지 않습니다.
