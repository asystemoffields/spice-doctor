import { KERNEL_CATALOG } from './catalog.js';
import { coverageGaps, formatCompact, overlap } from './time.js';

export function selectKernelsForScenario(scenario, window) {
  const roles = [
    ...scenario.requiredRoles.map((role) => ({ role, required: true })),
    ...scenario.optionalRoles.map((role) => ({ role, required: false })),
  ];

  const selections = [];
  const issues = [];
  const kernelById = new Map();

  for (const { role, required } of roles) {
    const candidates = candidatesForRole(role, scenario).sort((a, b) => b.priority - a.priority);
    const withCoverage = candidates.filter((k) => k.coverage);
    const gaps = coverageGaps(window, withCoverage.map((k) => k.coverage));
    const covered = gaps.length === 0 || candidates.some((k) => !k.coverage);

    const selected = selectCoveringSet(candidates, window);
    for (const kernel of selected) kernelById.set(kernel.id, kernel);

    let message = '';
    if (candidates.length === 0) {
      message = required ? 'No catalog kernel currently covers this required role.' : 'No catalog kernel listed for this optional role.';
      issues.push({
        severity: required ? 'error' : 'info',
        code: required ? 'MISSING_REQUIRED_ROLE' : 'OPTIONAL_ROLE_EMPTY',
        message,
        fix: required ? `Add a ${role} kernel entry to the catalog or provide one in a custom manifest.` : undefined,
        role,
      });
    } else if (covered) {
      message = selected.length === 1
        ? `${selected[0].name} covers ${formatCompact(window)}.`
        : `${selected.length} kernels combine to cover ${formatCompact(window)}.`;
    } else {
      message = `Catalog coverage has ${gaps.length} gap${gaps.length === 1 ? '' : 's'} for ${formatCompact(window)}.`;
      issues.push({
        severity: required ? 'error' : 'warning',
        code: required ? 'COVERAGE_GAP' : 'OPTIONAL_COVERAGE_GAP',
        message,
        fix: `Find a ${role} kernel spanning ${formatCompact(window)} or narrow the request window.`,
        role,
      });
    }

    selections.push({ role, required, kernels: selected, covered, gaps, message });
  }

  return {
    selections,
    kernels: [...kernelById.values()].sort(compareKernelOrder),
    issues,
  };
}

function candidatesForRole(role, scenario) {
  const roleCandidates = KERNEL_CATALOG.filter((k) => k.role === role);
  if (role !== 'spacecraft-trajectory') return roleCandidates;
  const observer = scenario.observer.toUpperCase();
  return roleCandidates.filter((k) => k.bodies?.some((body) => body.toUpperCase() === observer));
}

function selectCoveringSet(candidates, window) {
  if (candidates.length > 0 && candidates.every((k) => !k.coverage)) return [candidates[0]];

  const selected = [];
  let gaps = [window];
  for (const candidate of candidates.sort((a, b) => b.priority - a.priority)) {
    if (!candidate.coverage) continue;
    if (!gaps.some((gap) => overlap(gap, candidate.coverage))) continue;
    selected.push(candidate);
    gaps = gaps.flatMap((gap) => coverageGaps(gap, [candidate.coverage]));
    if (gaps.length === 0) return selected;
  }

  return selected.length > 0 ? selected : candidates.slice(0, 2);
}

function compareKernelOrder(a, b) {
  const typeRank = new Map([
    ['LSK', 0],
    ['PCK', 1],
    ['FK', 2],
    ['IK', 3],
    ['SCLK', 4],
    ['SPK', 5],
    ['CK', 6],
    ['DSK', 7],
  ]);
  return (typeRank.get(a.type) ?? 99) - (typeRank.get(b.type) ?? 99) || a.localPath.localeCompare(b.localPath);
}
