import { KERNEL_CATALOG } from './catalog.js';
import { coverageGaps, formatCompact, overlap } from './time.js';

const CALCULATION_ROLE_DEPENDENCIES = {
  'instrument-fov': ['frame-definition', 'instrument-definition'],
  'attitude-matrix': ['frame-definition', 'spacecraft-clock', 'attitude'],
};

export function rolesForCalculations(calculations = []) {
  const roles = new Set();
  for (const calculation of calculations) {
    for (const role of CALCULATION_ROLE_DEPENDENCIES[calculation] ?? []) roles.add(role);
  }
  return roles;
}

export function selectKernelsForScenario(scenario, window, calculations = scenario.calculations) {
  const optionalRolesNeeded = rolesForCalculations(calculations);
  const roles = [
    ...scenario.requiredRoles.map((role) => ({ role, required: true })),
    ...scenario.optionalRoles
      .filter((role) => optionalRolesNeeded.has(role))
      .map((role) => ({ role, required: true })),
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
      const directories = scenario.kernelDirectories?.[role] ?? [];
      issues.push({
        severity: required ? 'error' : 'info',
        code: required ? 'MISSING_REQUIRED_ROLE' : 'OPTIONAL_ROLE_EMPTY',
        message,
        fix: required ? fixForRole(role, directories) : undefined,
        directories,
        role,
      });
    } else if (covered) {
      message = selected.length === 1
        ? `${selected[0].name} covers ${formatCompact(window)}.`
        : `${selected.length} kernels combine to cover ${formatCompact(window)}.`;
    } else {
      message = `Catalog coverage has ${gaps.length} gap${gaps.length === 1 ? '' : 's'} for ${formatCompact(window)}.`;
      const directories = scenario.kernelDirectories?.[role] ?? [];
      issues.push({
        severity: required ? 'error' : 'warning',
        code: required ? 'COVERAGE_GAP' : 'OPTIONAL_COVERAGE_GAP',
        message,
        fix: fixForCoverageGap(role, window, directories),
        directories,
        gaps,
        role,
      });
    }

    selections.push({ role, required, kernels: selected, covered, gaps, message });
  }

  issues.push(...bodyCoverageIssues(scenario, [...kernelById.values()]));

  return {
    selections,
    kernels: [...kernelById.values()].sort(compareKernelOrder),
    issues,
  };
}

function bodyCoverageIssues(scenario, kernels) {
  const availableBodies = new Set();
  for (const kernel of kernels) {
    for (const body of kernel.bodies ?? []) availableBodies.add(body.toUpperCase());
  }
  const requestedBodies = [scenario.observer, scenario.target, scenario.center]
    .filter(Boolean)
    .map((body) => body.toUpperCase())
    .filter((body, index, all) => all.indexOf(body) === index);

  return requestedBodies
    .filter((body) => !availableBodies.has(body))
    .map((body) => ({
      severity: 'error',
      code: 'BODY_NOT_IN_SELECTED_KERNELS',
      message: `${body} is not listed in the selected catalog kernels.`,
      fix: `Choose a cataloged body name or add an SPK catalog entry whose body list includes ${body}.`,
      directories: [
        'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/asteroids/',
        'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/',
      ],
      role: 'body-coverage',
    }));
}

function candidatesForRole(role, scenario) {
  const roleCandidates = KERNEL_CATALOG.filter((k) => k.role === role);
  if (role === 'instrument-definition') {
    return roleCandidates.filter((k) => {
      if (k.bodies?.length && !matchesObserver(k, scenario)) return false;
      if (!scenario.instrument?.id) return true;
      return k.instruments?.some((instrument) => instrument.toUpperCase() === scenario.instrument.id.toUpperCase());
    });
  }
  if (['frame-definition', 'spacecraft-clock', 'spacecraft-trajectory', 'attitude'].includes(role)) {
    return roleCandidates.filter((k) => matchesSpacecraft(k, scenario));
  }
  return roleCandidates;
}

function matchesObserver(kernel, scenario) {
  return kernel.bodies?.some((body) => body.toUpperCase() === scenario.observer.toUpperCase());
}

function matchesSpacecraft(kernel, scenario) {
  const bodies = scenario.spacecraftBodies?.length ? scenario.spacecraftBodies : [scenario.observer];
  return kernel.bodies?.some((body) => bodies.includes(body.toUpperCase()));
}

function fixForRole(role, directories) {
  if (directories.length === 0) {
    return `Add ${articleFor(role)} ${role} kernel entry to the catalog or provide one in a custom manifest.`;
  }
  return `Look for a ${role} kernel in ${directories.join(', ')}.`;
}

function fixForCoverageGap(role, window, directories) {
  const base = `Find a ${role} kernel spanning ${formatCompact(window)} or narrow the request window.`;
  if (directories.length === 0) return base;
  return `${base} Candidate directories: ${directories.join(', ')}.`;
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

function articleFor(value) {
  return /^[aeiou]/i.test(value) ? 'an' : 'a';
}
