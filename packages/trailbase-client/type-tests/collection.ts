import { createCollection, trailbaseRecordCollectionOptions } from "../src/tanstack-db";

const collection = createCollection(trailbaseRecordCollectionOptions({
  id: "sdk-contract", getKey: (row: { id: number }) => row.id,
  recordApi: {
    list: async () => ({ records: [{ id: 1 }] }),
    subscribe: async () => new ReadableStream(),
  },
}));
void collection;
