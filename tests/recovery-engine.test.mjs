import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchText,
  chooseRecoveryQuestion,
  diversifyCandidates,
  inferClueDimension,
  mergeRejectedIds,
  rankRecoveryCandidates,
} from '../lib/recovery-engine.ts';

function photo(id, title, tags, metadata = {}, score = 0.65) {
  return {
    id,
    title,
    image: `https://example.test/${id}.jpg`,
    tags,
    retrievalMetadata: metadata,
    semanticScore: score,
    structuredScore: score,
    finalScore: score,
    score,
  };
}

const mountainMemory = "I remember a bike trip photo in the mountains. I was wearing a black jacket and a friend was with me, but I don't remember the exact year.";

const mixedPool = [
  photo('road-1', 'Kennon Road motorcycle in Benguet section 55', ['motorcycle', 'mountain', 'road', 'rider'], { objects: ['motorcycle'], scenes: ['mountain road', 'mountain'], appearance: ['black jacket'] }, 0.91),
  photo('road-2', 'Kennon Road motorcycle in Benguet section 56', ['motorcycle', 'mountain', 'road', 'rider'], { objects: ['motorcycle'], scenes: ['mountain road', 'mountain'], appearance: ['black jacket'] }, 0.90),
  photo('building-1', 'Small stone building beside a road', ['building', 'stone', 'road'], { objects: ['building', 'stone wall'], scenes: ['roadside'] }, 0.76),
  photo('building-2', 'Wooden cabin near a mountain trail', ['cabin', 'building', 'forest'], { objects: ['building', 'cabin'], scenes: ['forest', 'trail'] }, 0.72),
  photo('forest-1', 'Forest trail with a hiker', ['forest', 'trail', 'hiker'], { scenes: ['forest', 'trail'], activities: ['hiking'], people: ['hiker'] }, 0.70),
  photo('sign-1', 'Red sign next to a mountain road', ['red sign', 'road sign', 'mountain road'], { objects: ['sign'], scenes: ['mountain road'], ocrText: ['road closed'] }, 0.68),
  photo('family-1', 'Family group outside an old house', ['family', 'group', 'house'], { objects: ['house'], people: ['family', 'group'] }, 0.60),
];

test('recovery options are drawn from candidate metadata and do not simply repeat known clues', () => {
  const question = chooseRecoveryQuestion(mixedPool, [], mountainMemory);
  assert.ok(question, 'candidate metadata should provide at least one useful distinction');
  const values = question.options.map((value) => value.toLowerCase());
  assert.ok(values.every((value) => !['a person', 'a vehicle', 'a building or place', 'a sign or text'].includes(value)));
  assert.ok(!values.includes('motorcycle'));
  assert.ok(!values.includes('mountain'));
  assert.ok(!values.includes('black jacket'));
  assert.ok(!values.includes('friend'));
});

test('a confirmed building clue ranks only candidates supported by building metadata', () => {
  const result = rankRecoveryCandidates(
    mixedPool,
    [],
    [{ dimension: 'objects', value: 'building', certainty: 1, explicit: true }],
    mountainMemory,
  );
  assert.equal(result.noMatch, false);
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every((candidate) => /building|cabin|house|stone wall/i.test([candidate.title, ...(candidate.tags ?? []), ...((candidate.retrievalMetadata?.objects ?? []))].join(' '))));
  assert.ok(!result.candidates.some((candidate) => candidate.id === 'road-1' || candidate.id === 'road-2'));
});

test('a clue can find a matching photo outside the first semantic top-80', () => {
  const semanticTop80 = Array.from({ length: 80 }, (_, index) =>
    photo(`landscape-${index}`, `Mountain road landscape ${index}`, ['mountain', 'road', 'landscape'], { scenes: ['mountain', 'road'] }, 0.8 - index * 0.001)
  );
  const matchingPhoto = photo('building-outside-top80', 'Stone building beside a road', ['building', 'stone', 'road'], { objects: ['building', 'stone wall'] }, 0.18);
  const result = rankRecoveryCandidates(
    [...semanticTop80, matchingPhoto],
    semanticTop80.slice(0, 12).map((candidate) => candidate.id),
    [{ dimension: 'objects', value: 'building', certainty: 1, explicit: true }],
    mountainMemory,
  );
  assert.equal(result.noMatch, false);
  assert.ok(result.candidates.some((candidate) => candidate.id === 'building-outside-top80'));
  assert.ok(result.candidates.every((candidate) => candidate.id === 'building-outside-top80'));
});

