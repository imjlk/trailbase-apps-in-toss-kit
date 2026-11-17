import {
  resolveBackStep,
  type BackNavigationPolicy,
  type BackStep,
} from "@trailbase-apps-in-toss-kit/ait-core/back-navigation";
export * from "@trailbase-apps-in-toss-kit/ait-core/back-navigation";

type Sdk = typeof import("@apps-in-toss/web-framework");
/** `Screen` is optional so older SDK 3 minors, which lack the swipe setting, still work. */
export type AppsInTossBackSdk = Pick<Sdk, "graniteEvent" | "closeView"> & Partial<Pick<Sdk, "Screen">>;

export interface CreateAppsInTossBackNavigationOptions extends BackNavigationPolicy {
  /** Current router path. */
  currentPath: () => string;
  /** Whether the router has an earlier screen of this app. */
  canGoBack: () => boolean;
  /** Return to the previous screen. */
  goBack: () => void;
  /** Show the first screen, replacing the current history entry. */
  goToRoot: () => void;
  /**
   * Close whatever is open on top of the screen and return true, or return
   * false when nothing was. Default: closes the top open `<dialog>`.
   */
  dismissOverlay?: () => boolean;
  /** Observes the step taken for each press, for logging and tests. */
  onStep?: (step: BackStep) => void;
  /** Resolve from the consumer's SDK dependency; never acquires the RN SDK. */
  loadSdk?: () => Promise<AppsInTossBackSdk>;
}

export interface AppsInTossBackNavigation {
  /**
   * Subscribes to the SDK's `backEvent` once for the life of the app and
   * resolves to an unsubscribe function. Calling it again reuses the same
   * subscription. Rejects when the SDK cannot be loaded.
   */
  start(): Promise<() => void>;
  /**
   * Handles one press and returns the step taken. `exit` is called when the
   * app should close; `start` passes the SDK's `closeView`.
   */
  press(exit: () => void): BackStep;
  /**
   * Enables the iOS edge swipe, which closes the app, on first-screen paths
   * only. Call it when the path changes. Resolves without effect when the SDK
   * does not offer the setting.
   */
  syncSwipeBack(path?: string): Promise<void>;
}

/**
 * Closes the dialog on top the way Escape would: the dialog's own `cancel`
 * handler runs first, so the component that owns it stays in charge of its
 * state. Returns false when no dialog was open.
 */
export function dismissTopDialog(root: ParentNode | undefined = globalThis.document): boolean {
  if (!root) return false;
  const open = root.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const dialog = open[open.length - 1];
  if (!dialog) return false;
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  if (!cancel.defaultPrevented && dialog.open) dialog.close();
  return true;
}

/**
 * Makes every Back press end in something the person can see. Once an app
 * listens to `backEvent`, Toss stops handling the navigation-bar back button
 * and the Android system back button itself, so a handler that returns
 * without acting leaves the button dead.
 */
export function createAppsInTossBackNavigation({
  currentPath,
  canGoBack,
  goBack,
  goToRoot,
  dismissOverlay = dismissTopDialog,
  onStep,
  loadSdk = () => import("@apps-in-toss/web-framework"),
  ...policy
}: CreateAppsInTossBackNavigationOptions): AppsInTossBackNavigation {
  let subscription: Promise<() => void> | undefined;

  const press = (exit: () => void): BackStep => {
    let step: BackStep;
    try {
      step = resolveBackStep(policy, {
        // Ask first: the answer is whether something actually closed.
        overlayDismissed: dismissOverlay(),
        path: currentPath(),
        canGoBack: canGoBack(),
      });
      if (step === "back") goBack();
      else if (step === "root") goToRoot();
    } catch {
      // A router or overlay error must not leave the press without an outcome.
      step = "exit";
    }
    if (step === "exit") exit();
    onStep?.(step);
    return step;
  };

  return {
    press,
    start() {
      subscription ??= loadSdk().then(
        (sdk) => {
          const unsubscribe = sdk.graniteEvent.addEventListener("backEvent", {
            onEvent: () => {
              press(() => void sdk.closeView());
            },
          });
          return () => {
            subscription = undefined;
            unsubscribe();
          };
        },
        (error) => {
          subscription = undefined;
          throw error;
        },
      );
      return subscription;
    },
    async syncSwipeBack(path = currentPath()) {
      let screen: AppsInTossBackSdk["Screen"];
      try {
        screen = (await loadSdk()).Screen;
      } catch {
        return;
      }
      const isEnabled = resolveBackStep(policy, { path, canGoBack: true, overlayDismissed: false }) === "exit";
      try {
        await screen?.setIosSwipeBack?.({ isEnabled });
      } catch {
        // Optional: the edge swipe keeps whatever setting it had.
      }
    },
  };
}
