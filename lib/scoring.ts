import type { Candidate } from "./types";

export type FailureType = "strong" | "candidate_overload" | "low_confidence" | "noisy_results" | "zero_result";

export function detectFailure(candidates: Candidate[]) {
  if (!candidates.length) return { type: "zero_result" as FailureType, reason: "No candidate photos were surfaced." };
  const top = candidates[0]?.finalScore ?? 0;
  const second = candidates[1]?.finalScore ?? 0;
  const nearTop = candidates.filter((c) => c.finalScore >= Math.max(0.01, top - 0.06)).length;
  if (top >= 0.78 && top - second >= 0.12) return { type: "strong" as FailureType, reason: "One candidate is clearly stronger than the rest." };
  if (nearTop >= 20) return { type: "candidate_overload" as FailureType, reason: "Many candidates are similarly plausible." };
  if (top < 0.24) return { type: "low_confidence" as FailureType, reason: "No candidate has a strong enough match." };
  return { type: "noisy_results" as FailureType, reason: "Several candidates partially match, but no clear winner emerged." };
}
