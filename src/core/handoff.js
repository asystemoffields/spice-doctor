import { generateDownloadList } from './manifest.js';
import { formatCompact, overlap, parseIso } from './time.js';

const DEFAULT_FILES = {
  metaKernel: 'scenario.tm',
  recipe: 'run_geometry.py',
  downloads: 'kernel-downloads.txt',
  checklist: 'kernel-checklist.md',
  readme: 'README.md',
  report: 'report.json',
};

export function buildHandoffBundle(report) {
  const checklist = buildKernelChecklist(report);
  const timeline = buildCoverageTimeline(report);
  const suggestions = buildFixSuggestions(report);
  const files = buildHandoffFiles(report, checklist, timeline, suggestions);

  return {
    checklist,
    timeline,
    suggestions,
    files,
  };
}

export function buildKernelChecklist(report) {
  const selected = report.kernels.map((kernel) => ({
    role: kernel.role,
    type: kernel.type,
    name: kernel.name,
    localPath: kernel.localPath,
    url: kernel.url,
    source: kernel.source,
    coverage: kernel.coverage,
    sizeMb: kernel.sizeMb,
    notes: kernel.notes,
    selected: true,
  }));

  const missing = report.issues
    .filter((issue) => issue.severity === 'error' || issue.severity === 'warning')
    .map((issue) => ({
      role: issue.role ?? 'catalog',
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      fix: issue.fix,
      directories: issue.directories ?? [],
    }));

  return { selected, missing };
}

export function buildCoverageTimeline(report) {
  const request = report.request.window;
  return {
    request,
    rows: report.selections.map((selection) => ({
      role: selection.role,
      required: selection.required,
      covered: selection.covered,
      message: selection.message,
      spans: selection.kernels
        .map((kernel) => {
          const clipped = kernel.coverage ? overlap(request, kernel.coverage) : request;
          return {
            kernelId: kernel.id,
            label: kernel.name,
            coverage: kernel.coverage,
            clipped,
            position: clipped ? spanPosition(request, clipped) : null,
            configuration: !kernel.coverage,
          };
        }),
      gaps: selection.gaps.map((gap) => ({
        ...gap,
        position: spanPosition(request, gap),
      })),
    })),
  };
}

export function buildFixSuggestions(report) {
  if (report.status === 'ready') {
    return [
      {
        title: 'Run this handoff',
        detail: `Download ${DEFAULT_FILES.metaKernel}, ${DEFAULT_FILES.recipe}, and the kernel checklist, then place kernels under ./kernels using the listed local paths.`,
        action: 'download-handoff',
      },
    ];
  }

  const suggestions = [];
  for (const issue of report.issues) {
    const selection = report.selections.find((item) => item.role === issue.role);
    const coveredWindow = selection ? nearestCoveredWindow(report.request.window, selection.kernels) : null;

    if (coveredWindow) {
      suggestions.push({
        title: `Try the nearest covered ${labelRole(issue.role)} window`,
        detail: `${coveredWindow.kernel.name} supports ${formatCompact(coveredWindow.window)}.`,
        action: 'use-window',
        role: issue.role,
        window: coveredWindow.window,
      });
    }

    if (issue.fix) {
      const directories = issue.directories?.length ? ` Candidate directories: ${issue.directories.join(', ')}.` : '';
      suggestions.push({
        title: `Resolve ${labelRole(issue.role)}`,
        detail: `${issue.fix}${directories}`,
        action: 'inspect-catalog',
        role: issue.role,
      });
    }
  }

  return uniqueSuggestions(suggestions).slice(0, 5);
}

function buildHandoffFiles(report, checklist, timeline, suggestions) {
  const reportJson = JSON.stringify(
    {
      scenario: report.scenario,
      request: report.request,
      status: report.status,
      answer: report.answer,
      issues: report.issues,
      kernels: report.kernels,
      selections: report.selections,
      handoff: { checklist, timeline, suggestions },
    },
    null,
    2,
  );

  return [
    {
      name: DEFAULT_FILES.metaKernel,
      type: 'text/plain',
      label: 'Meta-kernel',
      contents: report.metaKernel,
    },
    {
      name: DEFAULT_FILES.recipe,
      type: 'text/x-python',
      label: 'SpiceyPy script',
      contents: report.spiceypyRecipe,
    },
    {
      name: DEFAULT_FILES.downloads,
      type: 'text/plain',
      label: 'Download list',
      contents: generateDownloadList(report.kernels),
    },
    {
      name: DEFAULT_FILES.checklist,
      type: 'text/markdown',
      label: 'Kernel checklist',
      contents: renderChecklistMarkdown(report, checklist),
    },
    {
      name: DEFAULT_FILES.readme,
      type: 'text/markdown',
      label: 'Bundle README',
      contents: renderBundleReadme(report),
    },
    {
      name: DEFAULT_FILES.report,
      type: 'application/json',
      label: 'Report JSON',
      contents: reportJson,
    },
  ];
}

