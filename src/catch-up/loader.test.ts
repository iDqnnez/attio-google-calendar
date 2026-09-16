import { describe, expect, it } from "vitest";
import {
  CATCH_UP_ENQUEUE_CHUNK_SIZE,
  CATCH_UP_PAGE_LIMIT,
  runCatchUpLoader,
} from "./loader";

const QUALIFYING_A = "11111111-1111-4111-8111-111111111111";
const QUALIFYING_B = "22222222-2222-4222-8222-222222222222";
const NO_DEADLINE = "33333333-3333-4333-8333-333333333333";
const BOUND_COMPLETED = "44444444-4444-4444-8444-444444444444";
const NEVER_BOUND_COMPLETED = "55555555-5555-4555-8555-555555555555";

function task(id: string, deadline: string | null) {
  return { id, deadline };
}

describe("runCatchUpLoader", () => {
  it("lists Open Qualifying Tasks and Bound Tasks, and enqueues those Task ids", async () => {
    const listedOpen: { limit: number; offset: number }[] = [];
    const listedBound: { limit: number; offset: number }[] = [];
    const chunks: string[][] = [];

    await runCatchUpLoader({
      async listOpenPage(query) {
        listedOpen.push(query);
        return [
          task(QUALIFYING_A, "2023-01-01"),
          task(NO_DEADLINE, null),
          task(QUALIFYING_B, "2023-06-15"),
        ];
      },
      async listBoundTaskIds(query) {
        listedBound.push(query);
        return [QUALIFYING_A, BOUND_COMPLETED];
      },
      async enqueueChunk(taskIds) {
        chunks.push(taskIds);
      },
    });

    expect(listedOpen).toEqual([{ limit: CATCH_UP_PAGE_LIMIT, offset: 0 }]);
    expect(listedBound).toEqual([{ limit: CATCH_UP_PAGE_LIMIT, offset: 0 }]);
    expect(chunks.flat()).toEqual(
      expect.arrayContaining([QUALIFYING_A, QUALIFYING_B, BOUND_COMPLETED]),
    );
    expect(chunks.flat()).not.toContain(NO_DEADLINE);
    expect(new Set(chunks.flat()).size).toBe(chunks.flat().length);
  });

  it("does not enqueue completed Tasks that never had a Binding", async () => {
    const chunks: string[][] = [];

    await runCatchUpLoader({
      async listOpenPage() {
        return [task(QUALIFYING_A, "2023-01-01")];
      },
      async listBoundTaskIds() {
        return [BOUND_COMPLETED];
      },
      async enqueueChunk(taskIds) {
        chunks.push(taskIds);
      },
    });

    expect(chunks.flat()).toEqual(
      expect.arrayContaining([QUALIFYING_A, BOUND_COMPLETED]),
    );
    expect(chunks.flat()).not.toContain(NEVER_BOUND_COMPLETED);
  });

  it("pages Open and Bound Tasks until a short page and enqueues unique ids in chunks", async () => {
    const listedOpen: { limit: number; offset: number }[] = [];
    const listedBound: { limit: number; offset: number }[] = [];
    const chunks: string[][] = [];
    const firstOpenPage = Array.from({ length: CATCH_UP_PAGE_LIMIT }, (_, i) =>
      task(
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        "2023-01-01",
      ),
    );
    const secondOpenPage = [
      task(QUALIFYING_A, "2023-01-02"),
      task(NO_DEADLINE, null),
    ];
    const firstBoundPage = Array.from(
      { length: CATCH_UP_PAGE_LIMIT },
      (_, i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const secondBoundPage = [QUALIFYING_A, BOUND_COMPLETED];

    await runCatchUpLoader({
      async listOpenPage(query) {
        listedOpen.push(query);
        return query.offset === 0 ? firstOpenPage : secondOpenPage;
      },
      async listBoundTaskIds(query) {
        listedBound.push(query);
        return query.offset === 0 ? firstBoundPage : secondBoundPage;
      },
      async enqueueChunk(taskIds) {
        chunks.push(taskIds);
      },
    });

    expect(listedOpen).toEqual([
      { limit: CATCH_UP_PAGE_LIMIT, offset: 0 },
      { limit: CATCH_UP_PAGE_LIMIT, offset: CATCH_UP_PAGE_LIMIT },
    ]);
    expect(listedBound).toEqual([
      { limit: CATCH_UP_PAGE_LIMIT, offset: 0 },
      { limit: CATCH_UP_PAGE_LIMIT, offset: CATCH_UP_PAGE_LIMIT },
    ]);
    expect(chunks[0]).toHaveLength(CATCH_UP_ENQUEUE_CHUNK_SIZE);
    expect(chunks.flat()).toHaveLength(
      CATCH_UP_PAGE_LIMIT + 1 + CATCH_UP_PAGE_LIMIT + 1,
    );
    expect(chunks.flat()).toContain(QUALIFYING_A);
    expect(chunks.flat()).toContain(BOUND_COMPLETED);
    expect(chunks.flat()).not.toContain(NO_DEADLINE);
    expect(new Set(chunks.flat()).size).toBe(chunks.flat().length);
  });
});
