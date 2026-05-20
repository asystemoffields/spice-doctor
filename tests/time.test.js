import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageGaps, validateWindow } from '../src/core/time.js';

test('finds no gaps when adjacent coverage spans the request', () => {
  const gaps = coverageGaps(
    { start: '2026-04-15T00:00:00Z', stop: '2026-04-17T00:00:00Z' },
    [
      { start: '2026-01-01T00:00:00Z', stop: '2026-04-16T00:00:00Z' },
      { start: '2026-04-16T00:00:00Z', stop: '2028-01-01T00:00:00Z' },
    ],
  );
  assert.deepEqual(gaps, []);
});

test('keeps gaps explicit', () => {
  const gaps = coverageGaps(
    { start: '2026-01-01T00:00:00Z', stop: '2026-01-05T00:00:00Z' },
    [{ start: '2026-01-02T00:00:00Z', stop: '2026-01-03T00:00:00Z' }],
  );
  assert.deepEqual(gaps, [
    { start: '2026-01-01T00:00:00Z', stop: '2026-01-02T00:00:00Z' },
    { start: '2026-01-03T00:00:00Z', stop: '2026-01-05T00:00:00Z' },
  ]);
});

test('rejects inverted windows', () => {
  assert.throws(() => validateWindow({ start: '2026-01-02T00:00:00Z', stop: '2026-01-01T00:00:00Z' }));
});
