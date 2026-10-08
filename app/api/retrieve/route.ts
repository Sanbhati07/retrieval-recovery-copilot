import { NextResponse } from "next/server";
import { parseMemory, embedText, GeminiRuntimeError } from "../../../lib/gemini";
import { getSupabaseAdmin } from "../../../lib/supabase";
import { chooseRecoveryQuestion } from "../../../lib/recovery";
import { detectFailure } from "../../../lib/scoring";
import { rerankCandidates, rowToPhoto } from "../../../lib/data";
import type { Candidate, MemoryClue } from "../../../lib/types";

export const runtime = "nodejs";

function validateClues(raw: unknown): MemoryClue[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is MemoryClue => !!x && typeof x === "object" && "dimension" in x && "value" in x)
    .slice(0, 12);
}

async function vectorSearch(query: number[], limit = 40): Promise<Candidate[]> {
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

function geminiErrorText(error: unknown): string {
  const parts = [
    error instanceof Error ? error.message : "",
    (error as any)?.status,
    (error as any)?.code,
    (error as any)?.error?.message,
    (error as any)?.error?.status,
    (error as any)?.error?.code,
  ].filter(Boolean);

  try {
    parts.push(JSON.stringify(error));
  } catch {}

  return parts.join(" ").toLowerCase();
}

function isTransientGeminiError(error: unknown): boolean {
  const text = geminiErrorText(error);

  return (
    text.includes("503") ||
    text.includes("unavailable") ||
    text.includes("temporarily busy") ||
    text.includes("high demand") ||
    text.includes("502") ||
    text.includes("504")
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withGeminiRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientGeminiError(error) || attempt === 2) {
        throw error;
      }

      await sleep(800 * Math.pow(2, attempt));
    }
  }

  throw lastError;
}
function flattenPhotoText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenPhotoText).join(" ");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(flattenPhotoText).join(" ");
  }
  return "";
}

const RECOVERY_GROUPS = [
  {
    keys: ["vehicle", "car", "motorcycle", "motorbike", "bike", "bicycle", "scooter", "truck", "bus", "automobile"],
    terms: ["vehicle", "car", "motorcycle", "motorbike", "bike", "bicycle", "scooter", "truck", "bus", "automobile"],
  },
  {
    keys: ["person", "people", "family", "man", "woman", "child", "friend", "group"],
    terms: ["person", "people", "family", "man", "woman", "child", "friend", "group"],
  },
  {
    keys: ["building", "place", "road", "landscape", "mountain", "lake", "cafe", "garage", "street", "house"],
    terms: ["building", "place", "road", "landscape", "mountain", "lake", "cafe", "garage", "street", "house"],
  },
  {
    keys: ["sign", "text", "writing", "words", "label", "poster"],
    terms: ["sign", "text", "writing", "words", "label", "poster"],
  },
];

function recoveryTerms(value: string): string[] {
  const text = value.toLowerCase();

  const group = RECOVERY_GROUPS.find((g) =>
    g.keys.some((key) => text.includes(key))
  );

  if (group) return group.terms;

  return text
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3)
    .slice(0, 8);
}

function boostRecoveryResults(
  candidates: Candidate[],
  recoveryClues: MemoryClue[]
): Candidate[] {
  return candidates
    .map((candidate) => {
      const searchable = flattenPhotoText({
        title: candidate.title,
        tags: candidate.tags,
        creator: candidate.creator,
        attribution: candidate.attribution,
        retrievalMetadata: candidate.retrievalMetadata,
      }).toLowerCase();

      let boost = 0;

      for (const clue of recoveryClues) {
        if (!clue.explicit || clue.certainty < 0.75) continue;

        const value = clue.value?.trim();
        if (!value || value.toLowerCase() === "not sure") continue;

        const terms = recoveryTerms(value);
        const hits = terms.filter((term) => searchable.includes(term)).length;

        if (hits > 0) {
          const coverage = Math.min(1, hits / 3);
          boost += 0.18 * coverage;
        }
      }

      return {
        ...candidate,
        structuredScore: Math.min(1, candidate.structuredScore + boost),
        finalScore: Math.min(1, candidate.finalScore + boost),
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}
export async function POST(req: Request) {
  try {
    const body = await req.json() as { memory?: string; activeClues?: MemoryClue[]; sessionId?: string };
    const memory = String(body.memory ?? "").trim();
    const sessionId = String(body.sessionId ?? "").slice(0, 80);
    if (memory.length < 8 || memory.length > 1000) {
      return NextResponse.json({ error: "Please describe the photo in at least a sentence and keep it under 1,000 characters." }, { status: 400 });
    }
    if (!sessionId) return NextResponse.json({ error: "Session is missing. Refresh the page and try again." }, { status: 400 });

    const parsed = await withGeminiRetry(() => parseMemory(memory));
    const supplied = validateClues(body.activeClues);
    const clues = [...parsed.clues, ...supplied]
      .filter((c, i, arr) => arr.findIndex(x => x.dimension === c.dimension && x.value.toLowerCase() === c.value.toLowerCase()) === i)
      .slice(0, 14);

    const queryText = [
  memory,
  ...supplied
    .filter((c) => c.explicit)
    .map((c) => c.value),
].join(". ");

const query = await withGeminiRetry(() => embedText(queryText));
    const candidates = await vectorSearch(query, supplied.length > 0 ? 80 : 40);
    if (!candidates.length) {
      return NextResponse.json({ error: "The photo corpus is not indexed yet. Please try again after the public demo finishes its one-time indexing step." }, { status: 503 });
    }

    const reranked = rerankCandidates(candidates, clues);
const finalResults =
  supplied.length > 0
    ? boostRecoveryResults(reranked, supplied)
    : reranked;
    const failure = detectFailure(finalResults);
    const usedForRecovery = clues.filter(c => c.explicit && c.certainty >= 0.75);
    const recovery = chooseRecoveryQuestion(finalResults, usedForRecovery);

    return NextResponse.json({
      mode: "semantic",
      memory: parsed,
      candidates: finalResults.slice(0, 12).map(c => ({
        id: c.id,
        image: c.image,
        title: c.title,
        creator: c.creator,
        attribution: c.attribution,
        license: c.license,
        licenseUrl: c.licenseUrl,
        score: Number(c.finalScore.toFixed(4)),
        tags: c.tags.slice(0, 8),
      })),
      failure,
      recovery,
    });
  } catch (error) {
    if (error instanceof GeminiRuntimeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "GEMINI_TEMPORARILY_UNAVAILABLE",
        },
        { status: error.httpStatus }
      );
    }

    const message = error instanceof Error
      ? error.message
      : "Unexpected retrieval error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