test('if the pool has no credible building match, recovery returns no-match instead of landscapes', () => {
  const landscapes = [
    photo('mountain-1', 'High mountain road', ['mountain', 'road'], { scenes: ['mountain', 'road'] }),
    photo('mountain-2', 'Mountain ridge and trail', ['mountain', 'trail'], { scenes: ['mountain', 'trail'] }),
  ];
  const result = rankRecoveryCandidates(landscapes, [], [{ dimension: 'objects', value: 'building', certainty: 1, explicit: true }], mountainMemory);
  assert.equal(result.noMatch, true);
  assert.deepEqual(result.candidates, []);
  assert.match(result.message, /No photo.*metadata supporting/i);
});

test('previously rejected candidates stay excluded across repeated recovery attempts', () => {
  const first = rankRecoveryCandidates(mixedPool, ['building-1'], [{ dimension: 'objects', value: 'building', certainty: 1, explicit: true }], mountainMemory);
  assert.ok(first.candidates.length > 0);
  assert.ok(!first.candidates.some((candidate) => candidate.id === 'building-1'));
  const rejectedAfterSecondNone = mergeRejectedIds(['building-1'], first.candidates.map((candidate) => candidate.id));
  const second = rankRecoveryCandidates(mixedPool, rejectedAfterSecondNone, [{ dimension: 'objects', value: 'building', certainty: 1, explicit: true }], mountainMemory);
  assert.equal(second.noMatch, true);
  assert.ok(second.candidates.every((candidate) => !rejectedAfterSecondNone.includes(candidate.id)));
});

test('a Not sure action does not become a confirmed clue', () => {
  const result = rankRecoveryCandidates(mixedPool, [], [{ dimension: 'objects', value: 'Not sure', certainty: 0, explicit: true }], mountainMemory);
  assert.equal(result.noMatch, false);
  assert.ok(result.candidates.length > 0);
});

test('near-duplicate road photos are reduced when distinct alternatives exist', () => {
  const candidates = [
    photo('r55', 'Kennon Road Tuba Benguet section 55', ['road', 'mountain', 'motorcycle'], {}, 0.99),
    photo('r56', 'Kennon Road Tuba Benguet section 56', ['road', 'mountain', 'motorcycle'], {}, 0.98),
    photo('r54', 'Kennon Road Tuba Benguet section 54', ['road', 'mountain', 'motorcycle'], {}, 0.97),
    photo('cabin', 'Wooden cabin in a forest', ['cabin', 'forest', 'building'], {}, 0.80),
  ];
  const result = diversifyCandidates(candidates, 3);
  assert.ok(result.length >= 2);
  assert.ok(result.some((candidate) => candidate.id === 'cabin'));
  assert.ok(result.filter((candidate) => candidate.id.startsWith('r')).length < 3);
});

test('the original memory is retained in the built search representation', () => {
  const query = buildSearchText(mountainMemory, [], [{ dimension: 'scenes', value: 'forest trail', certainty: 1, explicit: true }]);
  assert.ok(query.includes(mountainMemory));
  assert.ok(query.includes('forest trail'));
});

test('free-text visual clues infer a useful dimension and affect ranking', () => {
  const clue = 'a red road sign';
  const dimension = inferClueDimension(clue);
  assert.equal(dimension, 'ocrText');
  const result = rankRecoveryCandidates(mixedPool, [], [{ dimension, value: clue, certainty: 1, explicit: true }], mountainMemory);
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every((candidate) => candidate.id === 'sign-1'));
});

test('recovery scores remain within the 0-1 range', () => {
  const pool = [
    photo('building-1', 'Stone building near road', ['building', 'road'], { objects: ['building', 'stone wall'] }, 0.99),
    photo('building-2', 'Wooden cabin near trail', ['cabin', 'trail'], { objects: ['building', 'cabin'] }, 0.96),
  ];
  const result = rankRecoveryCandidates(pool, [], [{ dimension: 'objects', value: 'building', certainty: 1, explicit: true }], mountainMemory);
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every((candidate) => (candidate.finalScore ?? candidate.score) <= 1));
});
