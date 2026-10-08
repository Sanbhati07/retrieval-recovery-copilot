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

export async function POST(req: Request) {
  try {
    const body = await req.json() as { memory?: string; activeClues?: MemoryClue[]; sessionId?: string };
    const memory = String(body.memory ?? "").trim();
    const sessionId = String(body.sessionId ?? "").slice(0, 80);
    if (memory.length < 8 || memory.length > 1000) {
      return NextResponse.json({ error: "Please describe the photo in at least a sentence and keep it under 1,000 characters." }, { status: 400 });
    }
    if (!sessionId) return NextResponse.json({ error: "Session is missing. Refresh the page and try again." }, { status: 400 });

    const parsed = await parseMemory(memory);
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

const query = await embedText(queryText);
    const candidates = await vectorSearch(query, 40);
    if (!candidates.length) {
      return NextResponse.json({ error: "The photo corpus is not indexed yet. Please try again after the public demo finishes its one-time indexing step." }, { status: 503 });
    }

    const reranked = rerankCandidates(candidates, clues);
    const failure = detectFailure(reranked);
    const usedForRecovery = clues.filter(c => c.explicit && c.certainty >= 0.75);
    const recovery = chooseRecoveryQuestion(reranked, usedForRecovery);

    return NextResponse.json({
      mode: "semantic",
      memory: parsed,
      candidates: reranked.slice(0, 12).map(c => ({
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
