#!/usr/bin/env node
import { KERNEL_CATALOG, SCENARIOS } from '../src/core/catalog.js';

const DEFAULT_DIRECTORIES = [
  'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/',
  'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/',
  'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/',
  'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/',
  'https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/fk/',
  'https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/ik/',
  'https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/sclk/',
  'https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/',
  'https://naif.jpl.nasa.gov/pub/naif/MRO/kernels/fk/',
  'https://naif.jpl.nasa.gov/pub/naif/MRO/kernels/ik/',
  'https://naif.jpl.nasa.gov/pub/naif/MRO/kernels/sclk/',
  'https://naif.jpl.nasa.gov/pub/naif/MRO/kernels/spk/',
  'https://naif.jpl.nasa.gov/pub/naif/CASSINI/kernels/fk/',
  'https://naif.jpl.nasa.gov/pub/naif/CASSINI/kernels/ik/',
  'https://naif.jpl.nasa.gov/pub/naif/CASSINI/kernels/sclk/',
  'https://naif.jpl.nasa.gov/pub/naif/CASSINI/kernels/spk/',
];

const TYPE_BY_EXTENSION = new Map([
  ['.tls', 'LSK'],
  ['.tsc', 'SCLK'],
  ['.tpc', 'PCK'],
  ['.tf', 'FK'],
  ['.ti', 'IK'],
  ['.bsp', 'SPK'],
  ['.bc', 'CK'],
  ['.bds', 'DSK'],
]);

const knownUrls = new Set(KERNEL_CATALOG.map((kernel) => kernel.url));

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const proposals = await collectProposals(args);
if (args.json) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), proposals }, null, 2));
} else {
  printText(proposals);
}

export function parseIndex(html, baseUrl) {
  const entries = [];
  const linkPattern = /<a\s+href="([^"]+)">([^<]+)<\/a>([^<]*)/gi;
  let match;
  while ((match = linkPattern.exec(html))) {
    const href = decodeHtml(match[1]);
    const label = decodeHtml(match[2]).trim();
    const tail = decodeHtml(match[3] ?? '');
    if (href.startsWith('?') || href.startsWith('#') || href.startsWith('/') || href.includes('://') || href === '../') {
      continue;
    }
    const url = new URL(href, baseUrl).href;
    const metadata = tail.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+([0-9.]+[KMG]?|-)?/);
    entries.push({
      name: label,
      href,
      url,
      lastModified: metadata?.[1] ?? null,
      size: metadata?.[2] && metadata[2] !== '-' ? metadata[2] : null,
    });
  }
  return entries;
}

export function proposalForEntry(entry, directoryUrl) {
  const type = kernelType(entry.name);
  if (!type) return null;
  return {
    id: proposedId(entry, type),
    name: entry.name,
    type,
    role: roleFor(directoryUrl, type),
    url: entry.url,
    localPath: proposedLocalPath(entry.url),
    source: sourceFor(directoryUrl),
    lastModified: entry.lastModified,
    size: entry.size,
    status: knownUrls.has(entry.url) ? 'cataloged' : 'candidate',
  };
}

async function collectProposals(options) {
  const directories = directoriesFor(options);
  const proposals = [];
  for (const directory of directories) {
    const response = await fetch(directory);
    if (!response.ok) throw new Error(`Could not fetch ${directory}: ${response.status} ${response.statusText}`);
    const html = await response.text();
    for (const entry of parseIndex(html, directory)) {
      const proposal = proposalForEntry(entry, directory);
      if (!proposal) continue;
      if (options.type && proposal.type !== options.type) continue;
      if (options.role && proposal.role !== options.role) continue;
      if (options.onlyCandidates && proposal.status !== 'candidate') continue;
      proposals.push(proposal);
      if (proposals.length >= options.limit) return proposals;
    }
  }
  return proposals;
}

