import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "retrieval_started","memory_submitted","candidates_shown","candidate_clicked",
  "recovery_question_shown","recovery_option_selected","none_of_these","retrieval_success","retrieval_failed"
]);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const event = String(body.event ?? "");
    const sessionId = String(body.sessionId ?? "").slice(0, 80);
    if (!ALLOWED.has(event) || !sessionId) return NextResponse.json({ ok:false }, { status:400 });
    const supabase = getSupabaseAdmin();
    await supabase.from("retrieval_events").insert({
      session_id: sessionId,
      event_name: event,
      task_id: body.taskId ? String(body.taskId).slice(0,80) : null,
      candidate_id: body.candidateId ? String(body.candidateId).slice(0,80) : null,
      candidate_rank: Number.isFinite(body.rank) ? body.rank : null,
      dimension: body.dimension ? String(body.dimension).slice(0,80) : null,
      option: body.option ? String(body.option).slice(0,120) : null,
      metadata: typeof body.metadata === "object" ? body.metadata : {},
    });
    return NextResponse.json({ ok:true });
  } catch {
    // Public demo must remain functional even if analytics is temporarily unavailable.
    return NextResponse.json({ ok:false });
  }
}