function renderChecklistMarkdown(report, checklist) {
  const lines = [
    `# Kernel checklist for ${report.scenario.name}`,
    '',
    `Question: ${report.scenario.observer} to ${report.scenario.target}`,
    `Window: ${formatCompact(report.request.window)}`,
    `Status: ${report.status}`,
    '',
    '## Selected kernels',
    '',
  ];

  for (const kernel of checklist.selected) {
    lines.push(
      `- [ ] ${kernel.type} ${kernel.localPath}`,
      `  - Role: ${kernel.role}`,
      `  - URL: ${kernel.url}`,
      `  - Source: ${kernel.source}`,
      `  - Coverage: ${kernel.coverage ? formatCompact(kernel.coverage) : 'configuration kernel'}`,
    );
    if (kernel.sizeMb) lines.push(`  - Size: ${kernel.sizeMb} MB`);
    if (kernel.notes) lines.push(`  - Notes: ${kernel.notes}`);
  }

  if (checklist.missing.length > 0) {
    lines.push('', '## Missing or partial pieces', '');
    for (const item of checklist.missing) {
      lines.push(
        `- ${item.severity.toUpperCase()} ${item.code} (${item.role})`,
        `  - ${item.message}`,
      );
      if (item.fix) lines.push(`  - Next step: ${item.fix}`);
      if (item.directories?.length) lines.push(`  - Candidate directories: ${item.directories.join(', ')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function renderBundleReadme(report) {
  return [
    `# SPICE Doctor handoff: ${report.scenario.name}`,
    '',
    report.answer,
    '',
    '## Files',
    '',
    `- ${DEFAULT_FILES.metaKernel}: meta-kernel with the selected kernel load order.`,
    `- ${DEFAULT_FILES.recipe}: SpiceyPy script for the selected geometry products.`,
    `- ${DEFAULT_FILES.downloads}: direct NAIF URL to local path mapping.`,
    `- ${DEFAULT_FILES.checklist}: role, URL, coverage, and missing-piece checklist.`,
    `- ${DEFAULT_FILES.report}: full machine-readable report.`,
    '',
    '## Run',
    '',
    '```bash',
    'python -m venv .venv',
    '.venv/Scripts/python -m pip install spiceypy',
    `.venv/Scripts/python ${DEFAULT_FILES.recipe}`,
    '```',
    '',
    'Place downloaded kernels under `./kernels/` using the local paths listed in the checklist before running the script.',
    '',
  ].join('\n');
}

function nearestCoveredWindow(request, kernels) {
  const requestStart = parseIso(request.start);
  const requestStop = parseIso(request.stop);
  const duration = requestStop - requestStart;
  const requestMid = requestStart + duration / 2;
  const candidates = [];

  for (const kernel of kernels) {
    if (!kernel.coverage) continue;
    const coverageStart = parseIso(kernel.coverage.start);
    const coverageStop = parseIso(kernel.coverage.stop);
    if (coverageStop <= coverageStart) continue;

    const clippedDuration = Math.min(duration, coverageStop - coverageStart);
    let start;
    let stop;
    if (coverageStop <= requestStart) {
      stop = coverageStop;
      start = Math.max(coverageStart, stop - clippedDuration);
    } else if (coverageStart >= requestStop) {
      start = coverageStart;
      stop = Math.min(coverageStop, start + clippedDuration);
    } else {
      start = Math.max(requestStart, coverageStart);
      stop = Math.min(requestStop, coverageStop);
    }

    const mid = start + (stop - start) / 2;
    candidates.push({
      kernel,
      distance: Math.abs(mid - requestMid),
      window: { start: toIso(start), stop: toIso(stop) },
    });
  }

  return candidates.sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function spanPosition(request, span) {
  const start = parseIso(request.start);
  const stop = parseIso(request.stop);
  const spanStart = parseIso(span.start);
  const spanStop = parseIso(span.stop);
  const duration = stop - start;
  return {
    left: clamp(((spanStart - start) / duration) * 100),
    width: clamp(((spanStop - spanStart) / duration) * 100),
  };
}

function uniqueSuggestions(suggestions) {
  const seen = new Set();
  const out = [];
  for (const suggestion of suggestions) {
    const key = `${suggestion.title}|${suggestion.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(suggestion);
  }
  return out;
}

function labelRole(role = 'catalog') {
  return role.replace(/-/g, ' ');
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

function toIso(ms) {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}
