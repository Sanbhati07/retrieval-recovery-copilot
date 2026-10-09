import Link from "next/link";

export default function Home() {
  return (
    <main className="wrap">
      <div className="top">
        <div>
          <div className="eyebrow">Graduation MVP - Google Photos core experience</div>
          <h1>I remember the photo. I just don't remember enough to search for it.</h1>
          <p className="lead">
            Retrieval Recovery Copilot helps when a photo search does not find the right picture. Instead of making you guess another query or browse through years of photos, it asks for one useful extra clue and uses it to refine the results.
          </p>
          <div className="row" style={{ marginTop: 18 }}>
            <Link className="primary" href="/demo" style={{ textDecoration: "none" }}>
              Try the retrieval experience
            </Link>
            <span className="pill">1,000 openly licensed demo photos</span>
            <span className="pill">Guided recovery after a weak search</span>
          </div>
        </div>
      </div>

      <div className="grid">
        <section className="card">
          <div className="section-title">
            <h2>What is different?</h2>
          </div>
          <p className="sub">
            This is not just another search box. When the first set of results is empty, incomplete or too similar, the prototype helps the user decide what detail to add next.
          </p>
          <div className="banner">
            <b>How it works</b>
            <br />
            Describe the photo. Review possible matches. If none looks right, add one useful clue. The search then uses that clue to refine the results so you can confirm the right photo.
          </div>
        </section>

        <section className="card">
          <div className="section-title">
            <h2>How we measure it</h2>
          </div>
          <div className="statgrid">
            <div className="stat">
              <b>Recall@5</b>
              <span>Was the intended photo among the first five results?</span>
            </div>
            <div className="stat">
              <b>Photo CTR</b>
              <span>How often do people open a candidate photo?</span>
            </div>
            <div className="stat">
              <b>Time</b>
              <span>How long does it take to confirm the right photo?</span>
            </div>
            <div className="stat">
              <b>Successful retrieval</b>
              <span>Did the user confirm the photo they had in mind?</span>
            </div>
          </div>
        </section>
      </div>

      <p className="footer">
        Public prototype using openly licensed demonstration photos. No personal Google Photos account is connected. AI API secrets remain server-side.
      </p>
    </main>
  );
}
