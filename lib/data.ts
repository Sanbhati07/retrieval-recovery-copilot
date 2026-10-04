import type { Candidate, MemoryClue, Photo, RetrievalMetadata } from "./types";

function stringTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    if (typeof x === "string") return x;
    if (x && typeof x === "object" && "name" in x) return String((x as {name?: unknown}).name ?? "");
    return "";
  }).map((x) => x.trim()).filter(Boolean).slice(0, 40);
}

export function rowToPhoto(row: any): Photo {
  const rm = (row?.retrieval_metadata && typeof row.retrieval_metadata === "object")
    ? row.retrieval_metadata as RetrievalMetadata
    : {};
  return {
    id: String(row.id),
    image: String(row.public_url),
    title: row.title ?? null,
    creator: row.creator ?? null,
    creatorUrl: row.creator_url ?? null,
    license: String(row.license ?? ""),
    licenseVersion: row.license_version ?? null,
    licenseUrl: String(row.license_url ?? ""),
    attribution: row.attribution ?? null,
    provider: row.provider ?? null,
    source: row.source ?? null,
    sourceUrl: row.source_url ?? null,
    tags: stringTags(row.tags),
    retrievalMetadata: rm,
  };
}

export function photoValuesFor(photo: Photo, dim: MemoryClue["dimension"]): string[] {
  if (dim === "location") {
    const l = photo.retrievalMetadata.location ?? {};
    return [l.city, l.state, l.country].filter(Boolean) as string[];
  }
  if (dim === "time") return photo.retrievalMetadata.time ?? [];
  const value = photo.retrievalMetadata[dim];
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
  return [];
}

export function lexicalText(photo: Photo): string {
  return [
    photo.title ?? "",
    photo.tags.join(" "),
    photo.retrievalMetadata.description ?? "",
    ...(photo.retrievalMetadata.queryTerms ?? []),
    ...photoValuesFor(photo, "objects"),
    ...photoValuesFor(photo, "scenes"),
    ...photoValuesFor(photo, "activities"),
    ...photoValuesFor(photo, "appearance"),
    ...photoValuesFor(photo, "event"),
  ].join(" ");
}

export function structuredScore(photo: Photo, clues: MemoryClue[]): number {
  const usable = clues.filter((c) => c.value.trim() && c.certainty >= 0.3);
  if (!usable.length) return 0;
  let score = 0, weight = 0;
  const allTags = photo.tags.map((x) => x.toLowerCase());
  const text = lexicalText(photo).toLowerCase();
  for (const clue of usable) {
    const v = clue.value.toLowerCase();
    const vals = photoValuesFor(photo, clue.dimension).map((x) => x.toLowerCase());
    const hit = vals.some((x) => x.includes(v) || v.includes(x)) ||
      allTags.some((x) => x.includes(v) || v.includes(x)) ||
      text.includes(v);
    const w = 0.5 + Math.min(1, Math.max(0, clue.certainty)) * 0.5;
    weight += w;
    if (hit) score += w;
  }
  return weight ? score / weight : 0;
}

export function rerankCandidates(candidates: Candidate[], clues: MemoryClue[]): Candidate[] {
  return candidates.map((c) => {
    const s = structuredScore(c, clues);
    return { ...c, structuredScore: s, finalScore: 0.65 * c.semanticScore + 0.35 * s };
  }).sort((a,b) => b.finalScore - a.finalScore);
}
