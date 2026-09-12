# 계정 전환과 앱 복귀

저장소 namespace마다 `createAppsInTossSessionManager`를 하나만 사용하세요. 새 작업은
이전 작업을 대체합니다. 늦게 도착한 bootstrap·복원·로그인은 새 인증 정보를 덮어쓰지 않고
`StaleAppSessionOperationError`로 종료됩니다. 백엔드 콜백의 선택적 두 번째 인자
`{ signal }`에 담긴 `AbortSignal`을 HTTP 요청에 넘기세요. Native SDK 화면이나 이미 전달된 서버 변경 요청은
취소되지 않을 수 있습니다. 저장소 쓰기를 직렬화해 이전 쓰기가 끝난 뒤 새 인증 정보나
`clearSessions()`의 삭제가 반영되게 합니다. 같은 저장소 키를 쓰는 여러 manager 사이에는
이 조정이 적용되지 않으므로 화면마다 별도 인스턴스를 만들지 마세요.
여러 키의 저장·삭제는 한 대기 작업으로 처리합니다. 저장 중단·실패 시
`<appSessionStorageKey>.writePending` 표식이 복원을 차단합니다.
`AppSessionStorageIncompleteError`가 발생하면 명시적으로 `clearSessions()`나 로그인으로
복구하세요. 표식만 지우거나 개별 키를 직접 복원하면 안 됩니다. 이 내부 키도 같은 영속
저장소 namespace에 유지하세요.
명시적인 익명 bootstrap도 불완전한 저장소에서는 거부합니다. 먼저 clear 또는 새 Toss
로그인으로 복구하세요. 저장소 키와 표식 이름은 서로 달라야 합니다. 복원 중 네트워크·
타임아웃·서버 오류에는 인증 정보를 보존합니다. `isInvalidSessionError(error) === true`인
경우에만 거부된 인증 정보를 지우며, 기본값은 `TrailBaseHttpError`의 401/403입니다.
커스텀 백엔드 어댑터는 확정된 무효·폐기 세션을 판별하는 함수를 제공하세요. 그 외 오류는
재시도할 수 있습니다.

`createAppsInTossSessionLifecycle`은 계정 전환과 앱 복귀를 한 경로로 연결합니다. 패키지
루트, `apps-in-toss`, `session-lifecycle`에서 내보냅니다. 도입 후 인증 작업은 이 경로로
실행하고 TrailBase 공식 인증과 서버 `_user` principal을 계속 사용하세요.

```ts
const lifecycle = createAppsInTossSessionLifecycle({
  manager,
  getUserId: (user) => user.id,
  clearUserData: async () => {
    await userQueryClient.cancelQueries();
    userQueryClient.clear();
    // 앱 소유 사용자 store도 비우고, 구독자는 이전 화면 데이터를 숨기세요.
  },
  refreshEntitlements: (scope) => backend.readEntitlements({
    authTokens: scope.session.authTokens,
    signal: scope.signal,
  }),
  reconcilePending: (scope) => backend.queryPendingWork({
    authTokens: scope.session.authTokens,
    signal: scope.signal,
  }),
});
await lifecycle.start();
```

위 backend와 query client는 소비 앱이 제공하는 어댑터입니다. 복구 확인은 기존 주문·요청
ID를 조회해야 합니다. 재화를 무조건 재지급하거나 새 프로모션 거래키를 발급하거나 결과가
불명확한 메시지를 재발송하면 안 됩니다. 이용 권한은 백엔드 결과로만 판단하고 캐시된 SDK
구독 상태로 승인하지 마세요.

전환 시 이전 scope를 즉시 취소하고 세션·이용 권한이 없는 `transitioning` 상태를 알립니다.
기존 구독과 사용자 캐시를 정리한 뒤 새 세션을 가져옵니다. 권한 재조회와 선택적 미완료 작업
확인이 끝나야 `ready`가 됩니다. 실패 시 사용 가능한 사용자 데이터를 남기지 않고 작업이
reject되므로 재시도·로그인 상태를 표시하세요. `getSnapshot()`과 `subscribe(listener)`로
앱 상태를 연결할 수 있습니다. 구독자는 동기 함수여야 하며 예외를 던지면 안 됩니다.

