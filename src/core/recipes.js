export function generateSpiceyPyRecipe(scenario, window, calculations, kernels) {
  const midUtc = midpoint(window);
  const calcSet = new Set(calculations);
  const lines = [
    'from pathlib import Path',
    'import spiceypy as spice',
    '',
    'META_KERNEL = Path("scenario.tm")',
    `UTC = "${midUtc}"`,
    '',
    'spice.furnsh(str(META_KERNEL))',
    'et = spice.utc2et(UTC)',
    '',
    `observer = "${scenario.observer}"`,
    `target = "${scenario.target}"`,
    `frame = "${scenario.frame}"`,
    `abcorr = "${scenario.abcorr}"`,
    '',
  ];

  if (calcSet.has('state-vector') || calcSet.has('range-rate')) {
    lines.push(
      'state, light_time = spice.spkezr(target, et, frame, abcorr, observer)',
      'position_km = state[:3]',
      'velocity_km_s = state[3:]',
      'range_km = spice.vnorm(position_km)',
      'range_rate_km_s = spice.vdot(position_km, velocity_km_s) / range_km',
      'print("range_km", range_km)',
    );
    if (calcSet.has('range-rate')) {
      lines.push('print("range_rate_km_s", range_rate_km_s)');
    }
    lines.push('');
  }

  if (calcSet.has('phase-angle')) {
    lines.push(
      '# Phase angle at target: observer-target-sun.',
      'phase = spice.phaseq(et, target, "SUN", observer, abcorr)',
      'print("phase_angle_deg", spice.dpr() * phase)',
      '',
    );
  }

  if (calcSet.has('sub-observer-point')) {
    lines.push(
      '# Sub-observer point on the target body, using an ellipsoid model.',
      'spoint, trgepc, srfvec = spice.subpnt("Near point: ellipsoid", target, et, "IAU_" + target, abcorr, observer)',
      'radius, lon, lat = spice.reclat(spoint)',
      'print("sub_observer_lat_lon_deg", spice.dpr() * lat, spice.dpr() * lon)',
      '',
    );
  }

  if (calcSet.has('sub-solar-point')) {
    lines.push(
      '# Sub-solar point on the target body, using an ellipsoid model.',
      'spoint, trgepc, srfvec = spice.subslr("Near point: ellipsoid", target, et, "IAU_" + target, abcorr, observer)',
      'radius, lon, lat = spice.reclat(spoint)',
      'print("sub_solar_lat_lon_deg", spice.dpr() * lat, spice.dpr() * lon)',
      '',
    );
  }

  if (calcSet.has('instrument-fov') && scenario.instrument) {
    lines.push(
      `instrument = "${scenario.instrument.id}"`,
      'instrument_id = spice.bodn2c(instrument)',
      'shape, fov_frame, boresight, vector_count, boundary_vectors = spice.getfov(instrument_id, 32)',
      'print("instrument_fov", instrument, shape, fov_frame)',
      'print("instrument_boresight", boresight)',
      'for i, vector in enumerate(boundary_vectors[:vector_count]):',
      '    print("instrument_fov_boundary", i, vector)',
      '',
    );
  }

  if (calcSet.has('attitude-matrix') && scenario.attitudeFrame) {
    lines.push(
      `attitude_frame = "${scenario.attitudeFrame}"`,
      'attitude_to_j2000 = spice.pxform(attitude_frame, "J2000", et)',
      'print("attitude_to_j2000", attitude_to_j2000)',
      '',
    );
  }

  lines.push(
    '# Kernels used in the generated meta-kernel:',
    ...kernels.map((kernel) => `# - ${kernel.localPath}`),
    '',
    'spice.kclear()',
  );
  return lines.join('\n');
}

function midpoint(window) {
  const start = new Date(window.start).getTime();
  const stop = new Date(window.stop).getTime();
  return new Date((start + stop) / 2).toISOString().replace('.000Z', 'Z');
}
