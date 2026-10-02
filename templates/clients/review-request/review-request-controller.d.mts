export interface ReviewScreenState {
  foreground: boolean;
  blockingOverlay: boolean;
  contextKey?: unknown;
}
export interface ReviewRequestEvent {
  type: string;
  reason?: string;
  errorCode?: string;
  phase?: string;
}
export function createReviewRequestController(options: {
  review: { isSupported(): boolean | Promise<boolean>; request(): Promise<void> };
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  isEligible?: () => boolean | Promise<boolean>;
  getScreenState?: () => ReviewScreenState | Promise<ReviewScreenState>;
  now?: () => number;
  cooldownMs?: number;
  enabled?: boolean;
  storageKey?: string;
  report?: (event: ReviewRequestEvent) => unknown;
}): { maybeRequest(): Promise<{ status: string; reason?: string }> };
