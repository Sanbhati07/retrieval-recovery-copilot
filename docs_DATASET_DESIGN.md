# Retrieval corpus design

Target: 1,000 real photographs.

The corpus is not a random 1,000-image sample. It is deliberately balanced around retrieval situations discovered in the public review research:

1. People/family
2. Animals/pets
3. Vehicles/transport
4. Food/birthday/social events
5. Travel/outdoors
6. Work/office
7. City/street scenes
8. Objects and everyday scenes
9. Text-in-image / screenshots where available
10. Hard distractor groups with overlapping concepts

We use multiple overlapping search families rather than a single query. Duplicates are removed by Openverse identifier and normalized source URL.

Each photo keeps upstream tags/title/creator plus our own benchmark labels. The benchmark labels are evaluation annotations and must be disclosed as such.

## Target composition
20 search families × ~50 unique photographs each = ~1,000 photographs, with redistribution after deduplication.

## Query families
motorcycle mountain, motorcycle road, car repair, dog walking, dog park, family gathering, birthday cake, wedding family, coffee laptop, office laptop, city street, beach trip, hiking river, backpack travel, snow mountain, restaurant dinner, flowers celebration, phone screenshot, work documents, everyday home scene.

## Hard distractors
For each benchmark task, target and distractors should share at least two coarse attributes (e.g. motorcycle + mountains) while differing on a useful recovery dimension (e.g. person, color, activity or scene subtype).
