import * as sdk from "@apps-in-toss/web-framework";
import { createAppsInTossWebAdapter, type AppsInTossWebSdk } from "../src/index";
import { createConsumer } from "../test/fixtures/minified-consumer";
import type { AppsInTossLoginResult, KeyValueStorage } from "@trailbase-apps-in-toss-kit/trailbase-client";
const current: AppsInTossWebSdk = sdk;
const adapter = createAppsInTossWebAdapter({ appKey: "typed", loadSdk: async () => current });
const storage: KeyValueStorage = adapter.storage;
const login: Promise<AppsInTossLoginResult> = adapter.login();
const pending: Promise<Awaited<ReturnType<typeof sdk.IAP.getPendingOrders>>> = adapter.getPendingOrders();
void [storage, login, pending];
// Keep the browser fixture's injected namespace checked against the real SDK.
void createConsumer().adapter;
// @ts-expect-error A purchase requires a backend grant callback.
void adapter.purchase({ sku: "coins" });
// @ts-expect-error SDK3 uses sku rather than the deprecated productId selector.
void adapter.purchase({ productId: "coins", processProductGrant: async () => true });

import { createAppsInTossFullScreenAdBridge, createAppsInTossSdkStorageBridge, createAppsInTossAnalyticsConfig, createWebViewBannerAds } from "../src/index";
void createAppsInTossFullScreenAdBridge({ loadFullScreenAd: sdk.loadFullScreenAd, showFullScreenAd: sdk.showFullScreenAd, loadSdk: async () => sdk });
void createAppsInTossSdkStorageBridge({ framework: sdk });
void createAppsInTossAnalyticsConfig({ analyticsModule: sdk.Analytics });
void createWebViewBannerAds({ framework: sdk });

// Shared RN/WebView helpers accept the real SDK 3 functions.
import { createAppsInTossShareBridge, createAppsInTossShoppingBridge } from "../src/index";
void createAppsInTossShareBridge({ loadSdk: async () => sdk });
void createAppsInTossShareBridge({ getTossShareLink: sdk.getTossShareLink, share: sdk.share, getSchemeUri: sdk.getSchemeUri });
void createAppsInTossShoppingBridge({ openURL: sdk.openURL });
