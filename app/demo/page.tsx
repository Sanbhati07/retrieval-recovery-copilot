"use client";

import { useMemo, useState } from "react";
import {
  chooseRecoveryQuestion,
  diversifyCandidates,
  inferClueDimension,
  mergeRejectedIds,
  rankRecoveryCandidates,
  type RecoveryCandidate,
  type RecoveryClue,
  type RecoveryQuestion,
} from "../../lib/recovery-engine";

type DemoCandidate = RecoveryCandidate;
type ParsedMemory = { memorySummary: string; clues: RecoveryClue[]; unknownDimensions: string[] };
type Failure = { type: string; reason: string };
type RetrievalResponse = {
  mode: string;
  memory: ParsedMemory;
  candidates: DemoCandidate[];
  recoveryPool: DemoCandidate[];
  failure: Failure;
  recovery: RecoveryQuestion;
  recoveryStrategy?: string;
};

type SampleMemory = { label: string; memory: string };

const SAMPLE_MEMORIES: SampleMemory[] = [
  { label: "Car repair", memory: "I remember a photo of my car engine repair, but I don't remember when I took it. There were tools around the engine." },
  { label: "Mountain trip", memory: "I remember a bike trip photo in the mountains. I was wearing a black jacket and a friend was with me, but I don't remember the exact year." },
  { label: "Family photo", memory: "I'm trying to find an old photo with my parents at a family function. I remember the room and who was there, but not the date." },
  { label: "Cafe trip", memory: "I remember a photo from a cafe I visited in Goa. There was a coffee cup on the table, but I can't remember the name or the day." },
  { label: "Bike trip", memory: "I need a photo from a long ride. I remember a winding road and a motorcycle, but the exact place is not coming to mind." },
  { label: "Room before renovation", memory: "I want to find a photo of my room before renovation. I remember the old blue wall and a wooden desk, but not when I clicked it." },
];

function getSession(): string {
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
    // Analytics must never block the retrieval experience.
  }
}

function toVisibleCandidate(candidate: DemoCandidate, rank: number): DemoCandidate {
  return { ...candidate, score: Number(candidate.finalScore ?? candidate.score ?? candidate.semanticScore ?? 0) };
}

