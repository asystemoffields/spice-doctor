import { getScenario } from './catalog.js';
import { selectKernelsForScenario } from './coverage.js';
import { generateMetaKernel } from './manifest.js';
import { generateSpiceyPyRecipe } from './recipes.js';
import { validateWindow } from './time.js';

export function buildManifestReport(request) {
  const scenario = getScenario(request.scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario: ${request.scenarioId}`);
  }

  const window = validateWindow(request.window);
  const calculations = request.calculations?.length ? request.calculations : scenario.calculations;
  const { selections, kernels, issues } = selectKernelsForScenario(scenario, window);
  const status = issues.some((i) => i.severity === 'error')
    ? 'blocked'
    : issues.some((i) => i.severity === 'warning')
      ? 'partial'
      : 'ready';

  const normalizedRequest = { ...request, window, calculations };
  return {
    scenario,
    request: normalizedRequest,
    status,
    selections,
    kernels,
    issues,
    metaKernel: generateMetaKernel(kernels, scenario.name),
    spiceypyRecipe: generateSpiceyPyRecipe(scenario, window, calculations, kernels),
  };
}
