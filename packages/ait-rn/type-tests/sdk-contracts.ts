import type * as Framework from "@apps-in-toss/framework";
import type { AppsInTossFrameworkModule } from "../src/internal/framework";
import type { AppsInTossIapSdk } from "../src/iap";

// Keep injected adapter contracts compatible with the actual pinned SDK.
declare const framework: typeof Framework;
const compatibleFramework: AppsInTossFrameworkModule = framework;
const compatibleIap: AppsInTossIapSdk = framework.IAP;
void compatibleFramework;
void compatibleIap;
