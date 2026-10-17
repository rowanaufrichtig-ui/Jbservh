// Convert Ordnance Survey National Grid easting/northing (OSGB36) to WGS84
// latitude/longitude. GIAS publishes school locations as eastings/northings.
// Accuracy is a few metres, which is plenty for map pins.

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function gridToOsgb36(E, N) {
  const a = 6377563.396, b = 6356256.909; // Airy 1830
  const F0 = 0.9996012717;
  const lat0 = toRad(49), lon0 = toRad(-2);
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
    const Mb = (3 * n + 3 * n * n + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (N - N0 - M >= 0.00001);

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const tan2 = tanLat * tanLat, tan4 = tan2 * tan2, tan6 = tan4 * tan2;
  const secLat = 1 / cosLat;
  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu ** 3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tanLat / (720 * rho * nu ** 5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = secLat / nu;
  const XI = (secLat / (6 * nu ** 3)) * (nu / rho + 2 * tan2);
  const XII = (secLat / (120 * nu ** 5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (secLat / (5040 * nu ** 7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);
  const dE = E - E0;
  return {
    lat: lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6,
    lon: lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7,
  };
}

// Helmert transform OSGB36 -> WGS84.
function osgb36ToWgs84({ lat, lon }) {
  const a1 = 6377563.396, b1 = 6356256.909;
  const e21 = 1 - (b1 * b1) / (a1 * a1);
  const nu1 = a1 / Math.sqrt(1 - e21 * Math.sin(lat) ** 2);
  const x1 = nu1 * Math.cos(lat) * Math.cos(lon);
  const y1 = nu1 * Math.cos(lat) * Math.sin(lon);
  const z1 = (1 - e21) * nu1 * Math.sin(lat);

  const s = -20.4894e-6;
  const tx = 446.448, ty = -125.157, tz = 542.06;
  const rx = toRad(0.1502 / 3600), ry = toRad(0.247 / 3600), rz = toRad(0.8421 / 3600);
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;

  const a2 = 6378137, b2 = 6356752.3142;
  const e22 = 1 - (b2 * b2) / (a2 * a2);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let phi = Math.atan2(z2, p * (1 - e22)), prev = 2 * Math.PI;
  while (Math.abs(phi - prev) > 1e-12) {
    prev = phi;
    const nu2 = a2 / Math.sqrt(1 - e22 * Math.sin(phi) ** 2);
    phi = Math.atan2(z2 + e22 * nu2 * Math.sin(phi), p);
  }
  return { lat: toDeg(phi), lon: toDeg(Math.atan2(y2, x2)) };
}

export function osgbToLatLon(easting, northing) {
  const E = Number(easting), N = Number(northing);
  if (!E || !N) return null;
  const { lat, lon } = osgb36ToWgs84(gridToOsgb36(E, N));
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
}
