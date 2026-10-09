"use client";

import { useCallback, useEffect, useState } from "react";

type TestTask = {
  taskId: string;
  name: string;
  difficulty: string;
  userMemory: string;
};

type Candidate = {
  id: string;
  image: string;
  title?: string | null;
  attribution?: string | null;
  score?: number;
};

type Recovery = {
  dimension: string;
  question: string;
  options: string[];
} | null;

function getSession() {
  const key = "rr_session";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}

async function track(event: string, extra: Record<string, unknown> = {}) {
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, sessionId: getSession(), ...extra }),
    });
  } catch {
    // Telemetry failure must not block the evaluation flow.
  }
}

function normalizeTask(payload: any): TestTask | null {
  const candidate = payload?.task ?? payload?.data?.task ?? payload?.data ?? payload;
  if (!candidate || typeof candidate !== "object") return null;

  const taskId = candidate.taskId ?? candidate.task_id ?? candidate.id ?? payload?.taskId ?? payload?.task_id;
  const userMemory = candidate.userMemory
    ?? candidate.user_memory
    ?? candidate.userMemoryText
    ?? candidate.user_memory_text
    ?? candidate.memory_prompt
    ?? candidate.memoryPrompt
    ?? candidate.memory_description
    ?? candidate.memory_text
    ?? candidate.user_memory_prompt
    ?? candidate.task_prompt
    ?? candidate.search_description
    ?? candidate.description
    ?? candidate.prompt
    ?? candidate.query_text
    ?? candidate.memory
    ?? candidate.query
    ?? payload?.userMemory
    ?? payload?.user_memory
    ?? payload?.memory_prompt
    ?? payload?.user_memory_prompt
    ?? payload?.prompt
    ?? payload?.query_text;

  if (typeof taskId !== "string" || !taskId.trim()) return null;
  if (typeof userMemory !== "string" || userMemory.trim().length < 8) return null;

  // Whitelist public task fields. Never pass a possible target/answer field to UI state.
  return {
    taskId: taskId.trim(),
    userMemory: userMemory.trim(),
    name: String(candidate.name ?? candidate.title ?? candidate.task_name ?? "Find the photo you remember"),
    difficulty: String(candidate.difficulty ?? "Practice task"),
  };
}

