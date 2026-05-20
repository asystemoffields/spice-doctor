import { getScenario } from './catalog.js';
import { selectKernelsForScenario } from './coverage.js';
import { buildHandoffBundle } from './handoff.js';
import { generateMetaKernel } from './manifest.js';
import { createScenarioFromQuestion } from './questions.js';
import { generateSpiceyPyRecipe } from './recipes.js';
import { validateWindow } from './time.js';

export function buildManifestReport(request) {
  const scenario = getScenario(request.scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario: ${request.scenarioId}`);
  }

  const window = validateWindow(request.window);
  const calculations = request.calculations?.length ? request.calculations : scenario.calculations;
  const { selections, kernels, issues } = selectKernelsForScenario(scenario, window, calculations);
  const status = issues.some((i) => i.severity === 'error')
    ? 'blocked'
    : issues.some((i) => i.severity === 'warning')
      ? 'partial'
      : 'ready';

  const normalizedRequest = { ...request, window, calculations };
  return buildReportPayload(scenario, normalizedRequest, window, calculations, selections, kernels, issues);
}

export function buildQuestionReport(question) {
  const window = validateWindow(question.window);
  const scenario = createScenarioFromQuestion({ ...question, window, forceCustom: true });
  const calculations = question.calculations?.length ? question.calculations : scenario.calculations;
  const { selections, kernels, issues } = selectKernelsForScenario(scenario, window, calculations);
  const normalizedRequest = { ...question, window, calculations };
  return buildReportPayload(scenario, normalizedRequest, window, calculations, selections, kernels, issues);
}

function buildReportPayload(scenario, request, window, calculations, selections, kernels, issues) {
  const status = issues.some((i) => i.severity === 'error')
    ? 'blocked'
    : issues.some((i) => i.severity === 'warning')
      ? 'partial'
      : 'ready';

  const report = {
    scenario,
    request,
    status,
    selections,
    kernels,
    issues,
    metaKernel: generateMetaKernel(kernels, scenario.name),
    spiceypyRecipe: generateSpiceyPyRecipe(scenario, window, calculations, kernels),
    answer: answerFor(status, selections, issues),
  };
  report.handoff = buildHandoffBundle(report);
  return report;
}

function answerFor(status, selections, issues) {
  if (status === 'ready') {
    return 'Ready: the selected kernels cover this geometry question.';
  }
  const firstIssue = issues.find((issue) => issue.severity === 'error') ?? issues[0];
  if (!firstIssue) return 'Partial: review diagnostics before running the recipe.';
  const role = firstIssue.role ? ` for ${firstIssue.role}` : '';
  return `${status === 'blocked' ? 'Blocked' : 'Almost ready'}${role}: ${firstIssue.message}`;
}
