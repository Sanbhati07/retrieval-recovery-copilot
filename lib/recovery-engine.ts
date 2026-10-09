/**
 * Browser-safe recovery and ranking helpers.
 * These functions do not call Gemini, Supabase, or any network service.
 */

export type RecoveryClue = {
  dimension: string;
  value: string;
  certainty: number;
  explicit: boolean;
};

export type RecoveryCandidate = {
  id: string;
  image?: string;
  title?: string | null;
  creator?: string | null;
  attribution?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
  tags?: string[];
  retrievalMetadata?: Record<string, unknown>;
  semanticScore?: number;
  structuredScore?: number;
  finalScore?: number;
  score?: number;
};

export type RecoveryQuestion = {
  dimension: string;
  question: string;
  options: string[];
} | null;

const DIMENSIONS = [
  "objects", "scenes", "activities", "appearance", "people", "event", "location", "time", "ocrText",
] as const;

const QUESTION_TEXT: Record<string, string> = {
  objects: "Do you remember another object in the photo that is not mentioned in your search?",
  scenes: "What else do you remember about the surroundings?",
  activities: "What else was happening in the photo?",
  appearance: "Do you remember another visual detail, like clothing or colour?",
  people: "Do you remember another detail about the people in the photo?",
  event: "Was there a more specific event or occasion?",
  location: "Do you remember a more specific location detail?",
  time: "Do you remember roughly when it was taken?",
  ocrText: "Do you remember any words, labels or signs in the photo?",
};

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "from", "with", "and", "or", "but", "by",
  "photo", "photos", "picture", "pictures", "image", "images", "thing", "things", "object", "objects",
  "place", "location", "scene", "scenery", "someone", "something", "anything", "another", "other", "unknown",
  "not", "sure", "none", "these", "remember", "looking", "search", "find", "found", "there", "was", "were",
  "have", "had", "that", "this", "its", "their", "very", "some", "many", "old", "taken", "show", "shows",
  "want", "trying", "clicked", "click", "exact", "year", "years", "when", "before", "after", "remembered",
  "remembering", "forgot", "forget", "need", "looking", "find", "finds", "clicking", "dont", "doesnt",
]);

