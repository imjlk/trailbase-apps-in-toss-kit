# Coolify Deployment Notes

Add the proxy service in the same Compose project as TrailBase and enable it with
`COMPOSE_PROFILES=toss-proxy`.

Do not configure a public domain for `toss-mtls-client-proxy`. Configure the public domain only for
TrailBase. TrailBase should call:

```text
MTLS_PROXY_URL=http://toss-mtls-client-proxy:8787
```

Copy certificate files into the persistent `mtls_client_certs` volume. Keep them readable only by
the proxy container user and never bake them into Docker images.
