#!/bin/sh

trailbase_runtime_warn() {
  printf 'Warning: %s\n' "$*" >&2
}

trailbase_runtime_die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

trailbase_runtime_trim_trailing_slash() {
  printf '%s' "${1:-}" | sed 's#/*$##'
}

trailbase_runtime_normalize_public_url() {
  value="${1:-}"
  app_env="${2:-${APP_ENV:-development}}"

  if [ -z "$value" ]; then
    return 0
  fi

  case "$value" in
    http://*|https://*) ;;
    *) value="https://$value" ;;
  esac

  normalized="$(printf '%s' "$value" | sed -E 's#^(https?://[^/:]+)(:[0-9]+)?(/.*)?$#\1#')"
  if [ "$app_env" = "production" ]; then
    normalized="$(printf '%s' "$normalized" | sed -E 's#^http://#https://#')"
  fi

  trailbase_runtime_trim_trailing_slash "$normalized"
}

trailbase_runtime_get_env() {
  name="$1"
  eval "printf '%s' \"\${$name:-}\""
}

trailbase_runtime_resolve_public_url() {
  explicit_env="${1:-APP_BASE_URL}"
  default_url="${2:-http://localhost:4000}"
  app_env="${3:-${APP_ENV:-development}}"

  value="$(trailbase_runtime_get_env "$explicit_env")"
  if [ -n "$value" ]; then
    trailbase_runtime_normalize_public_url "$value" "$app_env"
    return 0
  fi

  for name in \
    SERVICE_FQDN_TRAILBASE_4000 \
    SERVICE_FQDN_TRAILBASE \
    SERVICE_URL_TRAILBASE_4000 \
    SERVICE_URL_TRAILBASE \
    COOLIFY_FQDN \
    COOLIFY_URL
  do
    value="$(trailbase_runtime_get_env "$name")"
    if [ -n "$value" ]; then
      trailbase_runtime_normalize_public_url "$value" "$app_env"
      return 0
    fi
  done

  trailbase_runtime_normalize_public_url "$default_url" "$app_env"
}

trailbase_runtime_is_placeholder_value() {
  value="${1:-}"
  case "$value" in
    ''|dev-*|test-*|*change-me*|*changeme*|*replace-with*|*placeholder*|*example.com*|*example.invalid*)
      return 0
      ;;
  esac
  return 1
}

trailbase_runtime_require_production_value() {
  name="$1"
  value="${2:-}"

  if trailbase_runtime_is_placeholder_value "$value"; then
    trailbase_runtime_die "refusing placeholder production environment variable: $name"
  fi
}

trailbase_runtime_require_https_url() {
  name="$1"
  value="${2:-}"

  case "$value" in
    https://*) ;;
    *) trailbase_runtime_die "$name must be an https:// URL in production" ;;
  esac
}

trailbase_runtime_port_is_available() {
  port="${1:-}"
  host="${2:-127.0.0.1}"

  case "$port" in
    ''|*[!0-9]*) return 1 ;;
  esac

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    sock.bind((host, port))
except OSError:
    sys.exit(1)
finally:
    sock.close()
sys.exit(0)
PY
    return $?
  fi

  if command -v nc >/dev/null 2>&1; then
    if nc -z "$host" "$port" >/dev/null 2>&1; then
      return 1
    fi
    return 0
  fi

  return 0
}

trailbase_runtime_find_available_port() {
  preferred="${1:-}"
  label="${2:-port}"
  host="${3:-127.0.0.1}"
  max_attempts="${4:-100}"

  case "$preferred" in
    ''|*[!0-9]*) trailbase_runtime_die "$label must be a numeric port" ;;
  esac
  case "$max_attempts" in
    ''|*[!0-9]*) max_attempts=100 ;;
  esac

  port="$preferred"
  attempts=0
  while [ "$attempts" -lt "$max_attempts" ]; do
    if trailbase_runtime_port_is_available "$port" "$host"; then
      if [ "$port" != "$preferred" ]; then
        trailbase_runtime_warn "$label port $preferred is already in use on $host; using $port"
      fi
      printf '%s' "$port"
      return 0
    fi
    attempts=$((attempts + 1))
    port=$((port + 1))
  done

  trailbase_runtime_die "could not find an available $label port starting at $preferred"
}

trailbase_runtime_export_available_port() {
  env_name="$1"
  preferred="${2:-}"
  label="${3:-$env_name}"
  host="${4:-127.0.0.1}"

  current="$(trailbase_runtime_get_env "$env_name")"
  if [ -n "$current" ]; then
    preferred="$current"
  fi

  selected="$(trailbase_runtime_find_available_port "$preferred" "$label" "$host")"
  eval "$env_name=\"\$selected\""
  export "$env_name"
}

