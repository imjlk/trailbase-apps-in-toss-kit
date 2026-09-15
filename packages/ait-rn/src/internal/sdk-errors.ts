import { SdkError } from "@ait-kit/sdk";

/**
 * Narrow helper for mapping @ait-kit/sdk adapter failures onto this
 * package's bridge error codes. Non-SDK rejections (the provider's own
 * errors propagate unchanged through the adapters) are not SdkErrors.
 */
export function isSdkError(value: unknown): value is SdkError {
  return value instanceof SdkError;
}