export default function Demo() {
  const [memory, setMemory] = useState(SAMPLE_MEMORIES[1].memory);
  const [activeClues, setActiveClues] = useState<RecoveryClue[]>([]);
  const [result, setResult] = useState<RetrievalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [rejectedIds, setRejectedIds] = useState<string[]>([]);
  const [freeTextClue, setFreeTextClue] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [noMatch, setNoMatch] = useState(false);

  const initialClues = useMemo(() => result?.memory.clues ?? [], [result]);
  const clueText = useMemo(() => initialClues.filter((clue) => clue.explicit).slice(0, 6), [initialClues]);
  const recoveryPool = result?.recoveryPool ?? [];

  async function runInitialSearch(nextMemory = memory) {
    setLoading(true);
    setError("");
    setSelected(null);
    setConfirmed(false);
    setResult(null);
    setActiveClues([]);
    setRejectedIds([]);
    setShowRecovery(false);
    setFreeTextClue("");
    setRecoveryNotice("");
    setNoMatch(false);

    await track("retrieval_started");
    await track("memory_submitted", { metadata: { length: nextMemory.length } });
    try {
      const response = await fetch("/api/retrieve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memory: nextMemory, activeClues: [], sessionId: getSession() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Retrieval failed");
      setResult(data as RetrievalResponse);
      await track("candidates_shown", { metadata: { count: data.candidates?.length || 0, failure: data.failure?.type, mode: data.mode } });
      if (data.recovery) await track("recovery_question_shown", { dimension: data.recovery.dimension });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected retrieval error");
    } finally {
      setLoading(false);
    }
  }

  function openRecovery() {
    if (!result) return;
    const rejectedNow = result.candidates.map((candidate) => candidate.id);
    const allRejected = mergeRejectedIds(rejectedIds, rejectedNow);
    setRejectedIds(allRejected);
    setSelected(null);
    setConfirmed(false);
    setShowRecovery(true);
    setNoMatch(false);
    setRecoveryNotice("The photos currently shown have been ruled out. We'll use a different clue and keep those photos out of the next results.");
    const allowedPool = recoveryPool.filter((candidate) => !allRejected.includes(candidate.id));
    const question = chooseRecoveryQuestion(allowedPool, [...initialClues, ...activeClues], memory);
    setResult({ ...result, recovery: question });
    setFreeTextClue("");
    void track("none_of_these", { metadata: { rejectedCount: rejectedNow.length } });
    requestAnimationFrame(() => document.getElementById("recovery-step")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function applyRecoveryClue(clue: RecoveryClue) {
    if (!result) return;
    const nextClues = [...activeClues, clue];
    const confirmedClues = [...initialClues, ...nextClues];
    setActiveClues(nextClues);
    setLocalLoading(true);
    setError("");
    setSelected(null);
    setRecoveryNotice(`Using â€œ${clue.value}â€ to refine the results. Previously rejected photos stay excluded.`);

    // Local-only recovery. No /api/retrieve call, no Gemini parse, and no new embedding request.
    window.setTimeout(() => {
      const ranked = rankRecoveryCandidates(recoveryPool, rejectedIds, confirmedClues, memory, 12);
      const nextVisible = ranked.candidates.map((candidate, index) => toVisibleCandidate(candidate, index + 1));
      const availablePool = recoveryPool.filter((candidate) => !rejectedIds.includes(candidate.id));
      const nextQuestion = chooseRecoveryQuestion(availablePool, confirmedClues, memory);
      setResult({
        ...result,
        candidates: nextVisible,
        recovery: nextQuestion,
        failure: nextVisible.length
          ? { type: "recovered_candidates", reason: ranked.message }
          : { type: "zero_result", reason: ranked.message },
      });
      setNoMatch(ranked.noMatch || nextVisible.length === 0);
      setRecoveryNotice(ranked.message);
      setShowRecovery(ranked.noMatch || nextVisible.length === 0);
      setLocalLoading(false);
      void track("recovery_option_selected", { dimension: clue.dimension, option: clue.value });
      void track("candidates_shown", { metadata: { count: nextVisible.length, mode: "local_recovery" } });
      if (nextQuestion) void track("recovery_question_shown", { dimension: nextQuestion.dimension });
      requestAnimationFrame(() => document.getElementById("results-step")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }, 120);
  }

  function selectRecoveryOption(value: string) {
    if (!result?.recovery || value === "Not sure") {
      setRecoveryNotice("No clue added yet. Type a detail you genuinely remember, or choose one of the supported options above.");
      document.getElementById("recovery-free-text")?.focus();
      return;
    }
    applyRecoveryClue({ dimension: result.recovery.dimension, value, certainty: 1, explicit: true });
  }

  function submitFreeTextClue() {
    const value = freeTextClue.trim().slice(0, 160);
    if (!value) {
      setRecoveryNotice("Add one detail you remember, such as a colour, object, sign or part of the scene.");
      return;
    }
    applyRecoveryClue({ dimension: inferClueDimension(value), value, certainty: 1, explicit: true });
    setFreeTextClue("");
  }

  const displayedCandidates = result?.candidates ?? [];
  const selectedCandidate = displayedCandidates.find((candidate) => candidate.id === selected) ?? null;

  return <main className="wrap">
    <div className="top">
      <div>
        <div className="eyebrow">Retrieval Recovery Copilot</div>
        <h1>Find the photo you remember, even when you forgot the details.</h1>
        <p className="lead">Describe it in your own words. If the first results are wrong, rule them out and use one more clue to narrow the search.</p>
      </div>
      <a href="/" className="pill">About this prototype</a>
    </div>

    <section className="card">
      <div className="section-title"><h2>Describe the photo you remember</h2><span className="pill">No exact date required</span></div>
      <textarea className="input" value={memory} onChange={(event: { target: { value: string } }) => setMemory(event.target.value)} disabled={loading || localLoading} maxLength={1000} placeholder="Example. I remember a photo from a trip, but not the year or exact place." />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" disabled={loading || localLoading || memory.trim().length < 8} onClick={() => void runInitialSearch()}>{loading ? "Searching..." : localLoading ? "Refining..." : "Find my photo"}</button>
        <span className="sub">A fresh search uses Gemini once to understand the memory and once to create its text embedding. Recovery steps below run locally on the retrieved candidate pool.</span>
      </div>
      <div style={{ marginTop: 18 }}>
        <p className="sub" style={{ marginBottom: 8 }}>Or start with an example</p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
          {SAMPLE_MEMORIES.map((sample) => <button key={sample.label} type="button" className="secondary" disabled={loading || localLoading} style={{ textAlign: "left", height: "auto", minHeight: 74 }} onClick={() => {
            setMemory(sample.memory);
            setResult(null); setActiveClues([]); setSelected(null); setConfirmed(false); setShowRecovery(false); setRejectedIds([]); setError(""); setRecoveryNotice(""); setNoMatch(false);
          }}>
            <strong>{sample.label}</strong><br /><span className="sub">{sample.memory}</span>
          </button>)}
        </div>
      </div>
    </section>

    {error && <section className="card"><div className="banner warn"><b>{/quota|resource_exhausted|429/i.test(error) ? "Search is temporarily unavailable" : "Something went wrong"}</b><br />{/quota|resource_exhausted|429/i.test(error) ? "This demo uses the Gemini API free tier, and its daily quota has been reached. Please try again after the quota resets." : error}</div></section>}

    {result && <>
      <section className="card">
        <div className="section-title"><h2>What I understood</h2><span className="pill">{result.mode === "semantic" ? "AI semantic retrieval" : "Demo results"}</span></div>
        <p className="sub">{result.memory.memorySummary}</p>
        <div className="chips">{clueText.map((clue, index) => <span className="chip" key={`${clue.dimension}-${clue.value}-${index}`}>{clue.value}</span>)}</div>
      </section>

      <section className="card" id="results-step">
        <div className="section-title"><h2>{noMatch ? "No supported matches for that clue" : "Let's narrow this down"}<span className="pill">{displayedCandidates.length} shown</span></h2><span className="pill">{result.failure.type}</span></div>
        <div className={noMatch ? "banner warn" : result.failure.type === "strong" ? "banner" : "banner warn"}>{result.failure.reason}</div>
        {!showRecovery && !localLoading && recoveryNotice && <div className="banner" role="status" aria-live="polite">{recoveryNotice}</div>}
        {displayedCandidates.length > 0 ? <div className="candidates">
          {displayedCandidates.map((candidate, index) => <button key={candidate.id} type="button" className="candidate" onClick={() => {
            setSelected(candidate.id);
            setConfirmed(false);
            void track("candidate_clicked", { candidateId: candidate.id, rank: index + 1, metadata: { score: candidate.score ?? candidate.finalScore } });
            requestAnimationFrame(() => document.getElementById("candidate-confirmation")?.scrollIntoView({ behavior: "smooth", block: "center" }));
          }}>
            {candidate.image && <img src={candidate.image} alt={candidate.title ? `Possible match ${candidate.title}` : "Candidate photo"} loading="lazy" />}
            <div className="candidate-body"><span className="score">#{index + 1}</span><div className="candidate-title">{candidate.title || "Possible match"}</div><div className="candidate-meta">{candidate.attribution || "Open-licensed photo"}</div></div>
          </button>)}
        </div> : <div className="empty">No credible matches were found in the current candidate pool. This does not mean the photo is absent from your whole library. Try another detail you remember.</div>}
        <div className="row" style={{ marginTop: 14 }}>
          {displayedCandidates.length > 0 && <button className="secondary" type="button" onClick={openRecovery}>None of these</button>}
          {noMatch && <button className="secondary" type="button" onClick={() => { setShowRecovery(true); document.getElementById("recovery-step")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Try another clue</button>}
        </div>
      </section>

      {selectedCandidate && <section className="card" id="candidate-confirmation" aria-live="polite">
        {confirmed ? <div className="success" role="status"><b>Retrieval confirmed.</b> You found the photo you were looking for.</div> : <>
          <div className="section-title"><h2>Is this the photo you were looking for?</h2><span className="pill">Confirm your match</span></div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", margin: "12px 0" }}>
            {selectedCandidate.image && <img src={selectedCandidate.image} alt={selectedCandidate.title || "Selected candidate photo"} style={{ width: 132, height: 92, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)" }} />}
            <div><strong>{selectedCandidate.title || "Selected photo"}</strong><p className="sub" style={{ marginBottom: 0 }}>Confirm only if this matches the photo you had in mind.</p></div>
          </div>
          <div className="row">
            <button className="primary" type="button" onClick={() => {
              setConfirmed(true);
              void track("retrieval_success", { candidateId: selectedCandidate.id, rank: displayedCandidates.findIndex((candidate) => candidate.id === selectedCandidate.id) + 1, metadata: { confirmedByUser: true } });
            }}>Yes, this is it</button>
            <button className="secondary" type="button" onClick={() => {
              setSelected(null);
              setConfirmed(false);
              requestAnimationFrame(() => document.getElementById("results-step")?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}>No, keep searching</button>
          </div>
        </>}
      </section>}

      {showRecovery && <section className="card" id="recovery-step">
        <div className="section-title"><h2>Let's recover the search</h2><span className="pill">One useful clue at a time</span></div>
        {result.recovery ? <>
          <p className="sub">{result.recovery.question}</p>
          <div className="chips">{result.recovery.options.map((option) => <button key={option} type="button" className="chip" disabled={localLoading} onClick={() => selectRecoveryOption(option)}>{option}</button>)}
            <button type="button" className="chip" disabled={localLoading} onClick={() => selectRecoveryOption("Not sure")}>Not sure</button>
          </div>
        </> : <p className="sub">I couldn't find a useful follow-up from the available photo metadata. Add one detail in your own words instead of guessing.</p>}
        {localLoading && <div className="banner" role="status" aria-live="polite" style={{ marginTop: 12 }}>Finding better matches using â€œ{activeClues[activeClues.length - 1]?.value ?? "your clue"}â€â€¦ Previously rejected photos will stay out of the results. This step runs locally and does not call Gemini again.</div>}
        {!localLoading && recoveryNotice && <div className="banner" role="status" aria-live="polite" style={{ marginTop: 12 }}>{recoveryNotice}</div>}
        <div style={{ marginTop: 14 }}>
          <label htmlFor="recovery-free-text" className="sub" style={{ display: "block", marginBottom: 6 }}>Or add a detail you remember</label>
          <div className="row">
            <input id="recovery-free-text" value={freeTextClue} onChange={(event: { target: { value: string } }) => setFreeTextClue(event.target.value)} maxLength={160} placeholder="e.g. a road sign, a blue building, a red jacket" style={{ flex: "1 1 320px", minWidth: 0, border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", background: "#fbfcfa" }} onKeyDown={(event: { key: string }) => { if (event.key === "Enter") submitFreeTextClue(); }} />
            <button className="primary" type="button" disabled={localLoading || !freeTextClue.trim()} onClick={submitFreeTextClue}>{localLoading ? "Refining..." : "Use this clue"}</button>
          </div>
        </div>
        <p className="sub">If the demo corpus has no photo whose metadata supports the clue, it will say so rather than treating a landscape or other unrelated photo as a match.</p>
      </section>}
    </>}

    <p className="footer">Public prototype using openly licensed demonstration photos. No Google Photos account is connected. A fresh search uses Gemini server-side. Recovery steps re-rank the first search's cached candidate pool locally, so they do not consume additional Gemini calls.</p>
  </main>;
}
