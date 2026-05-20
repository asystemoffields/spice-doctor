import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../src/core/catalog.js';
import { buildManifestReport, buildQuestionReport } from '../src/core/report.js';

test('ships named scenarios', () => {
  const ids = SCENARIOS.map((s) => s.id);
  assert.ok(ids.includes('juno-jupiter'));
  assert.ok(ids.includes('cassini-enceladus-2012'));
});

test('resolves a ready Juno manifest for reconstructed coverage', () => {
  const report = buildManifestReport({
    scenarioId: 'juno-jupiter',
    window: { start: '2026-03-10T00:00:00Z', stop: '2026-03-11T00:00:00Z' },
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.kernels.some((k) => k.id === 'juno-spk-rec-orbit'), true);
  assert.equal(report.kernels.some((k) => k.id === 'juno-ik-junocam-v03'), true);
  assert.match(report.metaKernel, /juno\/spk\/juno_rec_orbit\.bsp/);
  assert.match(report.spiceypyRecipe, /spice\.spkezr/);
  assert.match(report.spiceypyRecipe, /spice\.getfov/);
});

test('keeps optional instrument kernels out of state-vector-only reports', () => {
  const report = buildManifestReport({
    scenarioId: 'juno-jupiter',
    window: { start: '2026-03-10T00:00:00Z', stop: '2026-03-11T00:00:00Z' },
    calculations: ['state-vector'],
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.kernels.some((k) => k.type === 'IK'), false);
  assert.equal(report.kernels.some((k) => k.type === 'FK'), false);
});

test('answers a custom Juno geometry question', () => {
  const report = buildQuestionReport({
    observer: 'JUNO',
    target: 'JUPITER',
    center: 'JUPITER',
    instrument: 'JUNO_JUNOCAM_RED',
    window: { start: '2026-03-10T00:00:00Z', stop: '2026-03-11T00:00:00Z' },
    calculations: ['state-vector', 'phase-angle', 'instrument-fov'],
  });

  assert.equal(report.status, 'ready');
  assert.match(report.answer, /^Ready:/);
  assert.ok(report.kernels.map((k) => k.id).includes('juno-spk-rec-orbit'));
  assert.ok(report.kernels.map((k) => k.id).includes('juno-ik-junocam-v03'));
  assert.ok(report.handoff.files.some((file) => file.name === 'scenario.tm'));
  assert.ok(report.handoff.files.some((file) => file.name === 'run_geometry.py'));
  assert.equal(report.handoff.checklist.selected.some((item) => item.url.includes('/JUNO/kernels/spk/')), true);
  assert.equal(report.handoff.timeline.rows.some((row) => row.role === 'spacecraft-trajectory' && row.covered), true);
});

test('answers a generic Earth Moon question without spacecraft kernels', () => {
  const report = buildQuestionReport({
    observer: 'EARTH',
    target: 'MOON',
    center: 'EARTH',
    window: { start: '2026-05-20T00:00:00Z', stop: '2026-05-21T00:00:00Z' },
    calculations: ['state-vector', 'phase-angle'],
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.kernels.some((k) => k.role === 'spacecraft-trajectory'), false);
});

test('blocks custom questions for bodies absent from selected kernels', () => {
  const report = buildQuestionReport({
    observer: 'EARTH',
    target: 'CERES',
    center: 'SUN',
    window: { start: '2026-05-20T00:00:00Z', stop: '2026-05-21T00:00:00Z' },
    calculations: ['state-vector'],
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.issues.some((i) => i.code === 'BODY_NOT_IN_SELECTED_KERNELS' && i.message.includes('CERES')), true);
});

test('combines Juno reconstructed and predicted trajectory kernels across the handoff', () => {
  const report = buildManifestReport({
    scenarioId: 'juno-jupiter',
    window: { start: '2026-04-15T00:00:00Z', stop: '2026-04-17T00:00:00Z' },
  });

  assert.equal(report.status, 'ready');
  assert.ok(report.kernels.map((k) => k.id).includes('juno-spk-rec-orbit'));
  assert.ok(report.kernels.map((k) => k.id).includes('juno-spk-pred-orbit'));
});

test('resolves a ready MRO manifest on the merged current arc', () => {
  const report = buildManifestReport({
    scenarioId: 'mro-mars',
    window: { start: '2026-05-18T00:00:00Z', stop: '2026-05-19T00:00:00Z' },
  });

  assert.equal(report.status, 'ready');
  assert.ok(report.kernels.map((k) => k.id).includes('mro-spk-psp'));
  assert.ok(report.kernels.map((k) => k.id).includes('mro-ik-hirise-v12'));
});

test('blocks MRO requests after the current merged orbit coverage', () => {
  const report = buildManifestReport({
    scenarioId: 'mro-mars',
    window: { start: '2026-06-16T00:00:00Z', stop: '2026-06-17T00:00:00Z' },
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.issues.some((i) => i.role === 'spacecraft-trajectory' && i.code === 'COVERAGE_GAP'), true);
  assert.equal(report.handoff.suggestions.some((s) => s.action === 'use-window' && s.window.stop.startsWith('2026-06-15')), true);
});

test('resolves the archival Cassini Enceladus sample window', () => {
  const report = buildManifestReport({
    scenarioId: 'cassini-enceladus-2012',
    window: { start: '2012-10-19T08:00:00Z', stop: '2012-10-19T10:00:00Z' },
  });

  assert.equal(report.status, 'ready');
  assert.ok(report.kernels.map((k) => k.id).includes('cassini-spk-2012-enceladus'));
});

test('blocks Juno requests after the current predicted orbit coverage', () => {
  const report = buildManifestReport({
    scenarioId: 'juno-jupiter',
    window: { start: '2026-07-01T00:00:00Z', stop: '2026-07-02T00:00:00Z' },
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.issues.some((i) => i.role === 'spacecraft-trajectory' && i.code === 'COVERAGE_GAP'), true);
});

test('reports coverage gaps for requests outside the mission catalog', () => {
  const report = buildManifestReport({
    scenarioId: 'cassini-enceladus-2012',
    window: { start: '2014-01-01T00:00:00Z', stop: '2014-01-02T00:00:00Z' },
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.issues.some((i) => i.code === 'COVERAGE_GAP'), true);
});
