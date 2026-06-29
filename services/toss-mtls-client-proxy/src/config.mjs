import { existsSync, readdirSync } from "node:fs";
import {
  DEFAULT_IAP_ORDER_STATUS_MAX_ATTEMPTS,
  DEFAULT_IAP_ORDER_STATUS_RETRY_DELAY_MS,
  configError,
  parseNonNegativeInteger,
  parsePositiveInteger,
} from "@trailbase-apps-in-toss-kit/toss-mtls-core";

export const DEFAULT_PORT = 8787;
export const DEFAULT_CERT_DIR = "/run/mtls";
export const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 1_048_576;
export const DEFAULT_UPSTREAM_BODY_LIMIT_BYTES = 2_097_152;
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;

const VALID_MODES = new Set(["stub", "forward"]);
const TOSS_CERT_FILE_SUFFIX = "_public.crt";
const TOSS_KEY_FILE_SUFFIX = "_private.key";

export function createConfig(env = process.env) {
  const certDir = env.MTLS_CERT_DIR || DEFAULT_CERT_DIR;
  const tossCertificatePair = detectTossCertificatePair(certDir);
  return {
    port: parsePort(env.PORT, DEFAULT_PORT),
    mode: String(env.MTLS_PROXY_MODE || env.TOSS_PROXY_MODE || "stub").trim().toLowerCase(),
    internalToken: env.MTLS_PROXY_TOKEN || env.TOSS_PROXY_INTERNAL_TOKEN || "",
    upstreamBaseUrl: env.MTLS_UPSTREAM_BASE_URL || env.TOSS_API_BASE_URL || "",
    certDir,
    clientCertPath:
      env.MTLS_CLIENT_CERT_PATH ||
      tossCertificatePair?.clientCertPath ||
      joinPath(certDir, "client-cert.pem"),
    clientKeyPath:
      env.MTLS_CLIENT_KEY_PATH ||
      tossCertificatePair?.clientKeyPath ||
      joinPath(certDir, "client-key.pem"),
    caCertPath: env.MTLS_CA_CERT_PATH || optionalExistingPath(joinPath(certDir, "ca-cert.pem")),
    tossPromotionCode: env.TOSS_PROMOTION_CODE || "",
    tossPromotionAmount: parsePositiveInteger(env.TOSS_PROMOTION_AMOUNT, 50),
    requestBodyLimitBytes: parsePositiveInteger(env.MTLS_PROXY_REQUEST_BODY_LIMIT_BYTES, DEFAULT_REQUEST_BODY_LIMIT_BYTES),
    upstreamBodyLimitBytes: parsePositiveInteger(env.MTLS_PROXY_UPSTREAM_BODY_LIMIT_BYTES, DEFAULT_UPSTREAM_BODY_LIMIT_BYTES),
    upstreamTimeoutMs: parsePositiveInteger(env.MTLS_PROXY_UPSTREAM_TIMEOUT_MS, DEFAULT_UPSTREAM_TIMEOUT_MS),
    iapOrderStatusMaxAttempts: parsePositiveInteger(
      env.MTLS_PROXY_IAP_ORDER_STATUS_MAX_ATTEMPTS,
      DEFAULT_IAP_ORDER_STATUS_MAX_ATTEMPTS,
    ),
    iapOrderStatusRetryDelayMs: parseNonNegativeInteger(
      env.MTLS_PROXY_IAP_ORDER_STATUS_RETRY_DELAY_MS,
      DEFAULT_IAP_ORDER_STATUS_RETRY_DELAY_MS,
    ),
    debug: parseBoolean(env.MTLS_PROXY_DEBUG || env.TOSS_PROXY_DEBUG),
  };
}

export function validateConfig(config) {
  const mode = String(config.mode || "").trim().toLowerCase();
  if (!VALID_MODES.has(mode)) {
    throw configError("INVALID_MTLS_PROXY_MODE", "MTLS_PROXY_MODE must be stub or forward");
  }
  if (mode !== "forward") {
    return;
  }
  if (!stringOrUndefined(config.internalToken)) {
    throw configError("MISSING_MTLS_PROXY_TOKEN", "MTLS_PROXY_TOKEN is required in forward mode");
  }
  if (!stringOrUndefined(config.upstreamBaseUrl)) {
    throw configError("MISSING_MTLS_UPSTREAM_BASE_URL", "MTLS_UPSTREAM_BASE_URL is required in forward mode");
  }
  let upstream;
  try {
    upstream = new URL(config.upstreamBaseUrl);
  } catch (error) {
    throw configError("INVALID_MTLS_UPSTREAM_BASE_URL", "MTLS_UPSTREAM_BASE_URL must be a valid URL", error);
  }
  if (!["http:", "https:"].includes(upstream.protocol)) {
    throw configError("INVALID_MTLS_UPSTREAM_BASE_URL", "MTLS_UPSTREAM_BASE_URL must use http or https");
  }
}

export function requestBodyLimitBytes(config = {}) {
  return parsePositiveInteger(config.requestBodyLimitBytes, DEFAULT_REQUEST_BODY_LIMIT_BYTES);
}

export function upstreamBodyLimitBytes(config = {}) {
  return parsePositiveInteger(config.upstreamBodyLimitBytes, DEFAULT_UPSTREAM_BODY_LIMIT_BYTES);
}

export function upstreamTimeoutMs(config = {}) {
  return parsePositiveInteger(config.upstreamTimeoutMs, DEFAULT_UPSTREAM_TIMEOUT_MS);
}

export function iapOrderStatusMaxAttempts(config = {}) {
  return parsePositiveInteger(config.iapOrderStatusMaxAttempts, DEFAULT_IAP_ORDER_STATUS_MAX_ATTEMPTS);
}

export function iapOrderStatusRetryDelayMs(config = {}) {
  return parseNonNegativeInteger(config.iapOrderStatusRetryDelayMs, DEFAULT_IAP_ORDER_STATUS_RETRY_DELAY_MS);
}

function detectTossCertificatePair(dir) {
  try {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();

    const certPrefixes = new Set(
      files
        .filter((file) => file.endsWith(TOSS_CERT_FILE_SUFFIX))
        .map((file) => file.slice(0, -TOSS_CERT_FILE_SUFFIX.length)),
    );
    const keyPrefixes = new Set(
      files
        .filter((file) => file.endsWith(TOSS_KEY_FILE_SUFFIX))
        .map((file) => file.slice(0, -TOSS_KEY_FILE_SUFFIX.length)),
    );
    const pairPrefixes = [...certPrefixes].filter((prefix) => keyPrefixes.has(prefix));

    if (pairPrefixes.length !== 1) {
      return null;
    }

    const prefix = pairPrefixes[0];
    return {
      clientCertPath: joinPath(dir, `${prefix}${TOSS_CERT_FILE_SUFFIX}`),
      clientKeyPath: joinPath(dir, `${prefix}${TOSS_KEY_FILE_SUFFIX}`),
    };
  } catch {
    return null;
  }
}

function joinPath(dir, file) {
  return `${String(dir || ".").replace(/\/+$/, "")}/${file}`;
}

function parsePort(value, fallback) {
  if (value == null || String(value).trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function stringOrUndefined(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : undefined;
}

export function optionalExistingPath(path) {
  return path && existsSync(path) ? path : undefined;
}
