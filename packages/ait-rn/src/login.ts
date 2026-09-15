import { createReactNativeIdentity } from "@ait-kit/sdk/rn";
import { createAnonymousHash } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  defaultFrameworkFunction,
  type AppsInTossAppLogin,
  type AppsInTossGetIsTossLoginIntegratedService,
} from "./internal/framework";
import { isProductionEnv, resolveRuntimeEnv } from "./internal/runtime";
import { isSdkError } from "./internal/sdk-errors";

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

  // Default-path SDK calls (module acquisition, result validation, error
  // propagation) are delegated to @ait-kit/sdk's identity adapter; an
  // injected appLogin keeps the local direct call, matching the other
  // injection seams. This bridge keeps the TrailBase policy either way:
  // production fail-closed vs dev fallbacks and the login-integration
  // check (no @ait-kit/sdk equivalent).
  const identity = createReactNativeIdentity();

  return {
    async appLogin(): Promise<AppsInTossLoginResult> {
      try {
        return await (appLogin ? appLogin() : identity.login());
      } catch (error) {
        if (
          isSdkError(error) &&
          (error.code === "SDK_UNAVAILABLE" || error.code === "UNSUPPORTED")
        ) {
          if (resolvedProduction) {
            throw new AppsInTossLoginBridgeError({
              cause: error,
              code: "APP_LOGIN_UNAVAILABLE",
              message:
                "Apps in Toss appLogin is not available in this runtime.",
            });
          }
          return createDevFallback();
        }
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

function createDefaultLoginFallback() {
  return {
    authorizationCode: createAnonymousHash({ prefix: "dev-auth" }),
    referrer: "SANDBOX" as const,
  };
}
