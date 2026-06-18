import { createAnonymousHash } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  defaultFrameworkFunction,
  type AppsInTossAppLogin,
  type AppsInTossGetIsTossLoginIntegratedService,
} from "./internal/framework";
import { isProductionEnv, resolveRuntimeEnv } from "./internal/runtime";

export type {
  AppsInTossAppLogin,
  AppsInTossGetIsTossLoginIntegratedService,
} from "./internal/framework";

export type AppsInTossLoginResult = Awaited<ReturnType<AppsInTossAppLogin>>;

export type AppsInTossLoginBridgeErrorCode =
  | "APP_LOGIN_UNAVAILABLE"
  | "APP_LOGIN_THROWN"
  | "TOSS_LOGIN_INTEGRATION_CHECK_THROWN";

export interface AppsInTossLoginBridgeErrorOptions {
  cause?: unknown;
  code: AppsInTossLoginBridgeErrorCode;
  message: string;
}

export class AppsInTossLoginBridgeError extends Error {
  code: AppsInTossLoginBridgeErrorCode;
  override cause?: unknown;

  constructor({ cause, code, message }: AppsInTossLoginBridgeErrorOptions) {
    super(message);
    this.name = "AppsInTossLoginBridgeError";
    this.code = code;
    this.cause = cause;
  }
}

export interface CreateAppsInTossLoginBridgeOptions {
  appLogin?: AppsInTossAppLogin;
  createDevFallback?: () =>
    | AppsInTossLoginResult
    | Promise<AppsInTossLoginResult>;
  env?: string;
  getIsTossLoginIntegratedService?: AppsInTossGetIsTossLoginIntegratedService;
  production?: boolean;
}

export interface AppsInTossLoginBridge {
  appLogin: AppsInTossAppLogin;
  getIsTossLoginIntegratedService: AppsInTossGetIsTossLoginIntegratedService;
}

export function createAppsInTossLoginBridge({
  appLogin,
  createDevFallback = createDefaultLoginFallback,
  env,
  getIsTossLoginIntegratedService,
  production,
}: CreateAppsInTossLoginBridgeOptions = {}): AppsInTossLoginBridge {
  const resolvedProduction =
    production ?? isProductionEnv(resolveRuntimeEnv({ env, production }));

  return {
    async appLogin() {
      const resolvedAppLogin =
        appLogin ?? (await defaultFrameworkFunction("appLogin"));

      if (!resolvedAppLogin) {
        return handleLoginBridgeUnavailable({
          createDevFallback,
          production: resolvedProduction,
        });
      }

      try {
        return await resolvedAppLogin();
      } catch (error) {
        if (resolvedProduction) {
          throw new AppsInTossLoginBridgeError({
            cause: error,
            code: "APP_LOGIN_THROWN",
            message: "Apps in Toss appLogin request failed.",
          });
        }
        return createDevFallback();
      }
    },
    async getIsTossLoginIntegratedService() {
      const resolvedCheck =
        getIsTossLoginIntegratedService ??
        (await defaultFrameworkFunction("getIsTossLoginIntegratedService"));

      if (!resolvedCheck) {
        return undefined;
      }

      try {
        const result = await resolvedCheck();
        return result === false ? undefined : result;
      } catch (error) {
        if (resolvedProduction) {
          throw new AppsInTossLoginBridgeError({
            cause: error,
            code: "TOSS_LOGIN_INTEGRATION_CHECK_THROWN",
            message: "Apps in Toss login integration check failed.",
          });
        }
        return undefined;
      }
    },
  };
}

async function handleLoginBridgeUnavailable({
  createDevFallback,
  production,
}: {
  createDevFallback: () => unknown | Promise<unknown>;
  production: boolean;
}) {
  if (production) {
    throw new AppsInTossLoginBridgeError({
      code: "APP_LOGIN_UNAVAILABLE",
      message: "Apps in Toss appLogin is not available in this runtime.",
    });
  }
  return createDevFallback();
}

function createDefaultLoginFallback() {
  return {
    authorizationCode: createAnonymousHash({ prefix: "dev-auth" }),
    referrer: "SANDBOX" as const,
  };
}
