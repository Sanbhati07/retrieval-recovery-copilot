"use client";

import { useMemo, useState } from "react";

type Candidate = { id:string; image:string; title:string|null; creator:string|null; attribution:string|null; license:string; licenseUrl:string; tags:string[]; score:number };
type RetrievalResponse = { mode:string; memory:{memorySummary:string;clues:any[];unknownDimensions:string[]}; candidates:Candidate[]; failure:{type:string;reason:string}; recovery:null|{dimension:string;question:string;options:string[]}; error?:string };

function getSession(){
  const k="rr_session"; let v=localStorage.getItem(k); if(!v){v=crypto.randomUUID();localStorage.setItem(k,v)} return v;
}
async function track(event:string, extra:any={}){ try{await fetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({event,sessionId:getSession(),...extra})})}catch{} }

const sampleMemories = [
  {
    label: "Car repair",
    memory: "I remember a photo of a car in a garage, maybe while it was being repaired, but I don't remember the year.",
  },
  {
    label: "Mountain trip",
    memory: "I remember a mountain trip photo. I was wearing a black jacket and a friend was with me, but I don't remember the year.",
  },
  {
    label: "Family photo",
    memory: "I remember a family photo with my parents, but I don't remember the occasion or the date.",
  },
  {
    label: "Cafe trip",
    memory: "I remember a photo outside a small cafe during a trip, but I don't remember the city.",
  },
  {
    label: "Bike trip",
    memory: "I remember my bike parked near a scenic road and a friend was in the frame.",
  },
  {
    label: "Room before renovation",
    memory: "I remember a photo of a room before renovation, but I don't remember the date.",
  },
];
const FALLBACK_RECOVERY = {
  dimension: "objects",
  question: "Do you remember another object or visual detail in the photo?",
  options: [
    "A person",
    "A vehicle",
    "A building or place",
    "A sign or text",
    "Not sure",
  ],
};
export default function Demo(){
  const [memory,setMemory]=useState("I remember a bike trip photo in the mountains. I was wearing a black jacket and a friend was with me, but I don't remember the exact year.");
  const [activeClues,setActiveClues]=useState<any[]>([]);
  const [result,setResult]=useState<RetrievalResponse|null>(null);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [showRecovery,setShowRecovery]=useState(false);
  const [error,setError]=useState<string>("");

  const run=async(nextClues:any[]=activeClues, fresh=false)=>{
    setLoading(true);setError("");setSelected(null);setShowRecovery(false);
    if(fresh) await track("retrieval_started");
    await track("memory_submitted",{metadata:{length:memory.length}});
    try{
      const r=await fetch("/api/retrieve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({memory,activeClues:nextClues,sessionId:getSession()})});
      const data=await r.json();
      if(!r.ok) throw new Error(data.error||"Retrieval failed");
      setResult(data);setShowRecovery(data.failure?.type !== "strong");await track("candidates_shown",{metadata:{count:data.candidates?.length||0,failure:data.failure?.type,mode:data.mode}});
      if(data.recovery)await track("recovery_question_shown",{dimension:data.recovery.dimension});
    }catch(e){setError(e instanceof Error?e.message:"Unexpected error");}
    finally{setLoading(false)}
  };


  const clueText=useMemo(()=>result?.memory.clues?.filter((x:any)=>x.explicit).slice(0,6)||[],[result]);
  const recoveryStep = result && showRecovery ? (result.recovery ?? FALLBACK_RECOVERY) : null;

  return <main className="wrap">
    <div className="row" style={{justifyContent:"space-between"}}><div className="eyebrow">Retrieval Recovery Copilot</div><a href="/" className="pill">About this prototype</a></div>
    <div className="card">
      <div className="section-title"><h2>Describe the photo you remember</h2><span className="pill">No exact date required</span></div>
      <textarea className="input" value={memory} onChange={e=>setMemory(e.target.value)} placeholder="Example: I remember a photo from a trip..." />
      <div className="row" style={{marginTop:12}}><button className="primary" disabled={loading} onClick={()=>{setActiveClues([]);run([],true)}}>{loading?"Finding...":"Find my photo"}</button></div>
    </div>      <div className="card" style={{marginTop:14}}>
        <div className="section-title">
          <h2>Not sure what to search? Try a sample memory</h2>
          <span className="pill">Starting points</span>
        </div>

        <p className="sub" style={{marginTop:-4}}>
          Pick a full example below to see the kind of memory you can give the system. Clicking one fills the box; then press Find my photo.
        </p>

        <div className="chips">
          {sampleMemories.map((sample) => (
            <button
              key={sample.label}
              type="button"
              className="chip"
              style={{textAlign:"left",height:"auto",minHeight:72,whiteSpace:"normal",display:"block",padding:"12px 14px"}}
              disabled={loading}
              onClick={() => {
                setMemory(sample.memory);
                setActiveClues([]);
                setResult(null);
                setSelected(null);
                setShowRecovery(false);
                setError("");
              }}
              title={sample.memory}
            >
              <strong>{sample.label}</strong><br /><span style={{fontSize:13,lineHeight:1.35}}>{sample.memory}</span>
            </button>
          ))}
        </div>

        <p className="sub" style={{marginBottom:0}}>
          You can also write your own memory Ã¢â‚¬â€ the goal is to describe what you remember, not to guess the exact search words.
        </p>
      </div>

    {error && <div className="card"><div className="banner warn"><b>Something went wrong</b><br/>{error}<div className="sub" style={{marginTop:6}}>Check the server-side Gemini and Supabase configuration.</div></div></div>}

    {result && <>
      <div className="card">
        <div className="section-title"><h2>What I understood</h2><span className="pill">{result.mode === "semantic" ? "AI semantic retrieval" : "Controlled fallback"}</span></div>
        <p className="sub">{result.memory.memorySummary}</p>
        <div className="chips">{clueText.map((c:any)=><span className="chip" key={c.dimension+"-"+c.value}>{c.value}</span>)}</div>
      </div>

      <div className="card">
        <div className="section-title"><h2>{result.failure.type === "strong" ? "Strong match" : "Let's narrow this down"}</h2><span className="pill">{result.failure.type === "strong" ? "Good match" : "Several possibilities"}</span></div>
        <div className={result.failure.type === "strong" ? "banner" : "banner warn"}>{result.failure.type === "candidate_overload" ? "Several photos could match what you described." : result.failure.reason}</div>
        <div className="candidates">
          {result.candidates.map((c,i)=><button key={c.id} className="candidate" onClick={()=>{setSelected(c.id);track("candidate_clicked",{candidateId:c.id,rank:i+1,metadata:{score:c.score}})}}>
            <img src={c.image} alt="Candidate photo" /><div className="candidate-body"><span className="score">#{i+1}</span><div className="candidate-title">{c.title || "Possible match"}</div><div className="candidate-meta">{c.attribution || "Open-licensed photo"}</div></div>
          </button>)}
        </div>
        <div className="row" style={{marginTop:14}}>
          <button className="secondary" onClick={()=>{setSelected(null);track("none_of_these");document.getElementById("recovery-step")?.scrollIntoView({behavior:"smooth",block:"center"});}}>None of these</button>
        </div>
      </div>

      {recoveryStep && <div id="recovery-step" className="card">
        <div className="section-title"><h2>Let's recover the search</h2><span className="pill">One high-value clue</span></div>
        <p className="sub">{recoveryStep!.question}</p>
        <div className="chips">{recoveryStep!.options.map((o)=><button key={o} className="chip" onClick={()=>{
          const next=[...activeClues,{dimension:recoveryStep!.dimension,value:o,certainty:o==="Not sure"?0:1,explicit:true}];
          setActiveClues(next);track("recovery_option_selected",{dimension:recoveryStep!.dimension,option:o});run(next,false);
        }}>{o}</button>)}</div>
      </div>}

      {selected && <div className="card"><div className="success"><b>Candidate selected.</b> For user testing, the benchmark task determines whether the selection is the intended photo; a click alone is not counted as retrieval success.</div></div>}
    </>}
    <p className="footer">Public prototype using openly licensed demonstration photos. No Google Photos account is connected. Your description is processed server-side with Gemini.</p>
  </main>
}
