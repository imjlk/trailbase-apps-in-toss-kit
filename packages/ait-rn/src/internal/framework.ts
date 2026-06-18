export type AppsInTossFrameworkCleanup = () => void;

export interface AppsInTossFullScreenAdOptions {
  adGroupId: string;
}

export interface AppsInTossFullScreenAdParams<TEvent = { type: string }> {
  onError: (error: unknown) => void;
  onEvent: (event: TEvent) => void;
  options: AppsInTossFullScreenAdOptions;
}

export type AppsInTossLoadFullScreenAdEvent = { type: "loaded" };

export type AppsInTossShowFullScreenAdEvent =
  | { type: "requested" }
  | { type: "show" }
  | { type: "impression" }
  | { type: "clicked" }
  | { type: "dismissed" }
  | { type: "failedToShow" }
  | {
      data?: {
        unitAmount?: unknown;
        unitType?: unknown;
      };
      type: "userEarnedReward";
    }
  | { data?: unknown; type: string };

export type AppsInTossLoadFullScreenAd = ((
  params: AppsInTossFullScreenAdParams<AppsInTossLoadFullScreenAdEvent>,
) => AppsInTossFrameworkCleanup | void) & {
  isSupported?: () => boolean;
};

export type AppsInTossShowFullScreenAd = ((
  params: AppsInTossFullScreenAdParams<AppsInTossShowFullScreenAdEvent>,
) => AppsInTossFrameworkCleanup | void) & {
  isSupported?: () => boolean;
};

export type AppsInTossGetOperationalEnvironment = () => unknown;
export type AppsInTossGetTossShareLink = (
  url: string,
  ogImageUrl?: string,
) => Promise<string>;
export type AppsInTossShare = (options: {
  message: string;
}) => Promise<void> | void;
export type AppsInTossGetSchemeUri = () => string | null | undefined;

export type AppsInTossFrameworkModule = {
  appLogin?: () => Promise<unknown>;
  getAnonymousKey?: () => Promise<unknown>;
  getIsTossLoginIntegratedService?: () => Promise<unknown>;
  getOperationalEnvironment?: AppsInTossGetOperationalEnvironment;
  getSchemeUri?: AppsInTossGetSchemeUri;
  getTossShareLink?: AppsInTossGetTossShareLink;
  loadFullScreenAd?: AppsInTossLoadFullScreenAd;
  share?: AppsInTossShare;
  showFullScreenAd?: AppsInTossShowFullScreenAd;
};

export async function defaultFrameworkFunction<
  K extends keyof AppsInTossFrameworkModule,
>(key: K): Promise<AppsInTossFrameworkModule[K] | undefined> {
  try {
    const framework = (await import(
      "@apps-in-toss/framework"
    )) as AppsInTossFrameworkModule;
    return framework[key];
  } catch {
    return undefined;
  }
}

