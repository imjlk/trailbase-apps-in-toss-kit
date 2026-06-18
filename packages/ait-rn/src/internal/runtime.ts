export function isProductionEnv(env: string | undefined) {
  return env?.trim().toLowerCase() === "production";
}

export function readRuntimeEnv() {
  return readEnv("APP_ENV") ?? readEnv("NODE_ENV");
}

export function isProductionRuntime() {
  return isProductionEnv(readRuntimeEnv());
}

export function resolveRuntimeEnv({
  env,
  production,
}: {
  env?: string;
  production?: boolean;
}) {
  if (env !== undefined) {
    return env;
  }
  if (production === true) {
    return "production";
  }
  if (production === false) {
    return "development";
  }
  return readRuntimeEnv() ?? "";
}

export function readEnv(name: string) {
  if (typeof process === "undefined") {
    return undefined;
  }
  return process.env?.[name]?.trim().toLowerCase();
}

