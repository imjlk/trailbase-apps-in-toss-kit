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
