# Deployment order

1. Run `supabase/schema_v3_public_mvp.sql` in Supabase SQL Editor. It is idempotent for the tables/columns and replaces the existing retrieval RPC with the public-MVP return shape.
2. Verify `photo_catalog`, `photo_embeddings`, `retrieval_events`, and `benchmark_tasks` exist; verify client roles have no direct table/function access.
3. Create the GitHub repository and push this code. Do not commit `.env` or secrets.
4. Add GitHub Actions repository secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`.
5. Run the "Build real photo corpus" workflow with target 1000.
6. Verify `photo_catalog` count and Storage object count. Spot-check provenance/license URLs before public launch.
7. Run the "Embed real photo corpus" workflow.
8. Verify the ready counts match: `photo_catalog.embedding_status='ready'` equals `photo_embeddings` count.
9. Seed/freeze benchmark tasks only after the real corpus is stable. Benchmark tasks must point to real target photo IDs and remain server-side in test mode.
10. Deploy Vercel and configure server-only environment variables.
11. Run control vs treatment benchmark and then the 3+ user tests.
