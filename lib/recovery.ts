import type { Candidate, MemoryClue } from "./types";

const DIMENSION_LABELS: Record<string,string> = {
  people: "who was there", objects: "what was in the photo", scenes: "what the scene looked like",
  activities: "what you were doing", appearance: "what someone was wearing", location: "where it was taken",
  time: "roughly when it was taken", ocrText: "words or text in the photo", event: "what was happening",
};

function valuesFor(c: Candidate, dim: string): string[] {
  if (dim === "location") {
    const l = c.retrievalMetadata.location ?? {};
    return [l.city, l.state, l.country].filter(Boolean) as string[];
  }
  if (dim === "time") return c.retrievalMetadata.time ?? [];
  if (dim in c.retrievalMetadata) {
    const v = (c.retrievalMetadata as any)[dim];
    if (Array.isArray(v)) return v.filter((x: unknown) => typeof x === "string");
  }
  return c.tags;
}

export function chooseRecoveryQuestion(candidates: Candidate[], used: MemoryClue[]) {
  const usedDims = new Set(used.map((c) => c.dimension));
  const dimensions = ["people","objects","scenes","activities","appearance","location","time","ocrText","event"];
  const options: { dim: string; entropy: number; values: string[] }[] = [];

  for (const dim of dimensions) {
    if (usedDims.has(dim as MemoryClue["dimension"])) continue;
    const counts = new Map<string,number>();
    for (const c of candidates.slice(0, 30)) {
      for (const v of valuesFor(c, dim)) {
        const key = v.trim();
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const total = [...counts.values()].reduce((a,b) => a+b,0);
    if (total < 4 || counts.size < 2) continue;
    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    options.push({
      dim,
      entropy,
      values: [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([v])=>v)
    });
  }
  options.sort((a,b)=>b.entropy-a.entropy);
  const best = options[0];
  if (!best) return null;
  return {
    dimension: best.dim,
    question: `What do you remember about ${DIMENSION_LABELS[best.dim] ?? best.dim}?`,
    options: [...best.values, "Not sure"],
  };
}
