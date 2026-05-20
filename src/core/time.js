export function parseIso(value) {
  const normalized = value.trim().replace(/\s+UTC$/i, 'Z');
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  const t = date.getTime();
  if (Number.isNaN(t)) {
    throw new Error(`Invalid ISO time: ${value}`);
  }
  return t;
}

export function normalizeIso(value) {
  return new Date(parseIso(value)).toISOString().replace('.000Z', 'Z');
}

export function compareIso(a, b) {
  return parseIso(a) - parseIso(b);
}

export function validateWindow(window) {
  const start = normalizeIso(window.start);
  const stop = normalizeIso(window.stop);
  if (parseIso(start) >= parseIso(stop)) {
    throw new Error(`Time window start must be before stop: ${start} >= ${stop}`);
  }
  return { start, stop };
}

export function overlap(a, b) {
  const start = Math.max(parseIso(a.start), parseIso(b.start));
  const stop = Math.min(parseIso(a.stop), parseIso(b.stop));
  if (start >= stop) return null;
  return { start: toIso(start), stop: toIso(stop) };
}

export function coverageGaps(request, coverages) {
  const sorted = coverages
    .map((c) => overlap(request, c))
    .filter((c) => c !== null)
    .sort((a, b) => compareIso(a.start, b.start));

  const gaps = [];
  let cursor = parseIso(request.start);

  for (const span of sorted) {
    const spanStart = parseIso(span.start);
    const spanStop = parseIso(span.stop);
    if (spanStart > cursor) {
      gaps.push({ start: toIso(cursor), stop: toIso(spanStart) });
    }
    cursor = Math.max(cursor, spanStop);
  }

  const requestStop = parseIso(request.stop);
  if (cursor < requestStop) {
    gaps.push({ start: toIso(cursor), stop: toIso(requestStop) });
  }
  return gaps;
}

export function formatCompact(window) {
  return `${normalizeIso(window.start)} to ${normalizeIso(window.stop)}`;
}

function toIso(ms) {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}
