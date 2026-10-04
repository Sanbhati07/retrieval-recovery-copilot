# Public deployment checklist

## 1. GitHub
Create a public repository, for example `retrieval-recovery-copilot`, and push this project as-is.

## 2. Supabase
Create a new project dedicated to this prototype. Run `supabase/schema.sql` in SQL Editor. Confirm `photo_embeddings` and `retrieval_events` exist.

## 3. Vercel
Import the GitHub repository. Add Production secrets:

`GEMINI_API_KEY`
`SUPABASE_URL`
`SUPABASE_SERVICE_ROLE_KEY`
`MVP_ADMIN_SECRET`

Redeploy after saving environment variables.

## 4. Index the 1,000 photos
Open:

`https://<vercel-domain>/admin/embed`

Enter `MVP_ADMIN_SECRET`, check status, then start/resume indexing. The endpoint embeds up to six image inputs per Gemini Embedding 2 call and writes vectors to Supabase.

## 5. Smoke test
Open `/demo` and try:

> I remember a bike trip photo in the mountains. I was wearing a black jacket and my friend was with me, but I don't remember the exact year.

Confirm that:
- Gemini extracts explicit and uncertain clues.
- Semantic mode appears after the vector table is populated.
- Weak retrieval creates a recovery prompt.
- Choosing a recovery option re-runs retrieval.
- `None of these` is available.

## 6. Controlled evaluation
Open `/test`.

Run both:
- Control: single-pass retrieval
- Treatment: recovery copilot

Use the same general task pool with randomized task order during testing. Record successful retrieval, time-to-retrieval, candidate clicks, recovery steps, and manual escapes.
