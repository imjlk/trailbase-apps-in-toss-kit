import { describe, expect, test } from "bun:test";
import {
  createAppsInTossBackNavigation,
  dismissTopDialog,
  normalizeBackPath,
  resolveBackStep,
  type AppsInTossBackSdk,
  type BackStep,
} from "../src/back-navigation";

const policy = { rootPaths: ["/", "/play"], siblingPaths: ["/topics", "/ranking"] };
const at = (path: string, canGoBack = true, overlayDismissed = false) =>
  resolveBackStep(policy, { path, canGoBack, overlayDismissed });

describe("back navigation policy", () => {
  test("the first screen closes the app whatever was visited before", () => {
    expect(at("/")).toBe("exit");
    expect(at("/play")).toBe("exit");
    expect(at("/", false)).toBe("exit");
  });
  test("a sibling tab leads to the first screen instead of replaying tab visits", () => {
    expect(at("/topics")).toBe("root");
    expect(at("/ranking/", false)).toBe("root");
  });
  test("an inner screen goes one screen back, or closes the app when it was the entry", () => {
    expect(at("/topics/animals")).toBe("back");
    expect(at("/topics/animals", false)).toBe("exit");
  });
  test("something that closed on top of the screen takes the press on every screen", () => {
    for (const path of ["/", "/topics", "/topics/animals"]) expect(at(path, true, true)).toBe("overlay");
  });
  test("paths match without query, hash or trailing slash", () => {
    expect(normalizeBackPath("/topics/?x=1#y")).toBe("/topics");
    expect(normalizeBackPath("")).toBe("/");
    expect(at("/topics?from=share")).toBe("root");
  });
  test("defaults: only `/` is the first screen and there are no sibling tabs", () => {
    expect(resolveBackStep({}, { path: "/", canGoBack: true, overlayDismissed: false })).toBe("exit");
    expect(resolveBackStep({}, { path: "/topics", canGoBack: true, overlayDismissed: false })).toBe("back");
  });
});

function fakeSdk() {
  const state = { listeners: [] as (() => void)[], closed: 0, subscriptions: 0, swipe: [] as boolean[] };
  const sdk = {
    graniteEvent: {
      addEventListener: (_event: string, handler: { onEvent: () => void }) => {
        state.subscriptions += 1;
        state.listeners.push(handler.onEvent);
        return () => {
          state.listeners = state.listeners.filter((item) => item !== handler.onEvent);
        };
      },
    },
    closeView: async () => {
      state.closed += 1;
    },
    Screen: {
      setIosSwipeBack: async ({ isEnabled }: { isEnabled: boolean }) => {
        state.swipe.push(isEnabled);
      },
    },
  } as unknown as AppsInTossBackSdk;
  return { sdk, state };
}

function app(initial: string, overrides: { dismissOverlay?: () => boolean } = {}) {
  const { sdk, state } = fakeSdk();
  const history = [initial];
  const steps: BackStep[] = [];
  let loads = 0;
  const navigation = createAppsInTossBackNavigation({
    ...policy,
    currentPath: () => history.at(-1)!,
    canGoBack: () => history.length > 1,
    goBack: () => void history.pop(),
    goToRoot: () => void history.splice(-1, 1, "/"),
    dismissOverlay: overrides.dismissOverlay ?? (() => false),
    onStep: (step) => steps.push(step),
    loadSdk: async () => {
      loads += 1;
      return sdk;
    },
  });
  return { navigation, history, steps, state, loads: () => loads, back: () => state.listeners.forEach((listener) => listener()) };
}

