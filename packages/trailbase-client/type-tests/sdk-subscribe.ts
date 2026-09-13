import { createTrailbaseRecordApiWithXhrSse } from "../src/tanstack-db";

// Models the official SDK's options without an adapter-specific AbortSignal.
declare const sdk: {
  list: () => Promise<{ records: { id: number }[] }>;
  subscribe: (id: string | number, opts?: { onLoss?: () => void }) => Promise<ReadableStream<unknown>>;
};
const adapted = createTrailbaseRecordApiWithXhrSse({
  apiBaseUrl: "https://example.invalid", apiName: "records", fallbackRecordApi: sdk,
});
void adapted.subscribe("*", { signal: new AbortController().signal });
