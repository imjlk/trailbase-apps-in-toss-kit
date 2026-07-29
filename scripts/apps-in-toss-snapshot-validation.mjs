const NOT_FOUND_PATTERNS = [
  /^# Page Not Found\s*$/m,
  /\bThe URL `[^`]+` does not exist\./
];

export function assertValidDocumentSnapshot(source, body) {
  if (typeof body !== "string" || body.trim().length === 0) {
    throw new Error(`${source.url} returned an empty document`);
  }

  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(body))) {
    throw new Error(`${source.url} returned a Page Not Found document`);
  }

  if (source.expectedText && !body.includes(source.expectedText)) {
    throw new Error(
      `${source.url} did not contain the expected document marker: ${source.expectedText}`
    );
  }
}
