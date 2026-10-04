# Retrieval Recovery Copilot — Public MVP v2.1

This version is the public/cloud architecture. The earlier synthetic illustration corpus is not used by the public product.

## Product thesis
Users with large, long-lived photo libraries sometimes remember the photo but not exact metadata. When initial retrieval is weak, the user is forced to diagnose and recover the search manually. Retrieval Recovery Copilot detects weak retrieval and recommends the next useful recovery action.

## Public architecture
Vercel (Next.js server) → Gemini memory parsing + multimodal embeddings → Supabase pgvector → candidate ranking → failure detector → recovery policy → Supabase telemetry.

## Corpus
The public corpus is built at deployment time from openly licensed photographs returned through Openverse. Source/creator/license/landing URL metadata is preserved for provenance and attribution. The project uses only CC BY, CC0, and Public Domain Mark records as discovery filters, followed by source-level spot checks before public launch.

## Guardrails
- Narrow target: large, long-lived libraries + one vaguely remembered specific photo.
- No natural-language-search novelty claim: Google Photos already has Ask Photos.
- Failure points are defined before solution: zero, low-confidence, noisy, overload.
- Every core interaction is instrumented.
- The MVP uses real openly licensed photos but synthetic/benchmark task prompts; neither should be presented as real user-photo data or real user interviews.
- Any defensibility statement is a hypothesis, not a claimed moat.

## Important security rule
Never commit `GEMINI_API_KEY` or the Supabase secret key. GitHub Actions repository secrets and Vercel server-side environment variables are used for credentials.
