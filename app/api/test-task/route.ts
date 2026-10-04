import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("benchmark_tasks")
    .select("task_id,name,difficulty,user_memory")
    .eq("active", true)
    .limit(50);
  if (error || !data?.length) {
    return NextResponse.json({ error: "Benchmark tasks are not seeded yet." }, { status: 503 });
  }
  const task = data[Math.floor(Math.random() * data.length)];
  return NextResponse.json(task);
}
