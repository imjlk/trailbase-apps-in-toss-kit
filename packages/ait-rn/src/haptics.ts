export interface AppsInTossHapticFeedbackOptions {
  type: string;
}

export interface AppsInTossHapticNativeModule {
  generateHapticFeedback?: (
    options: AppsInTossHapticFeedbackOptions,
  ) => void | Promise<void>;
  [key: string]: unknown;
}

export interface AppsInTossNativeModulesWithHaptics {
  BedrockModule?: AppsInTossHapticNativeModule | null;
  GraniteModule?: AppsInTossHapticNativeModule | null;
}

export interface EnsureAppsInTossHapticFallbackOptions {
  nativeModules?: AppsInTossNativeModulesWithHaptics | null;
}

export function ensureAppsInTossHapticFallback({
  nativeModules,
}: EnsureAppsInTossHapticFallbackOptions = {}): boolean {
  try {
    if (!nativeModules) {
      return false;
    }

    const graniteModule = nativeModules.GraniteModule;
    const bedrockModule = nativeModules.BedrockModule;
    const fallbackGenerateHapticFeedback = async () => undefined;

    if (typeof graniteModule?.generateHapticFeedback !== "function") {
      Object.defineProperty(nativeModules, "GraniteModule", {
        configurable: true,
        enumerable: true,
        value: {
          ...(graniteModule ?? {}),
          generateHapticFeedback: fallbackGenerateHapticFeedback,
        },
        writable: true,
      });
    }
    if (typeof bedrockModule?.generateHapticFeedback !== "function") {
      Object.defineProperty(nativeModules, "BedrockModule", {
        configurable: true,
        enumerable: true,
        value: {
          ...(bedrockModule ?? {}),
          generateHapticFeedback: fallbackGenerateHapticFeedback,
        },
        writable: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}