describe("createAppsInTossBackNavigation", () => {
  test("walks tabs and inner screens back to the first screen, then closes the app", async () => {
    const run = app("/");
    await run.navigation.start();
    run.history.push("/topics", "/ranking", "/topics", "/topics/animals");
    run.back();
    expect(run.history.at(-1)).toBe("/topics");
    run.back();
    expect(run.history.at(-1)).toBe("/");
    expect(run.state.closed).toBe(0);
    run.back();
    expect(run.state.closed).toBe(1);
    expect(run.steps).toEqual(["back", "root", "exit"]);
  });
  test("closes the app when it was opened directly on an inner screen", async () => {
    const run = app("/topics/animals");
    await run.navigation.start();
    run.back();
    expect(run.state.closed).toBe(1);
  });
  test("an open overlay takes the press and nothing else moves", async () => {
    let open = true;
    const run = app("/", { dismissOverlay: () => (open ? ((open = false), true) : false) });
    await run.navigation.start();
    run.back();
    expect(run.state.closed).toBe(0);
    expect(run.steps).toEqual(["overlay"]);
    run.back();
    expect(run.state.closed).toBe(1);
  });
  test("subscribes once however often start is called, and can stop", async () => {
    const run = app("/");
    const [first, second] = await Promise.all([run.navigation.start(), run.navigation.start()]);
    expect(first).toBe(second);
    expect(run.state.subscriptions).toBe(1);
    first();
    run.back();
    expect(run.state.closed).toBe(0);
    await run.navigation.start();
    expect(run.state.subscriptions).toBe(2);
  });
  test("a router error still ends the press by closing the app", async () => {
    const { sdk, state } = fakeSdk();
    const navigation = createAppsInTossBackNavigation({
      currentPath: () => "/inner",
      canGoBack: () => true,
      goBack: () => {
        throw new Error("router failed");
      },
      goToRoot: () => {},
      dismissOverlay: () => false,
      loadSdk: async () => sdk,
    });
    await navigation.start();
    state.listeners.forEach((listener) => listener());
    expect(state.closed).toBe(1);
  });
  test("a stale cleanup never removes a subscription started after it", async () => {
    const run = app("/");
    const first = await run.navigation.start();
    const sameAsFirst = await run.navigation.start();
    first();
    const second = await run.navigation.start();
    // The other holder of the first cleanup calls it late, and again.
    sameAsFirst();
    first();
    await run.navigation.start();
    expect(run.state.subscriptions).toBe(2);
    expect(run.state.listeners).toHaveLength(1);
    run.back();
    expect(run.state.closed).toBe(1);
    second();
    expect(run.state.listeners).toHaveLength(0);
  });
  test("a navigation that rejects later closes the app", async () => {
    for (const path of ["/topics", "/topics/animals"]) {
      const { sdk, state } = fakeSdk();
      const navigation = createAppsInTossBackNavigation({
        ...policy,
        currentPath: () => path,
        canGoBack: () => true,
        goBack: () => Promise.reject(new Error("navigation failed")),
        goToRoot: () => Promise.reject(new Error("navigation failed")),
        dismissOverlay: () => false,
        loadSdk: async () => sdk,
      });
      await navigation.start();
      state.listeners.forEach((listener) => listener());
      expect(state.closed).toBe(0);
      await Promise.resolve();
      await Promise.resolve();
      expect(state.closed).toBe(1);
    }
  });
  test("a navigation that resolves does not close the app", async () => {
    const { sdk, state } = fakeSdk();
    const navigation = createAppsInTossBackNavigation({
      ...policy,
      currentPath: () => "/topics",
      canGoBack: () => true,
      goBack: () => {},
      goToRoot: () => Promise.resolve(),
      dismissOverlay: () => false,
      loadSdk: async () => sdk,
    });
    await navigation.start();
    state.listeners.forEach((listener) => listener());
    await Promise.resolve();
    await Promise.resolve();
    expect(state.closed).toBe(0);
  });
  test("a failed SDK load rejects and can be retried", async () => {
    let fail = true;
    const { sdk, state } = fakeSdk();
    const navigation = createAppsInTossBackNavigation({
      currentPath: () => "/",
      canGoBack: () => false,
      goBack: () => {},
      goToRoot: () => {},
      loadSdk: async () => {
        if (fail) throw new Error("no sdk");
        return sdk;
      },
    });
    await expect(navigation.start()).rejects.toThrow("no sdk");
    fail = false;
    await navigation.start();
    expect(state.subscriptions).toBe(1);
  });
  test("the iOS edge swipe is on only where Back closes the app", async () => {
    const run = app("/");
    await run.navigation.syncSwipeBack();
    await run.navigation.syncSwipeBack("/topics");
    await run.navigation.syncSwipeBack("/topics/animals");
    await run.navigation.syncSwipeBack("/play");
    expect(run.state.swipe).toEqual([true, false, false, true]);
  });
  test("an older swipe update never lands after a newer one", async () => {
    const { sdk, state } = fakeSdk();
    const loads: (() => void)[] = [];
    const navigation = createAppsInTossBackNavigation({
      ...policy,
      currentPath: () => "/",
      canGoBack: () => false,
      goBack: () => {},
      goToRoot: () => {},
      loadSdk: () => new Promise((resolve) => loads.push(() => resolve(sdk))),
    });
    const older = navigation.syncSwipeBack("/");
    const newer = navigation.syncSwipeBack("/topics/animals");
    // The newer call's SDK load settles first, the older one afterwards.
    loads[1]!();
    await newer;
    loads[0]!();
    await older;
    expect(state.swipe).toEqual([false]);
  });
  test("an SDK without the swipe setting is fine", async () => {
    const { sdk } = fakeSdk();
    const navigation = createAppsInTossBackNavigation({
      currentPath: () => "/",
      canGoBack: () => false,
      goBack: () => {},
      goToRoot: () => {},
      loadSdk: async () => ({ graniteEvent: sdk.graniteEvent, closeView: sdk.closeView }),
    });
    await navigation.syncSwipeBack();
  });
});

describe("dismissTopDialog", () => {
  function fakeDialog(options: { preventCancel?: boolean; holds?: unknown } = {}) {
    const dialog = {
      open: true,
      canceled: 0,
      closed: 0,
      contains: (node: unknown) => node === options.holds,
      dispatchEvent(event: Event) {
        dialog.canceled += 1;
        if (options.preventCancel) event.preventDefault();
        return !event.defaultPrevented;
      },
      close() {
        dialog.open = false;
        dialog.closed += 1;
      },
    };
    return dialog;
  }
  const root = (dialogs: unknown[], activeElement: unknown = null) =>
    ({ querySelectorAll: () => dialogs, activeElement }) as unknown as ParentNode;

  test("returns false when nothing is open", () => {
    expect(dismissTopDialog(root([]))).toBe(false);
  });
  test("cancels the top dialog and closes it when its owner did not", () => {
    const below = fakeDialog();
    const top = fakeDialog();
    expect(dismissTopDialog(root([below, top]))).toBe(true);
    expect([below.canceled, below.closed]).toEqual([0, 0]);
    expect([top.canceled, top.closed]).toEqual([1, 1]);
  });
  test("prefers the dialog that holds focus over document order", () => {
    const focus = {};
    // Opened later, so it is on top, although it comes first in the document.
    const top = fakeDialog({ holds: focus });
    const below = fakeDialog();
    expect(dismissTopDialog(root([top, below], focus))).toBe(true);
    expect(top.closed).toBe(1);
    expect(below.closed).toBe(0);
  });
  test("leaves a dialog that refuses to close to its owner", () => {
    const dialog = fakeDialog({ preventCancel: true });
    expect(dismissTopDialog(root([dialog]))).toBe(true);
    expect(dialog.closed).toBe(0);
  });
});
