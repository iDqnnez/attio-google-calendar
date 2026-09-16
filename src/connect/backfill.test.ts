import { describe, expect, it } from "vitest";
import {
  BACKFILL_ENQUEUE_CHUNK_SIZE,
  OPEN_TASK_PAGE_LIMIT,
  runBackfillLoader,
} from "./backfill";

const QUALIFYING_A = "11111111-1111-4111-8111-111111111111";
const QUALIFYING_B = "22222222-2222-4222-8222-222222222222";
const NO_DEADLINE = "33333333-3333-4333-8333-333333333333";
const QUALIFYING_C = "44444444-4444-4444-8444-444444444444";

function task(id: string, deadline: string | null) {
  return { id, deadline };
}

describe("runBackfillLoader", () => {
  it("lists Open Tasks, client-filters Qualifying, and enqueues those Task ids", async () => {
    const listed: { limit: number; offset: number }[] = [];
    const chunks: string[][] = [];

    await runBackfillLoader({
      async listOpenPage(query) {
        listed.push(query);
        return [
          task(QUALIFYING_A, "2023-01-01"),
          task(NO_DEADLINE, null),
          task(QUALIFYING_C, "2023-06-15"),
        ];
      },
      async enqueueChunk(taskIds) {
        chunks.push(taskIds);
      },
    });

    expect(listed).toEqual([{ limit: OPEN_TASK_PAGE_LIMIT, offset: 0 }]);
    expect(chunks).toEqual([[QUALIFYING_A, QUALIFYING_C]]);
  });

  it("does not enqueue Open Tasks that are not Qualifying", async () => {
    const chunks: string[][] = [];

    await runBackfillLoader({
      async listOpenPage() {
        return [task(NO_DEADLINE, null)];
      },
      async enqueueChunk(taskIds) {
        chunks.push(taskIds);
      },
    });

    expect(chunks).toEqual([]);
  });

  it("pages Open Tasks until a short page and enqueues Qualifying ids in chunks", async () => {
    const listed: { limit: number; offset: number }[] = [];
    const chunks: string[][] = [];
    const firstPage = Array.from({ length: OPEN_TASK_PAGE_LIMIT }, (_, i) =>
      task(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "2023-01-01"),
    );
    const secondPage = [
      task(QUALIFYING_A, "2023-01-02"),
      task(NO_DEADLINE, null),
      task(QUALIFYING_B, "2023-01-03"),
    ];

    await runBackfillLoader({
      async listOpenPage(query) {
        listed.push(query);
        return query.offset === 0 ? firstPage : secondPage;
      },
      async enqueueChunk(taskIds) {
        chunks.push(taskIds);
      },
    });

    expect(listed).toEqual([
      { limit: OPEN_TASK_PAGE_LIMIT, offset: 0 },
      { limit: OPEN_TASK_PAGE_LIMIT, offset: OPEN_TASK_PAGE_LIMIT },
    ]);
    expect(chunks[0]).toHaveLength(BACKFILL_ENQUEUE_CHUNK_SIZE);
    expect(chunks.at(-1)).toEqual([QUALIFYING_A, QUALIFYING_B]);
    expect(chunks.flat()).toHaveLength(OPEN_TASK_PAGE_LIMIT + 2);
    expect(chunks.flat()).not.toContain(NO_DEADLINE);
  });
});