trailbase_runtime_apply_fresh_start_once() {
  traildepot="$1"
  marker_root="$2"
  token="${3:-}"
  confirm="${4:-}"

  if [ -z "$token" ]; then
    return 0
  fi
  if [ "$confirm" != "DELETE_TRAILBASE_DATA" ]; then
    trailbase_runtime_die "TRAILBASE_FRESH_START_TOKEN is set but confirmation is not DELETE_TRAILBASE_DATA"
  fi
  case "$traildepot" in
    ''|/|/app|/app/) trailbase_runtime_die "unsafe TrailBase depot path for fresh start: $traildepot" ;;
  esac

  marker_file="$marker_root/trailbase-fresh-start-token"
  mkdir -p "$traildepot" "$marker_root"

  last_token=""
  if [ -f "$marker_file" ]; then
    last_token="$(cat "$marker_file")"
  fi

  if [ "$last_token" = "$token" ]; then
    return 0
  fi

  trailbase_runtime_warn "fresh-starting TrailBase data for token: $token"
  find "$traildepot" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  printf '%s' "$token" > "$marker_file"
}

trailbase_runtime_sync_config_site_url() {
  file="$1"
  url="$2"
  tmp="$file.tmp.$$"

  [ -f "$file" ] || trailbase_runtime_die "config file does not exist: $file"

  if grep -q 'site_url:' "$file"; then
    awk -v url="$url" '
      /^[[:space:]]*site_url:[[:space:]]*"/ {
        match($0, /^[[:space:]]*/)
        print substr($0, 1, RLENGTH) "site_url: \"" url "\""
        next
      }
      { print }
    ' "$file" > "$tmp"
  else
    awk -v url="$url" '
      { print }
      /^[[:space:]]*server[[:space:]]*\{/ && !inserted {
        match($0, /^[[:space:]]*/)
        print substr($0, 1, RLENGTH) "  site_url: \"" url "\""
        inserted = 1
      }
      END {
        if (!inserted) {
          print "site_url: \"" url "\""
        }
      }
    ' "$file" > "$tmp"
  fi

  mv "$tmp" "$file"
}

trailbase_runtime_copy_if_exists() {
  source="$1"
  target="$2"

  if [ -d "$source" ]; then
    mkdir -p "$target"
    cp -a "$source"/. "$target"/
  fi
}

trailbase_runtime_copy_template_migrations() {
  template="$1"
  traildepot="$2"
  source="$template/migrations/main"
  target="$traildepot/migrations/main"

  if [ -d "$source" ]; then
    mkdir -p "$target"
    cp "$source"/*.sql "$target"/ 2>/dev/null || true
  fi
}

trailbase_runtime_copy_components() {
  components_image="$1"
  traildepot="$2"

  if [ ! -d "$components_image" ]; then
    return 0
  fi

  mkdir -p "$traildepot/wasm" "$traildepot/components"
  for component in "$components_image"/*.wasm; do
    if [ -f "$component" ]; then
      cp "$component" "$traildepot/wasm/"
      cp "$component" "$traildepot/components/"
    fi
  done
}

trailbase_runtime_json_escape() {
  printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

trailbase_runtime_setting_value() {
  name="$1"
  value="$(trailbase_runtime_get_env "$name")"
  trailbase_runtime_json_escape "$value"
}

trailbase_runtime_setting_or_default() {
  name="$1"
  default_value="${2:-}"
  value="$(trailbase_runtime_get_env "$name")"
  if [ -z "$value" ]; then
    value="$default_value"
  fi
  trailbase_runtime_json_escape "$value"
}

trailbase_runtime_write_settings_json() {
  file="$1"
  shift
  tmp="$file.tmp.$$"

  mkdir -p "$(dirname "$file")"
  {
    printf '{\n'
    first=true
    for pair in "$@"; do
      key="${pair%%=*}"
      value="${pair#*=}"
      if [ "$first" = "true" ]; then
        first=false
      else
        printf ',\n'
      fi
      printf '  "%s": "%s"' \
        "$(trailbase_runtime_json_escape "$key")" \
        "$(trailbase_runtime_json_escape "$value")"
    done
    printf '\n}\n'
  } > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

trailbase_runtime_public_url_args() {
  public_url="${1:-}"
  if [ -n "$public_url" ]; then
    printf '%s\n%s\n' "--public-url" "$public_url"
  fi
}

trailbase_runtime_exec_trail_run() {
  trail_bin="${TRAIL_BIN:-/app/trail}"
  traildepot="$1"
  address="$2"
  runtime_root="$3"
  public_dir="$4"
  public_url="${5:-}"

  if [ "$(id -u)" = "0" ]; then
    chown -R trailbase:trailbase "$traildepot" "$runtime_root" 2>/dev/null || true
    if [ -n "$public_url" ]; then
      exec su trailbase -s /bin/sh -c "\"$trail_bin\" --data-dir \"$traildepot\" --public-url \"$public_url\" run --address \"$address\" --runtime-root-fs \"$runtime_root\" --spa --public-dir \"$public_dir\""
    fi
    exec su trailbase -s /bin/sh -c "\"$trail_bin\" --data-dir \"$traildepot\" run --address \"$address\" --runtime-root-fs \"$runtime_root\" --spa --public-dir \"$public_dir\""
  fi

  if [ -n "$public_url" ]; then
    exec "$trail_bin" --data-dir "$traildepot" --public-url "$public_url" run --address "$address" --runtime-root-fs "$runtime_root" --spa --public-dir "$public_dir"
  fi
  exec "$trail_bin" --data-dir "$traildepot" run --address "$address" --runtime-root-fs "$runtime_root" --spa --public-dir "$public_dir"
}
