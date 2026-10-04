import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const taskId = String(body.taskId ?? "").slice(0,80);
    const candidateId = String(body.candidateId ?? "").slice(0,80);
    const sessionId = String(body.sessionId ?? "").slice(0,80);
    if (!taskId || !candidateId || !sessionId) return NextResponse.json({ error: "Missing test fields." }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { data: task, error: taskError } = await supabase.from("benchmark_tasks").select("target_photo_id").eq("task_id", taskId).maybeSingle();
    if (taskError || !task) return NextResponse.json({ error: "Unknown benchmark task." }, { status: 404 });
    const success = candidateId === task.target_photo_id;
    await supabase.from("retrieval_events").insert({
      session_id: sessionId,
      event_name: success ? "retrieval_success" : "retrieval_failed",
      task_id: taskId,
      candidate_id: candidateId,
      metadata: { test_mode: true },
    });
    return NextResponse.json({ success });
  } catch {
    return NextResponse.json({ error: "Test result failed." }, { status: 500 });
  }
}
