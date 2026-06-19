import type * as AppsInTossFramework from "@apps-in-toss/framework";

export type AppsInTossAppLogin = typeof AppsInTossFramework.appLogin;
export type AppsInTossGetAnonymousKey =
  typeof AppsInTossFramework.getAnonymousKey;
export type AppsInTossGetIsTossLoginIntegratedService =
  typeof AppsInTossFramework.getIsTossLoginIntegratedService;
export type AppsInTossGetOperationalEnvironment =
  typeof AppsInTossFramework.getOperationalEnvironment;
export type AppsInTossGetPlatformOS = typeof AppsInTossFramework.getPlatformOS;
export type AppsInTossGetSchemeUri = typeof AppsInTossFramework.getSchemeUri;
export type AppsInTossGetTossAppVersion =
  typeof AppsInTossFramework.getTossAppVersion;
export type AppsInTossGetTossShareLink =
  typeof AppsInTossFramework.getTossShareLink;
export type AppsInTossIsMinVersionSupported =
  typeof AppsInTossFramework.isMinVersionSupported;
export type AppsInTossShare = typeof AppsInTossFramework.share;

export type AppsInTossContactsViral = ((
  params: {
    options: { moduleId: string };
    onError: (error: unknown) => void | Promise<void>;
    onEvent: (event: unknown) => void | Promise<void>;
  },
) => void | (() => void)) & {
  isSupported?: () => boolean;
};

export type AppsInTossRequestNotificationAgreement = (params: {
  options: { templateCode: string };
  onEvent: (event: unknown) => void;
  onError: (error: unknown) => void | Promise<void>;
}) => void | (() => void);

export type AppsInTossFrameworkCleanup = ReturnType<
  typeof AppsInTossFramework.loadFullScreenAd
>;
export type AppsInTossFullScreenAdOptions =
  AppsInTossFramework.LoadFullScreenAdOptions;
export type AppsInTossFullScreenAdParams =
  | AppsInTossFramework.LoadFullScreenAdParams
  | AppsInTossFramework.ShowFullScreenAdParams;
export type AppsInTossLoadFullScreenAd =
  typeof AppsInTossFramework.loadFullScreenAd;
export type AppsInTossLoadFullScreenAdEvent =
  AppsInTossFramework.LoadFullScreenAdEvent;
export type AppsInTossLoadFullScreenAdParams =
  AppsInTossFramework.LoadFullScreenAdParams;
export type AppsInTossShowFullScreenAd =
  typeof AppsInTossFramework.showFullScreenAd;
export type AppsInTossShowFullScreenAdEvent =
  AppsInTossFramework.ShowFullScreenAdEvent;
export type AppsInTossShowFullScreenAdParams =
  AppsInTossFramework.ShowFullScreenAdParams;

export type AppsInTossFrameworkModule = Partial<
  Pick<
    typeof AppsInTossFramework,
    | "appLogin"
    | "getAnonymousKey"
    | "getIsTossLoginIntegratedService"
    | "getOperationalEnvironment"
    | "getPlatformOS"
    | "getSchemeUri"
    | "getTossAppVersion"
    | "getTossShareLink"
    | "isMinVersionSupported"
    | "loadFullScreenAd"
    | "share"
    | "showFullScreenAd"
  >
> & {
  contactsViral?: AppsInTossContactsViral;
  requestNotificationAgreement?: AppsInTossRequestNotificationAgreement;
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
