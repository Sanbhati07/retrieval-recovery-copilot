import { NextResponse } from "next/server";
import { parseMemory, embedText } from "../../../lib/gemini";
import { getSupabaseAdmin } from "../../../lib/supabase";
import { detectFailure } from "../../../lib/scoring";
import { rerankCandidates, rowToPhoto } from "../../../lib/data";
import {
  buildSearchText,
  chooseRecoveryQuestion,
  diversifyCandidates,
  lexicalRelevanceScore,
  type RecoveryCandidate,
  type RecoveryClue,
} from "../../../lib/recovery-engine";
import type { Candidate, MemoryClue } from "../../../lib/types";

export const runtime = "nodejs";

const INITIAL_CANDIDATE_POOL = 80;
const DISPLAY_LIMIT = 12;

function validateClues(raw: unknown): MemoryClue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is MemoryClue => {
      if (!item || typeof item !== "object") return false;
      const clue = item as Partial<MemoryClue>;
      return typeof clue.dimension === "string" && typeof clue.value === "string" &&
        typeof clue.certainty === "number" && typeof clue.explicit === "boolean";
    })
    .map((clue) => ({
      dimension: clue.dimension,
      value: clue.value.trim().slice(0, 160),
      certainty: Math.max(0, Math.min(1, clue.certainty)),
      explicit: clue.explicit,
    }))
    .filter((clue) => clue.value.length > 0)
    .slice(0, 12);
}

async function vectorSearch(query: number[], limit = INITIAL_CANDIDATE_POOL): Promise<Candidate[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("match_photo_embeddings", {
    query_embedding: query,
    match_count: limit,
  });
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.map((row: any) => {
    const photo = rowToPhoto(row);
    const semanticScore = Math.max(0, Math.min(1, Number(row.similarity ?? 0)));
    return { ...photo, semanticScore, structuredScore: 0, finalScore: semanticScore };
  });
}

function publicCandidate(candidate: Candidate): RecoveryCandidate {
  const raw = candidate.retrievalMetadata ?? {};
  const stringList = (key: string, limit: number): string[] => {
    const value = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 100)).slice(0, limit);
  };
  const locationRaw = (raw as Record<string, unknown>).location;
  const location = locationRaw && typeof locationRaw === "object"
    ? Object.fromEntries(Object.entries(locationRaw as Record<string, unknown>).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value).slice(0, 100)]))
    : {};
  const retrievalMetadata = {
    people: stringList("people", 8),
    objects: stringList("objects", 12),
    scenes: stringList("scenes", 12),
    activities: stringList("activities", 8),
    appearance: stringList("appearance", 8),
    event: stringList("event", 8),
    time: stringList("time", 6),
    ocrText: stringList("ocrText", 8),
    location,
    description: String((raw as Record<string, unknown>).description ?? "").slice(0, 240),
    queryTerms: stringList("queryTerms", 12),
  };
  return {
    id: candidate.id,
    image: candidate.image,
    title: candidate.title,
    creator: candidate.creator,
    attribution: candidate.attribution,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    tags: candidate.tags.slice(0, 24).map((tag) => tag.slice(0, 100)),
    retrievalMetadata,
    semanticScore: candidate.semanticScore,
    structuredScore: candidate.structuredScore,
    finalScore: candidate.finalScore,
    score: candidate.finalScore,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      memory?: string;
      activeClues?: MemoryClue[];
      sessionId?: string;
    };
    const memory = String(body.memory ?? "").trim();
    const sessionId = String(body.sessionId ?? "").slice(0, 80);

    if (memory.length < 8 || memory.length > 1000) {
      return NextResponse.json({ error: "Please describe the photo in at least a sentence and keep it under 1,000 characters." }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ error: "Session is missing. Refresh the page and try again." }, { status: 400 });
    }

    // Gemini is used only for a fresh memory search. Recovery answers are ranked locally in the browser.
    const parsed = await parseMemory(memory);
    const supplied = validateClues(body.activeClues);
    const combinedClues = [...parsed.clues, ...supplied]
      .filter((clue, index, all) => all.findIndex((other) =>
        other.dimension === clue.dimension && other.value.toLowerCase() === clue.value.toLowerCase()) === index)
      .slice(0, 14);

    const semanticText = [parsed.memorySummary, buildSearchText(memory, parsed.clues as RecoveryClue[], supplied)].filter(Boolean).join(". ");
    const query = await embedText(semanticText);
    const vectorCandidates = await vectorSearch(query, INITIAL_CANDIDATE_POOL);
    if (!vectorCandidates.length) {
      return NextResponse.json({ error: "The photo corpus is not indexed yet. Please try again after the public demo finishes its one-time indexing step." }, { status: 503 });
    }

    // Load lightweight public metadata for the complete 1,000-photo demo corpus once.
    // This lets recovery find a supported clue outside the first semantic top-80 without another embedding call.
    const supabase = getSupabaseAdmin();
    const { data: catalogRows, error: catalogError } = await supabase
      .from("photo_catalog")
      .select("id,public_url,title,creator,creator_url,license,license_version,license_url,attribution,provider,source,source_url,tags,retrieval_metadata")
      .eq("active", true)
      .eq("embedding_status", "ready")
      .range(0, 999);
    if (catalogError) throw catalogError;
    if (!Array.isArray(catalogRows) || catalogRows.length === 0) {
      return NextResponse.json({ error: "Photo metadata is temporarily unavailable. Please try again later." }, { status: 503 });
    }

    const vectorScores = new Map(vectorCandidates.map((candidate) => [candidate.id, candidate.semanticScore]));
    const fullCatalog: Candidate[] = catalogRows.map((row: any) => {
      const photo = rowToPhoto(row);
      const vectorScore = vectorScores.get(photo.id);
      const semanticScore = vectorScore ?? lexicalRelevanceScore(photo, memory);
      return { ...photo, semanticScore, structuredScore: 0, finalScore: semanticScore };
    });

    const rankedCatalog = rerankCandidates(fullCatalog, combinedClues);
    const vectorIds = new Set(vectorScores.keys());
    // Keep the visible first-pass ranking grounded in actual vector matches. Use catalogue metadata
    // as a quota-free backfill pool only for recovery, so a later confirmed clue can retrieve beyond top-80.
    const semanticRanked = rankedCatalog.filter((candidate) => vectorIds.has(candidate.id));
    const metadataBackfill = rankedCatalog.filter((candidate) => !vectorIds.has(candidate.id));
    const recoveryCandidates = [...semanticRanked, ...metadataBackfill];
    const pool = recoveryCandidates.map(publicCandidate);
    const visibleCandidates = diversifyCandidates(semanticRanked.map(publicCandidate), DISPLAY_LIMIT);
    const usedClues = combinedClues as RecoveryClue[];
    const recovery = chooseRecoveryQuestion(pool, usedClues, memory);

    return NextResponse.json({
      mode: "semantic",
      memory: parsed,
      candidates: visibleCandidates,
      recoveryPool: pool,
      failure: detectFailure(semanticRanked),
      recovery,
      recoveryStrategy: "local_candidate_pool",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected retrieval error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
