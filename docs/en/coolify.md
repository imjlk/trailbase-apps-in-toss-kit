# Coolify Deployment Notes

Add the proxy service in the same Compose project as TrailBase and enable it with
`COMPOSE_PROFILES=toss-proxy`.

Start from the Compose snippet at
[`templates/trailbase/compose/toss-mtls-client-proxy.yml`](../../templates/trailbase/compose/toss-mtls-client-proxy.yml).
The snippet keeps the proxy internal by using `expose: ["8787"]` instead of a public port mapping.
TrailBase and non-TrailBase backends in the same Coolify Compose project can use the same internal
service URL and token boundary.

Do not configure a public domain for `toss-mtls-client-proxy`. Configure the public domain only for
TrailBase or the application backend. The backend service should call:

```text
MTLS_PROXY_URL=http://toss-mtls-client-proxy:8787
```

Set a non-empty `MTLS_PROXY_TOKEN` before enabling `MTLS_PROXY_MODE=forward`; the proxy refuses to
start in forward mode without it.

Copy certificate files into the persistent `mtls_client_certs` volume. Keep them readable only by
the proxy container user and never bake them into Docker images. The proxy first auto-detects a
single Toss Console pair named `*_public.crt` and `*_private.key` under `/run/mtls`, so the normal
setup does not need per-file path env vars. If there is no complete pair, it falls back to
`MTLS_CLIENT_CERT_PATH` and `MTLS_CLIENT_KEY_PATH`.
