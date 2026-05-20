import { getScenario } from './catalog.js';

const PLANETARY_SYSTEMS = [
  { role: 'jupiter-system', bodies: ['JUPITER', 'IO', 'EUROPA', 'GANYMEDE', 'CALLISTO'] },
  { role: 'saturn-system', bodies: ['SATURN', 'MIMAS', 'ENCELADUS', 'TETHYS', 'DIONE', 'RHEA', 'TITAN', 'IAPETUS'] },
  { role: 'mars-system', bodies: ['MARS', 'PHOBOS', 'DEIMOS'] },
];

const SPACECRAFT = {
  JUNO: {
    mission: 'Juno',
    attitudeFrame: 'JUNO_SPACECRAFT',
    instrument: { id: 'JUNO_JUNOCAM_RED', name: 'JunoCam red band' },
    directories: ['https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/'],
  },
  MRO: {
    mission: 'Mars Reconnaissance Orbiter',
    attitudeFrame: 'MRO_SPACECRAFT',
    instrument: { id: 'MRO_HIRISE', name: 'HiRISE' },
    directories: ['https://naif.jpl.nasa.gov/pub/naif/MRO/kernels/'],
  },
  'MARS RECON ORBITER': {
    mission: 'Mars Reconnaissance Orbiter',
    attitudeFrame: 'MRO_SPACECRAFT',
    instrument: { id: 'MRO_HIRISE', name: 'HiRISE' },
    directories: ['https://naif.jpl.nasa.gov/pub/naif/MRO/kernels/'],
  },
  CASSINI: {
    mission: 'Cassini',
    attitudeFrame: 'CASSINI_SC_COORD',
    instrument: { id: 'CASSINI_ISS_NAC', name: 'ISS narrow angle camera' },
    directories: ['https://naif.jpl.nasa.gov/pub/naif/CASSINI/kernels/'],
  },
};

const CALCULATIONS = ['state-vector', 'range-rate', 'phase-angle', 'sub-observer-point', 'sub-solar-point'];

export function createScenarioFromQuestion(question) {
  if (question.presetScenarioId) {
    const preset = getScenario(question.presetScenarioId);
    if (preset && !question.forceCustom) {
      return {
        ...preset,
        sampleWindow: {
          start: question.window?.start ?? preset.sampleWindow.start,
          stop: question.window?.stop ?? preset.sampleWindow.stop,
        },
      };
    }
  }

  const observer = normalizeBody(question.observer);
  const target = normalizeBody(question.target);
  const center = normalizeBody(question.center || target);
  const spacecraftBodies = spacecraftBodiesFor(observer, target);
  const spacecraftInfo = spacecraftBodies.map((body) => SPACECRAFT[body]).find(Boolean);
  const calculations = question.calculations?.length ? question.calculations : CALCULATIONS;
  const requiredRoles = requiredRolesFor({ observer, target, center, spacecraftBodies });
  const optionalRoles = ['spacecraft-structure', 'frame-definition', 'instrument-definition', 'spacecraft-clock', 'attitude'];
  const instrument = instrumentFor(question.instrument, spacecraftInfo);

  return {
    id: 'question',
    name: `${observer} to ${target}`,
    mission: spacecraftInfo?.mission ?? 'Custom SPICE question',
    observer,
    target,
    center,
    frame: question.frame?.trim() || 'J2000',
    attitudeFrame: question.attitudeFrame?.trim() || spacecraftInfo?.attitudeFrame,
    abcorr: question.abcorr?.trim() || 'LT+S',
    instrument,
    spacecraftBodies,
    sampleWindow: {
      start: question.window.start,
      stop: question.window.stop,
    },
    description: 'User-specified geometry question resolved against the curated kernel catalog.',
    requiredRoles,
    optionalRoles,
    calculations,
    kernelDirectories: kernelDirectoriesFor(requiredRoles, spacecraftInfo),
    tags: ['question'],
  };
}

export function normalizeBody(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function requiredRolesFor(question) {
  const roles = new Set(['leapseconds', 'body-constants', 'planetary-ephemeris']);
  const systemRole = systemRoleFor([question.target, question.center]);
  if (systemRole) roles.add(systemRole);
  if (question.spacecraftBodies.length > 0) roles.add('spacecraft-trajectory');
  return [...roles];
}

function systemRoleFor(bodies) {
  const normalized = bodies.map((body) => normalizeBody(body));
  return PLANETARY_SYSTEMS.find((system) => system.bodies.some((body) => normalized.includes(body)))?.role;
}

function spacecraftBodiesFor(observer, target) {
  return [observer, target].filter((body, index, all) => SPACECRAFT[body] && all.indexOf(body) === index);
}

function instrumentFor(value, spacecraftInfo) {
  const id = normalizeBody(value);
  if (id) return { id, name: id };
  return spacecraftInfo?.instrument;
}

function kernelDirectoriesFor(requiredRoles, spacecraftInfo) {
  const directories = new Map([
    ['leapseconds', ['https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/']],
    ['body-constants', ['https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/']],
    ['planetary-ephemeris', ['https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/']],
    ['jupiter-system', ['https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/']],
    ['saturn-system', ['https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/']],
    ['mars-system', ['https://naif.jpl.nasa.gov/pub/naif/MRO/kernels/spk/']],
  ]);
  const out = new Map();
  for (const role of requiredRoles) out.set(role, directories.get(role) ?? []);
  if (spacecraftInfo?.directories) {
    out.set('spacecraft-trajectory', spacecraftInfo.directories.map((url) => `${url}spk/`));
    out.set('frame-definition', spacecraftInfo.directories.map((url) => `${url}fk/`));
    out.set('instrument-definition', spacecraftInfo.directories.map((url) => `${url}ik/`));
    out.set('spacecraft-clock', spacecraftInfo.directories.map((url) => `${url}sclk/`));
    out.set('attitude', spacecraftInfo.directories.map((url) => `${url}ck/`));
  }
  return Object.fromEntries(out);
}