export default function Test() {
  const [task, setTask] = useState<TestTask | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingTask, setLoadingTask] = useState(true);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState<Recovery>(null);
  const [activeClues, setActiveClues] = useState<any[]>([]);
  const [mode, setMode] = useState<"control" | "treatment">("treatment");
  const [showRecovery, setShowRecovery] = useState(false);

  const loadTask = useCallback(async () => {
    setLoadingTask(true);
    setMessage("");
    setRecovery(null);
    setActiveClues([]);
    setCandidates([]);
    setShowRecovery(false);
    setTask(null);
    try {
      const response = await fetch("/api/test-task", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load a hidden test task.");
      }
      const normalized = normalizeTask(payload);
      if (!normalized) {
        throw new Error("The test service returned an incomplete task. Please try New hidden task again.");
      }
      setTask(normalized);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load a hidden task.");
    } finally {
      setLoadingTask(false);
    }
  }, []);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  async function runRetrieval(nextClues: any[] = activeClues) {
    if (!task) {
      setMessage("Load a hidden task before running retrieval.");
      return;
    }

    setLoading(true);
    setMessage("");
    setCandidates([]);
    setRecovery(null);
    setShowRecovery(false);
    await track("retrieval_started", { taskId: task.taskId, metadata: { mode } });
    await track("memory_submitted", { taskId: task.taskId, metadata: { mode } });

    try {
      const response = await fetch("/api/retrieve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memory: task.userMemory, activeClues: nextClues, sessionId: getSession() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Retrieval failed. Please try again.");

      const found = Array.isArray(payload?.candidates) ? payload.candidates : [];
      setCandidates(found);
      setMessage(payload?.failure?.reason || (found.length ? "Review the candidates and choose only if one matches." : "No credible candidates were found for this task."));
      setRecovery(mode === "treatment" ? payload?.recovery ?? null : null);
      await track("candidates_shown", { taskId: task.taskId, metadata: { count: found.length, failure: payload?.failure?.type, mode } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Retrieval failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function selectCandidate(candidateId: string, rank: number) {
    if (!task) return;
    setLoading(true);
    try {
      await track("candidate_clicked", { taskId: task.taskId, candidateId, rank, metadata: { mode } });
      const response = await fetch("/api/test-result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.taskId, candidateId, sessionId: getSession() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Could not verify this candidate.");
      setMessage(payload?.success
        ? "Correct photo retrieved. This counts as successful retrieval."
        : "This was not the intended photo. You can reject the set and try a recovery clue.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify this candidate.");
    } finally {
      setLoading(false);
    }
  }

  function rejectCandidates() {
    if (!task) return;
    void track("none_of_these", { taskId: task.taskId, metadata: { mode, candidateCount: candidates.length } });
    setMessage("No candidate selected. Use one additional clue below to refine the search.");
    setShowRecovery(true);
    requestAnimationFrame(() => document.getElementById("test-recovery-step")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function chooseClue(option: string) {
    if (!recovery || !task) return;
    const next = [...activeClues, {
      dimension: recovery.dimension,
      value: option,
      certainty: option === "Not sure" ? 0 : 1,
      explicit: option !== "Not sure",
    }];
    setActiveClues(next);
    void track("recovery_option_selected", { taskId: task.taskId, dimension: recovery.dimension, option, metadata: { mode } });
    void runRetrieval(next);
  }

  return (
    <main className="wrap">
      <div className="eyebrow">Controlled evaluation Â· target hidden</div>
      <h1>Compare single-pass search with guided recovery</h1>
      <p className="sub">
        The same kind of memory can be tested in two modes. Control runs one search. Treatment lets you add a recovery clue if the first candidates are wrong. The intended photo stays hidden and success is checked by the server.
      </p>

      <div className="card">
        <div className="section-title"><h2>1. Choose an approach</h2></div>
        <div className="row">
          <button className={mode === "control" ? "primary" : "secondary"} onClick={() => setMode("control")} disabled={loading || loadingTask}>Control Â· single-pass</button>
          <button className={mode === "treatment" ? "primary" : "secondary"} onClick={() => setMode("treatment")} disabled={loading || loadingTask}>Treatment Â· recovery copilot</button>
          <button className="secondary" onClick={() => void loadTask()} disabled={loading || loadingTask}>New hidden task</button>
        </div>
      </div>

      <div className="card">
        <div className="section-title"><h2>2. Read the memory</h2>{task && <span className="pill">{task.difficulty}</span>}</div>
        {loadingTask && <p className="sub">Preparing a hidden taskâ€¦</p>}
        {!loadingTask && task && <>
          <h3>{task.name}</h3>
          <p className="lead" style={{ fontSize: 17 }}>{task.userMemory}</p>
          <button className="primary" onClick={() => void runRetrieval([])} disabled={loading}>Run retrieval</button>
        </>}
        {!loadingTask && !task && <>
          <p className="banner warn">{message || "No hidden task is available right now."}</p>
          <button className="secondary" onClick={() => void loadTask()}>Try loading the task again</button>
        </>}
      </div>

      {loading && <div className="card" role="status" aria-live="polite"><strong>Finding matching photosâ€¦</strong><p className="sub">Using the selected approach to search the demonstration library.</p></div>}

      {message && task && !loading && <div className="card"><div className={message.startsWith("Correct photo retrieved") ? "success" : "banner warn"}>{message}</div></div>}

      {candidates.length > 0 && <div className="card">
        <div className="section-title"><h2>3. Review the candidates</h2><span className="pill">Target remains hidden</span></div>
        <div className="candidates">
          {candidates.slice(0, 12).map((candidate, index) => (
            <button key={candidate.id} className="candidate" onClick={() => void selectCandidate(candidate.id, index + 1)} disabled={loading}>
              <img src={candidate.image} alt="Candidate photo" />
              <div className="candidate-body"><span className="score">#{index + 1}</span><div className="candidate-title">{candidate.title || "Possible match"}</div><div className="candidate-meta">{candidate.attribution || "Open-licensed photo"}</div></div>
            </button>
          ))}
        </div>
        {mode === "treatment" && <div className="row" style={{ marginTop: 14 }}><button className="secondary" onClick={rejectCandidates} disabled={loading}>None of these</button></div>}
      </div>}

      {showRecovery && mode === "treatment" && <div className="card" id="test-recovery-step">
        <div className="section-title"><h2>4. Recover the search</h2><span className="pill">One clue at a time</span></div>
        {recovery ? <>
          <p className="sub">{recovery.question}</p>
          <div className="chips">
            {recovery.options.map((option) => <button className="chip" key={option} onClick={() => chooseClue(option)} disabled={loading}>{option}</button>)}
          </div>
        </> : <p className="sub">No useful recovery question was available for this result set. Try a new hidden task.</p>}
      </div>}

      <p className="footer">The target photo is never shown to the browser. The server checks selected candidates against the hidden benchmark target. This is a prototype evaluation harness, not a completed real-user study.</p>
    </main>
  );
}
