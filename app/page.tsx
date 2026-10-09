import Link from "next/link";

export default function Home() {
  return (
    <main className="wrap">
      <div className="top">
        <div>
          <div className="eyebrow">Graduation MVP Â· Google Photos core experience</div>
          <h1>I remember the photo. I just don't remember enough to search for it.</h1>
          <p className="lead">
            Retrieval Recovery Copilot is a focused prototype for the moment after a photo search fails: it diagnoses a weak result set and guides the user toward the next most useful clue instead of forcing them to guess another query or manually browse years of photos.
          </p>
          <div className="row" style={{marginTop:18}}>
            <Link className="primary" href="/demo" style={{textDecoration:"none"}}>Try the retrieval experience</Link><Link className="secondary" href="/test" style={{textDecoration:"none"}}>Compare retrieval modes</Link>
            <span className="pill">Synthetic 1,000-photo library</span>
            <span className="pill">AI mode + controlled fallback</span>
          </div>
        </div>
      </div>
      <div className="grid">
        <section className="card">
          <div className="section-title"><h2>What is different?</h2></div>
          <p className="sub">This is not another natural-language search box. The prototype is designed around retrieval failure: zero/weak/noisy/overloaded results trigger a recovery step.</p>
          <div className="banner"><b>Core loop</b><br/>Memory â†’ initial retrieval â†’ detect failure â†’ recommend one recovery clue â†’ re-rank â†’ confirm.</div>
        </section>
        <section className="card">
          <div className="section-title"><h2>How we measure it</h2></div>
          <div className="statgrid">
            <div className="stat"><b>Recall@5</b><span>Was the intended photo in the first five?</span></div>
            <div className="stat"><b>CTR</b><span>Did candidates get clicked?</span></div>
            <div className="stat"><b>Time</b><span>How long to confirmation?</span></div>
            <div className="stat"><b>Success</b><span>Did the user confirm the intended photo?</span></div>
          </div>
        </section>
      </div>
      <p className="footer">Prototype note: the photo corpus is synthetic so no personal photo library is uploaded. AI API secrets are server-side only.</p>
    </main>
  );
}
