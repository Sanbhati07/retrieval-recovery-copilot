# Retrieval Recovery Copilot — Public MVP v1

## Purpose

A focused, public graduation-project MVP for a narrow retrieval job: long-term photo-library users trying to find one specific photo from an imperfect visual/contextual memory when exact metadata is unavailable.

### Product thesis

> When photo retrieval fails, the user should not have to diagnose the search and invent the next query alone.

The MVP flow is:

`memory -> initial retrieval -> failure diagnosis -> one high-value recovery clue -> re-rank -> confirmation`

This is **not** a Google Photos clone and is not positioned as a generic AI photo-search product.

## Public architecture

**GitHub -> Vercel -> Supabase -> Gemini API**

- Next.js frontend and server routes on Vercel
- Gemini 3.6 Flash for structured memory extraction
- `gemini-embedding-2` at 768 dimensions for text/image cross-modal retrieval
- Supabase + pgvector for photo embeddings
- Supabase event table for anonymous retrieval telemetry
- 1,000 synthetic photos packaged as static assets

Google's current docs list `gemini-embedding-2` as the multimodal embedding model, support text/image cross-modal retrieval, recommend 768/1536/3072 dimensions, and document up to six images per request. See the official Gemini docs for current limits and pricing before launch.

## Cloud-only setup (no local AI pipeline)

1. Push the repository to a public GitHub repository.
2. Create a **separate Supabase project** for this graduation MVP; do not reuse a production product database.
3. Run `supabase/schema.sql` in Supabase SQL Editor.
4. Import the GitHub repository into Vercel.
5. Add the following Vercel Environment Variables as **Secret** values for Production:
   - `GEMINI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `MVP_ADMIN_SECRET`
6. Deploy.
7. Open `/admin/embed` and enter `MVP_ADMIN_SECRET` to start/resume cloud-side image indexing. Batches are six images per request and the progress is resumable.
8. Once embeddings exist, `/demo` uses semantic retrieval automatically.
9. `/test` supports Control (single-pass) vs Treatment (recovery copilot) using hidden ground-truth tasks.

## Secrets

Never use `NEXT_PUBLIC_` for API keys or Supabase service-role keys. Vercel documents that `NEXT_PUBLIC_*` variables are inlined into client JavaScript and are visible in the browser; keep Gemini and service credentials server-side.

## Guardrails — hard constraints

### 1. Narrow segmentation
Target is intentionally narrow: large/long-lived photo libraries + one specific photo + imperfect contextual/visual memory + missing exact metadata.

### 2. Impact mapping
Business metric -> user job -> observed failure -> recovery intervention -> successful retrieval.

### 3. Metric/data orientation
Events include retrieval start, memory submission, candidate impressions, candidate clicks, recovery question/option, `none_of_these`, success/failure.

### 4. Failure-first design
The product detects zero-result, low-confidence, noisy, or candidate-overload states before triggering recovery.

### 5. Creativity level 1 — problem fit
Every feature is tied to retrieval failure/recovery.

### 6. Creativity level 2 — differentiation
Natural-language search is not claimed as novel. Google Photos already supports Ask Photos/conversational retrieval. Our proposed differentiator is failure-aware recovery orchestration after weak retrieval.

### 7. Creativity level 3 — potential competitive advantage
Potential defensibility is framed as a future retrieval-feedback dataset/policy advantage, not an existing moat.

### 8. Research integrity
Public review evidence is real. The photo corpus is synthetic. Simulated interviews are to be labelled simulated. Synthetic benchmark results are engineering diagnostics, not real Google Photos performance.

## Product metrics

Primary:

**Successful Retrieval Rate = confirmed intended-photo sessions / retrieval sessions**

Supporting:
- Recall@5
- Recall@10
- Candidate CTR
- Recovery question CTR
- Time to retrieval
- Recovery success rate
- Manual escape rate
- Zero-result / low-confidence rate

CTR is not the definition of success. A click on a wrong candidate is not a successful retrieval.

## Benchmark integrity

The benchmark target photo is stored server-side for `/test`. The browser receives only the task memory; it does not receive the target ID. This allows `retrieval_success` to be checked against hidden ground truth.

Do not tune thresholds on the same benchmark after observing live results. Maintain a frozen validation set and report any threshold changes separately.

## Privacy / public safety

- Synthetic photos only.
- No Google Photos OAuth.
- No personal photo uploads.
- API keys are server-only.
- Anonymous session IDs are used only for event grouping.
- Retrieval is soft-limited to 20 attempts/session/hour.
- Admin embedding ingestion is secret-protected.

## Known limitation

The semantic retrieval benchmark must be run after the cloud image index is populated. Before that, the app can use a controlled fallback for smoke testing, but fallback performance must never be reported as Gemini performance.

## Official references

- Gemini embeddings: https://ai.google.dev/gemini-api/docs/embeddings
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini structured output: https://ai.google.dev/gemini-api/docs/generate-content/structured-output
- Vercel environment/security: https://vercel.com/academy/nextjs-foundations/env-and-security
- Supabase vectors: https://supabase.com/docs/guides/ai/vector-columns