const CONCEPTS: Array<{ key: string; dimension: string; aliases: string[] }> = [
  { key: "building", dimension: "objects", aliases: ["building", "buildings", "house", "houses", "structure", "structures", "temple", "church", "castle", "cabin", "hut", "tower", "office building", "hotel", "school", "warehouse", "apartment", "bungalow", "palace", "mosque"] },
  { key: "room", dimension: "scenes", aliases: ["room", "rooms", "interior", "interiors", "indoor", "indoors", "bedroom", "living room", "dining room", "office", "workspace", "work space", "home office", "study room", "interior design", "home interior", "apartment interior", "inside a house"] },
  { key: "wall", dimension: "objects", aliases: ["wall", "walls", "painted wall", "wallpaper", "interior wall", "blue wall", "brick wall"] },
  { key: "desk", dimension: "objects", aliases: ["desk", "desks", "wooden desk", "office desk", "writing desk", "work desk", "computer desk", "workstation", "table", "tables", "writing table"] },
  { key: "chair", dimension: "objects", aliases: ["chair", "chairs", "office chair", "armchair", "stool"] },
  { key: "laptop", dimension: "objects", aliases: ["laptop", "laptops", "notebook computer"] },
  { key: "monitor", dimension: "objects", aliases: ["monitor", "monitors", "computer monitor", "screen"] },
  { key: "books", dimension: "objects", aliases: ["book", "books", "notebook", "notebooks", "paperwork", "papers", "folder", "folders"] },
  { key: "furniture", dimension: "objects", aliases: ["furniture", "cabinet", "cupboard", "wardrobe", "shelf", "shelves", "dresser", "bed", "sofa", "couch", "table lamp"] },
  { key: "renovation", dimension: "event", aliases: ["renovation", "renovations", "remodel", "remodeling", "remodelling", "renovated room", "room makeover", "home makeover", "refurbishment"] },
  { key: "plant", dimension: "objects", aliases: ["plant", "plants", "potted plant", "potted plants", "houseplant", "houseplants"] },
  { key: "bridge", dimension: "objects", aliases: ["bridge", "bridges", "overpass", "footbridge"] },
  { key: "motorcycle", dimension: "objects", aliases: ["motorcycle", "motorcycles", "motorbike", "motorbikes", "motor cycle", "motor cycles", "bike", "bikes", "biker", "motorcyclist"] },
  { key: "car", dimension: "objects", aliases: ["car", "cars", "automobile", "vehicle", "vehicles", "truck", "bus", "van"] },
  { key: "bicycle", dimension: "objects", aliases: ["bicycle", "bicycles", "cycle", "cycles", "cycling bike"] },
  { key: "helmet", dimension: "objects", aliases: ["helmet", "helmets", "motorcycle helmet"] },
  { key: "sign", dimension: "ocrText", aliases: ["sign", "signs", "road sign", "signboard", "billboard", "notice board", "license plate", "number plate", "placard"] },
  { key: "mountain", dimension: "scenes", aliases: ["mountain", "mountains", "mountainous", "hill", "hills", "highland", "highlands", "mountain range"] },
  { key: "mountain road", dimension: "scenes", aliases: ["mountain road", "mountain pass", "hilly road", "road in the mountains", "road through mountains", "switchback road"] },
  { key: "road", dimension: "scenes", aliases: ["road", "roads", "street", "streets", "highway", "highways", "trail", "trails", "path", "track", "dirt road", "gravel road"] },
  { key: "forest", dimension: "scenes", aliases: ["forest", "forests", "woods", "woodland", "pine trees", "pine forest"] },
  { key: "river", dimension: "scenes", aliases: ["river", "rivers", "stream", "waterfall", "lake", "lakes", "water"] },
  { key: "beach", dimension: "scenes", aliases: ["beach", "beaches", "coast", "seaside", "shore"] },
  { key: "desert", dimension: "scenes", aliases: ["desert", "deserts", "sand dunes", "arid landscape"] },
  { key: "snow", dimension: "scenes", aliases: ["snow", "snowy", "ice", "glacier", "snowfield"] },
  { key: "city", dimension: "scenes", aliases: ["city", "cities", "town", "towns", "urban", "downtown", "city street"] },
  { key: "field", dimension: "scenes", aliases: ["field", "fields", "meadow", "grassland", "open field", "farm"] },
  { key: "riding", dimension: "activities", aliases: ["riding", "ride", "motorbike ride", "motorcycle ride", "biking", "cycling", "driving"] },
  { key: "hiking", dimension: "activities", aliases: ["hiking", "hike", "hiker", "trekking", "walking"] },
  { key: "camping", dimension: "activities", aliases: ["camping", "camp", "tent", "campfire"] },
  { key: "racing", dimension: "activities", aliases: ["racing", "race", "rally", "motocross", "grand prix"] },
  { key: "group", dimension: "people", aliases: ["group", "crowd", "group of people", "team", "gathering"] },
  { key: "family", dimension: "people", aliases: ["family", "parents", "relatives", "children", "kids"] },
  { key: "woman", dimension: "people", aliases: ["woman", "women", "lady", "ladies"] },
  { key: "man", dimension: "people", aliases: ["man", "men", "gentleman", "gentlemen"] },
  { key: "black jacket", dimension: "appearance", aliases: ["black jacket", "dark jacket", "black coat"] },
  { key: "leather jacket", dimension: "appearance", aliases: ["leather jacket", "leather coat"] },
  { key: "backpack", dimension: "objects", aliases: ["backpack", "rucksack", "daypack"] },
  { key: "red clothing", dimension: "appearance", aliases: ["red jacket", "red shirt", "red coat", "red clothing"] },
  { key: "blue clothing", dimension: "appearance", aliases: ["blue jacket", "blue shirt", "blue clothing"] },
  { key: "wedding", dimension: "event", aliases: ["wedding", "marriage ceremony", "bride", "groom"] },
  { key: "birthday", dimension: "event", aliases: ["birthday", "birthday party", "birthday cake"] },
  { key: "festival", dimension: "event", aliases: ["festival", "celebration", "parade", "fair"] },
];

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function includesPhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return (` ${norm(haystack)} `).includes(` ${norm(needle)} `);
}

function valuesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string" && !!x.trim());
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function buildSearchText(memory: string, parsedClues: RecoveryClue[] = [], activeClues: RecoveryClue[] = []): string {
  const clues = [...parsedClues, ...activeClues]
    .filter((clue) => clue && clue.explicit && clue.certainty >= 0.75 && clue.value.trim() && norm(clue.value) !== "not sure")
    .map((clue) => clue.value.trim());
  return [memory.trim(), ...clues].filter(Boolean).join(". ");
}

function candidateText(candidate: RecoveryCandidate): string {
  const metadata = candidate.retrievalMetadata ?? {};
  const location = metadata.location && typeof metadata.location === "object"
    ? Object.values(metadata.location as Record<string, unknown>).join(" ") : "";
  const metaValues = Object.entries(metadata)
    .filter(([key]) => key !== "location")
    .flatMap(([, value]) => valuesOf(value));
  return [candidate.title, candidate.tags?.join(" "), candidate.attribution, location, ...metaValues]
    .filter(Boolean).join(" ");
}

function conceptFor(value: string): { key: string; aliases: string[]; dimension: string } | undefined {
  const n = norm(value);
  return [...CONCEPTS].sort((a, b) => b.aliases.reduce((m, x) => Math.max(m, norm(x).length), 0) - a.aliases.reduce((m, x) => Math.max(m, norm(x).length), 0))
    .find((concept) => concept.key === n || concept.aliases.some((alias) => norm(alias) === n));
}

function conceptsMentioned(text: string): Set<string> {
  const n = ` ${norm(text)} `;
  const result = new Set<string>();
  for (const concept of CONCEPTS) {
    if (concept.aliases.some((alias) => n.includes(` ${norm(alias)} `))) result.add(concept.key);
  }
  return result;
}

// Recovery options are sourced only from candidates sharing a concrete clue
// with the user's memory. Otherwise unrelated catalogue rows can leak terms
// such as road, mountain and forest into a room-renovation search.
const LOW_SIGNAL_CONTEXT_WORDS = new Set([
  "black", "white", "blue", "red", "green", "yellow", "brown", "grey", "gray", "pink", "purple",
  "wooden", "wood", "old", "new", "large", "small", "big", "little", "photo", "photos", "picture",
  "pictures", "image", "images", "year", "years", "date", "time", "exact", "roughly", "sometime",
]);

function contextEvidenceText(candidate: RecoveryCandidate): string {
  const metadata = candidate.retrievalMetadata ?? {};
  const location = metadata.location && typeof metadata.location === "object"
    ? Object.values(metadata.location as Record<string, unknown>).join(" ") : "";
  const metadataValues = Object.entries(metadata)
    .filter(([key]) => key !== "location")
    .flatMap(([, value]) => valuesOf(value));
  // Exclude creator names and attribution from relevance checks.
  return [candidate.title, candidate.tags?.join(" "), location, ...metadataValues]
    .filter(Boolean).join(" ");
}

function contextAnchors(memory: string, usedClues: RecoveryClue[]): { words: string[]; concepts: Set<string> } {
  const context = [memory, ...usedClues
    .filter((clue) => clue.explicit && clue.certainty >= 0.75 && norm(clue.value) !== "not sure")
    .map((clue) => clue.value)].join(" ");
  const words = [...new Set(norm(context).split(" ").filter((word) =>
    word.length >= 3 && !STOP_WORDS.has(word) && !LOW_SIGNAL_CONTEXT_WORDS.has(word) && !/^\d+$/.test(word)
  ))];
  return { words, concepts: conceptsMentioned(context) };
}

function matchesMemoryContext(candidate: RecoveryCandidate, anchors: { words: string[]; concepts: Set<string> }): boolean {
  if (!anchors.words.length && !anchors.concepts.size) return false;
  const text = contextEvidenceText(candidate);
  if (anchors.words.some((word) => includesPhrase(text, word))) return true;
  const candidateConcepts = conceptsMentioned(text);
  return [...anchors.concepts].some((concept) => candidateConcepts.has(concept));
}