요청·캐시 키·콜백에는 현재 scope를 사용하세요.

```ts
const scope = lifecycle.getSnapshot().scope;
if (scope) {
  const key = scope.cacheKey('balance'); // principal + revision, A → B → A도 구분
  const value = await scope.run((current) => backend.readBalance({
    authTokens: current.session.authTokens, signal: current.signal,
  }));
  scope.commit(() => setBalance(value)); // 동기 변경만. 내부에서 await하지 마세요.
  const subscription = subscribeBalance((value) => {
    scope.commit(() => setBalance(value));
  });
  await scope.registerCleanup(() => subscription.close());
}
```

백엔드가 취소를 무시해도 `run`은 오래된 결과를 reject하고, `commit`은 현재 ready scope만
갱신합니다. 비동기 작업 안에서 guarded commit 전에 전역 UI·캐시를 직접 바꾸지 마세요.
구독을 만든 직후 정리를 등록하고 비동기 연결 준비에도 signal을 넘기세요. 화면 이탈에 따른
취소 오류도 처리해야 합니다. 정리 콜백은 비동기여도 되며 일부가 실패해도 모두 실행을
시도합니다. 이미 닫힌 scope에 등록하면 즉시 정리합니다. Reject된 작업에는 호출자의
오류 처리도 필요합니다.

실제로 foreground에 복귀하면 `resume()`을 호출하세요. 연결 해제 후 자동으로 익명 계정을
만들지 않고, 저장된 세션과 현재 권한을 다시 확인합니다.

```ts
let previous = AppState.currentState;
const subscription = AppState.addEventListener('change', (next) => {
  const returned = next === 'active' && previous !== 'active';
  previous = next;
  // SDK 로그인도 AppState를 바꿀 수 있으므로 진행 중 인증을 중단하지 마세요.
  if (returned && lifecycle.getSnapshot().phase === 'ready') {
    void lifecycle.resume().catch(showSessionError);
  }
});
// 앱 루트 종료 시: subscription.remove(); await lifecycle.dispose();
```

공식 [React Native AppState 문서](https://reactnative.dev/docs/appstate)를 참고하고 앱 루트에
한 번만 연결하세요. `signInWithToss()`는 백엔드가 정한 canonical principal로 전환합니다.
익명 진행도·재화 통합은 서버에서 처리할 앱 정책이며 클라이언트 복사 작업이 아닙니다.
`disconnect()`는 로컬 인증 정보와 현재 사용자 리소스를 정리합니다. Toss 연결 해제나 서버
토큰 폐기는 별도 인증된 서버 경로에서 처리하고, 백엔드도 disabled 계정을 차단해야 합니다.
[토스 로그인](https://developers-apps-in-toss.toss.im/login/intro.html)을 참고하세요.
Disconnect 이후에는 명시적인 시작·로그인 동작을 사용합니다. `dispose()`는 저장된 인증
정보를 지우지 않고 lifecycle만 종료하므로 일반적인 앱 종료가 로그아웃이 되지 않습니다.
정리 실패를 포함해 dispose는 최종 동작입니다. 반복 호출은 같은 정리 결과를 반환하므로
앱 종료 경로에서 실패를 처리하세요. 종료한 lifecycle은 재사용하거나 다시 구독할 수 없습니다.
Disconnect는 사용자 리소스 정리가 실패해도 인증 정보 삭제를 시도한 뒤 작업 reject로
정리 오류를 전달합니다.

스키마 마이그레이션이나 프록시 배포는 필요하지 않습니다. Canonical 계정 통합, B로 전환한
뒤 늦게 온 A 요청, 복귀 중 구독 권한 변경, 정리 실패, 연결 해제 후 재접속을 소비 앱에서
검증하세요.
