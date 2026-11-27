// Postcode and coordinate lookups via postcodes.io (free, open data, no key).

import { request } from './http.mjs';

const API = 'https://api.postcodes.io';

async function bulk(path, payload) {
  const res = await request(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  return (await res.json()).result ?? [];
}

const place = (r) => r && { region: r.region, district: r.admin_district, country: r.country, lat: r.latitude, lon: r.longitude, postcode: r.postcode };

// postcodes -> Map(postcode -> { region, district, country, lat, lon })
export async function lookupPostcodes(postcodes) {
  const out = new Map();
  const list = [...new Set(postcodes.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const result = await bulk('/postcodes', { postcodes: list.slice(i, i + 100) });
    for (const r of result) if (r.result) out.set(r.query, place(r.result));
  }
  return out;
}

// [{lat, lon}] -> array of { region, district, country, postcode } (nearest postcode)
export async function reverseGeocode(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const result = await bulk('/postcodes', {
      geolocations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lon, radius: 1000, limit: 1 })),
    });
    for (const r of result) out.push(place(r.result?.[0]) ?? null);
  }
  return out;
}
