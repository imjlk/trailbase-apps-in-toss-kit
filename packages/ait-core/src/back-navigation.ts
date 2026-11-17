/**
 * What one press of Back should do in an app that routes its own screens.
 *
 * The policy is pure: the caller says where the app is and gets the step to
 * take. It does not replace the router's history. It only covers the cases
 * history cannot express: something open on top of the screen, a first screen
 * that must close the app, and tabs that sit beside the first screen.
 */
export type BackStep =
  /** Something on top of the screen (sheet, dialog) took the press and closed. */
  | "overlay"
  /** Close the app. */
  | "exit"
  /** Show the first screen. */
  | "root"
  /** Return to the previous screen in the router's history. */
  | "back";

export interface BackNavigationPolicy {
  /** Paths of the first screen, where Back closes the app. Default: `["/"]`. */
  rootPaths?: readonly string[];
  /**
   * Screens beside the first screen, such as the other tabs of a tab bar. Back
   * leads from them to the first screen instead of replaying every tab visited,
   * so Back on the first screen always closes the app.
   */
  siblingPaths?: readonly string[];
}

export interface BackNavigationState {
  /** Current path, with or without a trailing slash. */
  path: string;
  /** The router has an earlier screen of this app to return to. */
  canGoBack: boolean;
  /** Something on top of the screen closed itself in response to this press. */
  overlayDismissed: boolean;
}

/** Drops the query, hash and trailing slashes so `/tabs/` and `/tabs?x=1` match `/tabs`. */
export function normalizeBackPath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  return pathname.replace(/\/+$/, "") || "/";
}

export function resolveBackStep(policy: BackNavigationPolicy, state: BackNavigationState): BackStep {
  if (state.overlayDismissed) return "overlay";
  const path = normalizeBackPath(state.path);
  const matches = (paths: readonly string[]) => paths.some((candidate) => normalizeBackPath(candidate) === path);
  if (matches(policy.rootPaths ?? ["/"])) return "exit";
  if (matches(policy.siblingPaths ?? [])) return "root";
  // Opened directly on an inner screen (a deep link): that screen is the first one.
  return state.canGoBack ? "back" : "exit";
}
