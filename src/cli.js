#!/usr/bin/env node
import { SCENARIOS } from './core/catalog.js';
import { generateDownloadList, toJsonReport } from './core/manifest.js';
import { buildManifestReport } from './core/report.js';

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.scenario || process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const scenario = SCENARIOS.find((s) => s.id === args.scenario);
  if (!scenario) {
    throw new Error(`Unknown scenario "${args.scenario}". Try one of: ${SCENARIOS.map((s) => s.id).join(', ')}`);
  }

  const report = buildManifestReport({
    scenarioId: scenario.id,
    window: {
      start: args.from ?? scenario.sampleWindow.start,
      stop: args.to ?? scenario.sampleWindow.stop,
    },
    calculations: args.calculations,
  });

  if (args.json) {
    console.log(toJsonReport(report));
    return;
  }

  console.log(`${report.scenario.name}: ${report.status}`);
  for (const issue of report.issues) {
    console.log(`${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
    if (issue.fix) console.log(`  fix: ${issue.fix}`);
  }
  console.log('');
  console.log('Kernels');
  for (const kernel of report.kernels) {
    console.log(`- ${kernel.type} ${kernel.localPath}`);
  }

  if (args.downloads) {
    console.log('\nDownload list');
    console.log(generateDownloadList(report.kernels));
  }
  if (args.metaKernel) {
    console.log('\nMeta-kernel');
    console.log(report.metaKernel);
  }
  if (args.recipe) {
    console.log('\nSpiceyPy recipe');
    console.log(report.spiceypyRecipe);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--scenario') out.scenario = argv[++i];
    else if (arg === '--from') out.from = argv[++i];
    else if (arg === '--to') out.to = argv[++i];
    else if (arg === '--json') out.json = true;
    else if (arg === '--meta-kernel') out.metaKernel = true;
    else if (arg === '--recipe') out.recipe = true;
    else if (arg === '--downloads') out.downloads = true;
    else if (arg === '--calculations') {
      out.calculations = (argv[++i] ?? '').split(',').filter(Boolean);
    } else if (!arg.startsWith('-') && !out.scenario) {
      out.scenario = arg;
    }
  }
  return out;
}

function printHelp() {
  console.log(`spice-doctor

Usage:
  spice-doctor --scenario juno-jupiter --from 2026-03-10T00:00:00Z --to 2026-03-11T00:00:00Z --downloads --meta-kernel --recipe
  spice-doctor cassini-enceladus-2012 --json

Scenarios:
${SCENARIOS.map((s) => `  ${s.id.padEnd(24)} ${s.name}`).join('\n')}
`);
}

main();
