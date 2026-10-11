import { performance } from "node:perf_hooks";

export type PerformanceFields = Record<string, string | number | boolean | null>;

export function startTimer(): number {
  return performance.now();
}

/** Emit low-cardinality timings only; callers must never include query or document text. */
export function logStageTiming(
  stage: string,
  startedAt: number,
  fields: PerformanceFields = {}
): void {
  console.info(JSON.stringify({
    event: "astrolynx.performance",
    stage,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    ...fields,
  }));
}
