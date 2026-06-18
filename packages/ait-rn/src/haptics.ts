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
    if (
      typeof graniteModule?.generateHapticFeedback === "function" ||
      typeof bedrockModule?.generateHapticFeedback === "function"
    ) {
      return true;
    }

    const hapticModule = graniteModule ?? bedrockModule ?? {};
    const fallbackGenerateHapticFeedback = async () => undefined;
    Object.defineProperty(nativeModules, "GraniteModule", {
      configurable: true,
      enumerable: true,
      value: {
        ...hapticModule,
        generateHapticFeedback: fallbackGenerateHapticFeedback,
      },
      writable: true,
    });
    if (bedrockModule) {
      Object.defineProperty(nativeModules, "BedrockModule", {
        configurable: true,
        enumerable: true,
        value: {
          ...bedrockModule,
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

