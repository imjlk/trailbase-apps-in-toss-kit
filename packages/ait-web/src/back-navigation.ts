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
  /**
   * Return to the previous screen. Return the router's promise when it has
   * one: a rejection then closes the app instead of leaving the press without
   * an outcome.
   */
  goBack: () => void | PromiseLike<unknown>;
  /** Show the first screen, replacing the current history entry. Same promise rule as `goBack`. */
  goToRoot: () => void | PromiseLike<unknown>;
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
 *
 * The browser does not expose the order of the top layer. The dialog that
 * holds focus is taken as the one on top (a modal dialog moves focus into
 * itself when it opens); without one, the last open dialog in document order.
 * Pass your own `dismissOverlay` when dialogs can stack in another order.
 */
export function dismissTopDialog(root: ParentNode | undefined = globalThis.document): boolean {
  if (!root) return false;
  const open = Array.from(root.querySelectorAll<HTMLDialogElement>("dialog[open]"));
  const focused = (root as Partial<Document>).activeElement ?? globalThis.document?.activeElement ?? null;
  // Innermost match: a dialog nested in another both contain the focused node.
  const holdingFocus = focused ? open.filter((candidate) => candidate.contains(focused)) : [];
  const dialog = holdingFocus[holdingFocus.length - 1] ?? open[open.length - 1];
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
  let swipeSync = 0;

  const press = (exit: () => void): BackStep => {
    let step: BackStep;
    try {
      step = resolveBackStep(policy, {
        // Ask first: the answer is whether something actually closed.
        overlayDismissed: dismissOverlay(),
        path: currentPath(),
        canGoBack: canGoBack(),
      });
      const moved = step === "back" ? goBack() : step === "root" ? goToRoot() : undefined;
      // A navigation that fails later still has to end somewhere.
      if (moved && typeof moved.then === "function") moved.then(undefined, () => exit());
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
      if (subscription) return subscription;
      const current: Promise<() => void> = loadSdk().then(
        (sdk) => {
          const unsubscribe = sdk.graniteEvent.addEventListener("backEvent", {
            onEvent: () => {
              press(() => void sdk.closeView());
            },
          });
          let stopped = false;
          // Every caller of this subscription gets the same function. It acts
          // once, and never clears a subscription started after it.
          return () => {
            if (stopped) return;
            stopped = true;
            if (subscription === current) subscription = undefined;
            unsubscribe();
          };
        },
        (error) => {
          if (subscription === current) subscription = undefined;
          throw error;
        },
      );
      subscription = current;
      return current;
    },
    async syncSwipeBack(path = currentPath()) {
      const sync = ++swipeSync;
      let screen: AppsInTossBackSdk["Screen"];
      try {
        screen = (await loadSdk()).Screen;
      } catch {
        return;
      }
      // A later call already decided the setting; an older answer must not land after it.
      if (sync !== swipeSync) return;
      const isEnabled = resolveBackStep(policy, { path, canGoBack: true, overlayDismissed: false }) === "exit";
      try {
        await screen?.setIosSwipeBack?.({ isEnabled });
      } catch {
        // Optional: the edge swipe keeps whatever setting it had.
      }
    },
  };
}