function directoriesFor(options) {
  if (options.url.length) return options.url;
  if (!options.scenario) return DEFAULT_DIRECTORIES;
  const scenario = SCENARIOS.find((item) => item.id === options.scenario);
  if (!scenario) throw new Error(`Unknown scenario: ${options.scenario}`);
  const mission = scenario.mission.toUpperCase();
  if (mission.includes('JUNO')) return DEFAULT_DIRECTORIES.filter((url) => url.includes('/JUNO/') || url.includes('/generic_kernels/'));
  if (mission.includes('MARS RECONNAISSANCE')) return DEFAULT_DIRECTORIES.filter((url) => url.includes('/MRO/') || url.includes('/generic_kernels/'));
  if (mission.includes('CASSINI')) return DEFAULT_DIRECTORIES.filter((url) => url.includes('/CASSINI/') || url.includes('/generic_kernels/'));
  return DEFAULT_DIRECTORIES.filter((url) => url.includes('/generic_kernels/'));
}

function parseArgs(argv) {
  const out = { url: [], limit: 40, json: false, onlyCandidates: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') out.url.push(argv[++i]);
    else if (arg === '--scenario') out.scenario = argv[++i];
    else if (arg === '--role') out.role = argv[++i];
    else if (arg === '--type') out.type = argv[++i].toUpperCase();
    else if (arg === '--limit') out.limit = Number(argv[++i]);
    else if (arg === '--json') out.json = true;
    else if (arg === '--candidates') out.onlyCandidates = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function kernelType(name) {
  const lower = name.toLowerCase();
  for (const [extension, type] of TYPE_BY_EXTENSION) {
    if (lower.endsWith(extension)) return type;
  }
  return null;
}

function roleFor(directoryUrl, type) {
  const lower = directoryUrl.toLowerCase();
  if (type === 'FK') return 'frame-definition';
  if (type === 'IK') return 'instrument-definition';
  if (type === 'SCLK') return 'spacecraft-clock';
  if (type === 'CK') return 'attitude';
  if (type === 'DSK') return 'shape-model';
  if (lower.includes('/lsk/')) return 'leapseconds';
  if (lower.includes('/pck/')) return 'body-constants';
  if (type === 'SPK' && lower.includes('/satellites/')) return 'satellite-system';
  if (type === 'SPK' && lower.includes('/planets/')) return 'planetary-ephemeris';
  if (type === 'SPK') return 'spacecraft-trajectory';
  return 'support';
}

function sourceFor(directoryUrl) {
  const path = new URL(directoryUrl).pathname;
  if (path.includes('/generic_kernels/')) return 'NAIF generic kernels';
  const mission = path.split('/').filter(Boolean)[1] ?? 'mission';
  return `${mission} mission kernel directory`;
}

function proposedLocalPath(url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const naifIndex = parts.indexOf('naif');
  const naifPath = parts.slice(naifIndex + 1);
  if (naifPath[0] === 'generic_kernels') return ['generic', ...naifPath.slice(1)].join('/').toLowerCase();
  if (naifPath[1] === 'kernels') return [naifPath[0], ...naifPath.slice(2)].join('/').toLowerCase();
  return naifPath.join('/').toLowerCase();
}

function proposedId(entry, type) {
  return `${type.toLowerCase()}-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function printText(proposals) {
  if (proposals.length === 0) {
    console.log('No kernel entries found.');
    return;
  }
  for (const proposal of proposals) {
    console.log(`${proposal.status.toUpperCase()} ${proposal.type.padEnd(4)} ${proposal.role.padEnd(22)} ${proposal.name}`);
    console.log(`  ${proposal.url}`);
    if (proposal.lastModified || proposal.size) {
      console.log(`  modified=${proposal.lastModified ?? 'unknown'} size=${proposal.size ?? 'unknown'}`);
    }
  }
}

function printHelp() {
  console.log(`scrape-naif-index

Usage:
  node scripts/scrape-naif-index.js --scenario juno-jupiter --candidates
  node scripts/scrape-naif-index.js --url https://naif.jpl.nasa.gov/pub/naif/MRO/kernels/ck/ --type CK --limit 20 --json

Options:
  --url URL        Scan one directory. May be repeated.
  --scenario ID   Scan default directories relevant to a bundled scenario.
  --role ROLE     Filter proposed catalog role.
  --type TYPE     Filter kernel type, such as SPK, CK, FK, IK, SCLK.
  --candidates    Show entries not already cataloged.
  --json          Print JSON.
  --limit N       Maximum proposals, default 40.
`);
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}