export function lexicalRelevanceScore(candidate: RecoveryCandidate, memory: string): number {
  const query = norm(memory).split(" ").filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  if (!query.length) return 0;
  const text = norm(candidateText(candidate));
  const uniqueQuery = [...new Set(query)];
  const matchedWords = uniqueQuery.filter((word) => includesPhrase(text, word)).length;
  const wordCoverage = matchedWords / uniqueQuery.length;
  const queryConcepts = conceptsMentioned(memory);
  const conceptHits = [...queryConcepts].filter((key) => {
    const concept = CONCEPTS.find((item) => item.key === key);
    return !!concept && concept.aliases.some((alias) => includesPhrase(text, alias));
  }).length;
  const conceptCoverage = queryConcepts.size ? conceptHits / queryConcepts.size : 0;
  // Non-vector candidates receive a conservative lexical prior, never the same confidence as a true embedding match.
  return Math.min(0.32, wordCoverage * 0.22 + conceptCoverage * 0.10);
}

function dimensionValues(candidate: RecoveryCandidate, dimension: string): string[] {
  const meta = candidate.retrievalMetadata ?? {};
  const values: string[] = [];
  if (dimension === "location") {
    const location = meta.location;
    if (location && typeof location === "object") values.push(...Object.values(location as Record<string, unknown>).filter((v): v is string => typeof v === "string"));
  } else if (dimension === "time") {
    values.push(...valuesOf(meta.time));
  } else if (dimension in meta) {
    values.push(...valuesOf(meta[dimension]));
  }
  for (const tag of candidate.tags ?? []) {
    const concept = conceptFor(tag);
    if (concept?.dimension === dimension) values.push(concept.key);
    else if (dimension === "objects" && /\b(building|house|temple|church|castle|cabin|tower|bridge|helmet|backpack)\b/i.test(tag)) values.push(tag);
    else if (dimension === "scenes" && /\b(mountain|hill|road|forest|river|lake|beach|desert|snow|city|field|trail)\b/i.test(tag)) values.push(tag);
    else if (dimension === "ocrText" && /\b(sign|text|words|billboard|plate)\b/i.test(tag)) values.push(tag);
  }
  const text = candidateText(candidate);
  for (const concept of CONCEPTS) {
    if (concept.dimension === dimension && concept.aliases.some((alias) => includesPhrase(text, alias))) values.push(concept.key);
  }
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function termIsAlreadyKnown(term: string, memoryAndClues: string): boolean {
  const nTerm = norm(term);
  const nKnown = norm(memoryAndClues);
  if (!nTerm) return true;
  if (includesPhrase(nKnown, nTerm)) return true;
  const concept = conceptFor(term);
  if (concept) {
    const mentioned = conceptsMentioned(memoryAndClues);
    if (mentioned.has(concept.key)) return true;
    // Related aliases such as "bike" and "motorcycle" should not be asked twice.
    if (concept.key === "motorcycle" && /\b(bike|bikes|motorbike|motorcycle)\b/.test(nKnown)) return true;
    if (concept.key === "mountain" && /\b(mountain|mountains|hill|hills)\b/.test(nKnown)) return true;
    if (concept.key === "road" && /\b(road|roads|street|highway|trail|path)\b/.test(nKnown)) return true;
  }
  return false;
}

export function chooseRecoveryQuestion(
  candidates: RecoveryCandidate[],
  usedClues: RecoveryClue[] = [],
  originalMemory = "",
): RecoveryQuestion {
  if (!candidates.length) return null;
  const knownText = [originalMemory, ...usedClues.filter((c) => c.explicit && c.certainty >= 0.75).map((c) => c.value)].join(" ");
  const anchors = contextAnchors(originalMemory, usedClues);
  // Filter before slicing because useful candidates may appear after unrelated
  // semantic results or inside the catalogue metadata backfill.
  const available = candidates.filter((candidate) => matchesMemoryContext(candidate, anchors)).slice(0, 80);
  // When too few context-matching candidates exist, let the UI fall back to
  // free text rather than offering unsupported or unrelated keyword buttons.
  if (available.length < 3) return null;
  const rankedDimensions: Array<{ dimension: string; score: number; terms: Array<{ value: string; count: number }> }> = [];

  for (const dimension of DIMENSIONS) {
    const counts = new Map<string, Set<string>>();
    for (const candidate of available) {
      const seenForCandidate = new Set<string>();
      for (const raw of dimensionValues(candidate, dimension)) {
        const value = raw.trim();
        const normalized = norm(value);
        if (!normalized || normalized.length < 3 || STOP_WORDS.has(normalized) || termIsAlreadyKnown(value, knownText)) continue;
        if (/^(photo|image|picture|outdoor|outdoors|travel|trip|person|people|vehicle|object|place|location|unknown)$/.test(normalized)) continue;
        if (seenForCandidate.has(normalized)) continue;
        seenForCandidate.add(normalized);
        if (!counts.has(normalized)) counts.set(normalized, new Set());
        counts.get(normalized)!.add(candidate.id);
      }
    }

    const terms = [...counts.entries()]
      .map(([value, ids]) => ({ value, count: ids.size }))
      .filter((term) => term.count >= 1 && term.count < available.length)
      .sort((a, b) => {
        // Low-to-medium prevalence helps distinguish the candidate set without asking about one bizarre outlier.
        const aUseful = a.count === 1 ? 0.65 : 1 - Math.abs(a.count / available.length - 0.35);
        const bUseful = b.count === 1 ? 0.65 : 1 - Math.abs(b.count / available.length - 0.35);
        return bUseful - aUseful || a.value.localeCompare(b.value);
      });
    if (terms.length < 2) continue;

    const total = terms.reduce((sum, term) => sum + term.count, 0);
    const entropy = terms.reduce((sum, term) => {
      const p = term.count / total;
      return p > 0 ? sum - p * Math.log2(p) : sum;
    }, 0);
    const coverage = new Set(terms.flatMap((term) => [...(counts.get(term.value) ?? [])])).size / available.length;
    rankedDimensions.push({ dimension, score: entropy * 0.75 + Math.min(terms.length, 5) * 0.18 + coverage * 0.2, terms });
  }

  rankedDimensions.sort((a, b) => b.score - a.score);
  const best = rankedDimensions[0];
  if (!best) return null;
  const options = best.terms.slice(0, 4).map((term) => term.value);
  if (options.length < 2) return null;
  return { dimension: best.dimension, question: QUESTION_TEXT[best.dimension] ?? "Do you remember another detail about the photo?", options };
}

export function inferClueDimension(value: string): string {
  const n = norm(value);
  for (const concept of CONCEPTS) {
    if (concept.aliases.some((alias) => includesPhrase(n, alias))) return concept.dimension;
  }
  if (/\b(when|year|month|morning|evening|winter|summer|date|time)\b/.test(n)) return "time";
  if (/\b(city|town|country|place|near|location|address|cafe|café|restaurant)\b/.test(n)) return "location";
  if (/\b(wear|wearing|jacket|coat|shirt|dress|colour|color|black|white|red|blue|green)\b/.test(n)) return "appearance";
  if (/\b(sign|text|word|written|label|number|license plate|number plate)\b/.test(n)) return "ocrText";
  if (/\b(friend|person|people|family|parents|child|children|woman|man|group)\b/.test(n)) return "people";
  if (/\b(mountain|hill|road|forest|river|lake|beach|snow|desert|field|trail|bridge)\b/.test(n)) return "scenes";
  return "objects";
}

function clueAliases(value: string): string[] {
  const concept = conceptFor(value);
  if (concept) return [...new Set([concept.key, ...concept.aliases])];
  return [value];
}

function candidateSupportsClue(candidate: RecoveryCandidate, clue: RecoveryClue): boolean {
  const text = norm(candidateText(candidate));
  const meta = candidate.retrievalMetadata ?? {};
  const dimensionSpecific = dimensionValues(candidate, clue.dimension).map(norm).join(" ");
  const nValue = norm(clue.value);
  const aliases = clueAliases(clue.value).map(norm).filter(Boolean);
  if (aliases.some((alias) => includesPhrase(text, alias) || includesPhrase(dimensionSpecific, alias))) return true;

  // Free text needs more than a vague one-word overlap. Match all words in short clues, or most useful words in longer clues.
  const contentWords = nValue.split(" ").filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  if (!contentWords.length) return false;
  const matched = contentWords.filter((word) => includesPhrase(text, word)).length;
  if (contentWords.length <= 2) return matched === contentWords.length;
  return matched / contentWords.length >= 0.6;
}

function scoreFor(candidate: RecoveryCandidate): number {
  const recoveryScore = (candidate as RecoveryCandidate & { _recoveryScore?: number })._recoveryScore;
  const raw = Number(recoveryScore ?? candidate.finalScore ?? candidate.score ?? candidate.semanticScore ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function signature(candidate: RecoveryCandidate): Set<string> {
  const titleAndTags = [candidate.title ?? "", ...(candidate.tags ?? [])].join(" ");
  return new Set(norm(titleAndTags).split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token) && !/^\d+$/.test(token) && !/^section$/.test(token)));
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  return common / (a.size + b.size - common);
}

export function diversifyCandidates<T extends RecoveryCandidate>(candidates: T[], limit = 12): T[] {
  const sorted = [...candidates].sort((a, b) => scoreFor(b) - scoreFor(a));
  const chosen: T[] = [];
  const signatures: Set<string>[] = [];
  for (const candidate of sorted) {
    const currentSignature = signature(candidate);
    const nearDuplicate = signatures.some((existing) => similarity(existing, currentSignature) >= 0.78);
    if (!nearDuplicate) {
      chosen.push(candidate);
      signatures.push(currentSignature);
      if (chosen.length >= limit) return chosen;
    }
  }
  // Prefer a smaller, genuinely varied set over padding the grid with near-identical images.
  return chosen.slice(0, limit);
}

export function mergeRejectedIds(previousIds: string[], newlyRejectedIds: string[]): string[] {
  return [...new Set([...previousIds, ...newlyRejectedIds.filter(Boolean)])];
}

export function rankRecoveryCandidates<T extends RecoveryCandidate>(
  pool: T[],
  rejectedIds: string[],
  clues: RecoveryClue[],
  originalMemory: string,
  limit = 12,
): { candidates: T[]; noMatch: boolean; message: string } {
  const rejected = new Set(rejectedIds);
  const remaining = pool.filter((candidate) => !rejected.has(candidate.id));
  const confirmed = clues.filter((clue) => clue && clue.explicit && clue.certainty >= 0.75 && clue.value.trim() && norm(clue.value) !== "not sure");
  const latest = confirmed[confirmed.length - 1];

  if (!remaining.length) {
    return { candidates: [], noMatch: true, message: "We have already ruled out the photos in this search. Add another detail to keep narrowing it down." };
  }

  let ranked = remaining.map((candidate) => ({ ...candidate, _recoveryScore: scoreFor(candidate) } as T & { _recoveryScore: number }));
  if (latest) {
    const supported = ranked.filter((candidate) => candidateSupportsClue(candidate, latest));
    if (!supported.length) {
      return {
        candidates: [],
        noMatch: true,
        message: `No photo in the current candidate pool has metadata supporting “${latest.value}”. Try a different detail. This does not prove the photo is absent from the full library.`,
      };
    }
    const prior = confirmed.slice(0, -1);
    ranked = supported.map((candidate) => {
      let bonus = 0.18;
      for (const clue of prior) if (candidateSupportsClue(candidate, clue)) bonus += 0.025;
      // Original memory stays relevant through its initial semantic/structured score. Add a small cue check as a tie-breaker.
      const knownConcepts = conceptsMentioned(originalMemory);
      if (knownConcepts.size && [...knownConcepts].some((concept) => candidateSupportsClue(candidate, { dimension: "objects", value: concept, certainty: 1, explicit: true }))) bonus += 0.015;
      // Keep the reported score in the same 0–1 range as the initial retrieval score.
      return { ...candidate, _recoveryScore: Math.min(1, scoreFor(candidate) + bonus) } as T & { _recoveryScore: number };
    });
  }

  ranked.sort((a, b) => b._recoveryScore - a._recoveryScore);
  const displayed = diversifyCandidates(ranked, limit).map((candidate) => {
    const { _recoveryScore, ...clean } = candidate as T & { _recoveryScore?: number };
    return { ...clean, finalScore: _recoveryScore ?? scoreFor(candidate), score: _recoveryScore ?? scoreFor(candidate) } as T;
  });
  return { candidates: displayed, noMatch: false, message: latest ? `Results refined using “${latest.value}”. Previously rejected photos were excluded.` : "Results reordered using the clues you confirmed." };
}
