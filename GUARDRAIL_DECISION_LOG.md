# Guardrail Decision Log — Retrieval Recovery Copilot

## 1. Narrow segmentation
Target: long-term users with large photo libraries retrieving one specific photo from an imperfect visual/contextual memory without exact metadata.

## 2. Impact mapping
Business metric → user job → observed failure → focused intervention → product outcome.

## 3. Metric/data orientation
Instrument retrieval start, memory submission, candidates shown, candidate click, recovery question, recovery option, none-of-these, success and failure.

## 4. Failure before solution
Failure states are explicit: zero-result, low-confidence, noisy results, candidate overload. The solution is designed around recovery from these states.

## 5. Creativity level 1
Every core feature must map to an observed failure point.

## 6. Creativity level 2
Natural-language photo search is not claimed as novel because Google Photos Ask Photos and competing photo apps already support conversational/semantic search.

## 7. Creativity level 3
Potential defensibility is framed as a future retrieval-recovery feedback dataset (memory type → failure → recovery action → outcome). The MVP does not claim an existing moat.

## 8. Research integrity
Public reviews are primary product-discovery evidence. Simulated interviews are labelled simulated. The photo corpus is real/openly licensed where source terms permit reuse. Benchmark labels/tasks are evaluation annotations, not original camera metadata.
