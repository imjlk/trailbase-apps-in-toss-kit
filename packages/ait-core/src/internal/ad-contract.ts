/** Structural full-screen ad contract, checked against both official SDKs. */
export type AppsInTossFullScreenAdOptions = { adGroupId: string };
export type AppsInTossLoadFullScreenAdEvent = { type: "loaded" };
export type AppsInTossShowFullScreenAdEvent =
  | { type: "requested" | "show" | "impression" | "clicked" | "dismissed" | "failedToShow" }
  | { type: "userEarnedReward"; data: { unitType: string; unitAmount: number } };
export interface AppsInTossLoadFullScreenAdParams {
  options: AppsInTossFullScreenAdOptions;
  onEvent: (event: AppsInTossLoadFullScreenAdEvent) => void;
  onError: (error: unknown) => void;
}
export interface AppsInTossShowFullScreenAdParams {
  options: AppsInTossFullScreenAdOptions;
  onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
  onError: (error: unknown) => void;
}
export type AppsInTossFullScreenAdParams = AppsInTossLoadFullScreenAdParams | AppsInTossShowFullScreenAdParams;
export type AppsInTossLoadFullScreenAd = ((params: AppsInTossLoadFullScreenAdParams) => () => void) & { isSupported?: () => boolean };
export type AppsInTossShowFullScreenAd = ((params: AppsInTossShowFullScreenAdParams) => () => void) & { isSupported?: () => boolean };
