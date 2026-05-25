# Coolify 배포 메모

프록시 서비스는 TrailBase와 같은 Compose 프로젝트에 추가하고
`COMPOSE_PROFILES=toss-proxy`로 활성화합니다.

`toss-mtls-client-proxy`에는 공개 도메인을 설정하지 마세요. 공개 도메인은 TrailBase에만
설정합니다. TrailBase는 아래 내부 주소로 프록시를 호출해야 합니다.

```text
MTLS_PROXY_URL=http://toss-mtls-client-proxy:8787
```

`MTLS_PROXY_MODE=forward`를 켜기 전에 비어 있지 않은 `MTLS_PROXY_TOKEN`을 설정하세요.
프록시는 forward 모드에서 토큰이 없으면 시작하지 않습니다.

인증서 파일은 영구 볼륨인 `mtls_client_certs`에 복사합니다. 프록시 컨테이너 사용자만 읽을
수 있게 유지하고, Docker 이미지 안에 넣지 마세요. 프록시는 먼저 `/run/mtls` 아래에서 Toss
Console 인증서 쌍인 `*_public.crt`, `*_private.key`를 자동으로 찾습니다. 따라서 일반적인
설정에서는 파일별 경로 환경 변수가 필요하지 않습니다. 완전한 인증서 쌍이 없으면
`MTLS_CLIENT_CERT_PATH`, `MTLS_CLIENT_KEY_PATH`를 사용합니다.
