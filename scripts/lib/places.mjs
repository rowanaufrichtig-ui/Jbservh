// Where to look: the preset areas, distances, and which teacher pay area a
// place falls in.

// Areas the website keeps up to date. `region` makes an area mean a whole
// region (Greater London) rather than a circle; `board` is the place name
// sent to the job boards. The apps can also search any town or postcode.
export const PRESETS = [
  { slug: 'london', name: 'London', lat: 51.5072, lon: -0.1276, radius: 15, region: 'London', country: 'England', board: 'London' },
  { slug: 'brighton', name: 'Brighton & Hove', lat: 50.8229, lon: -0.1363, radius: 10, country: 'England', board: 'Brighton' },
  { slug: 'cardiff', name: 'Cardiff', lat: 51.4816, lon: -3.1791, radius: 10, country: 'Wales', board: 'Cardiff' },
  { slug: 'bristol', name: 'Bristol', lat: 51.4545, lon: -2.5879, radius: 10, country: 'England', board: 'Bristol' },
  { slug: 'birmingham', name: 'Birmingham', lat: 52.4862, lon: -1.8904, radius: 10, country: 'England', board: 'Birmingham' },
  { slug: 'manchester', name: 'Manchester', lat: 53.4808, lon: -2.2426, radius: 10, country: 'England', board: 'Manchester' },
];

export const presetBySlug = (slug) => PRESETS.find((p) => p.slug === slug) ?? null;

// Great-circle distance in miles.
export function miles(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

// Is a point inside an area? A little slack at the edge, because job boards
// geocode schools to postcode centroids.
export function inArea(area, { lat, lon, region } = {}) {
  if (area.region && region) return region === area.region;
  if (lat == null || lon == null) return false;
  return miles(area.lat, area.lon, lat, lon) <= area.radius + 1.5;
}

// Which regional school files an area needs: a region-wide area needs its
// region; a circle needs every region whose schools' bounding box it touches.
export function regionsForArea(area, regions) {
  if (area.region) return regions.filter((r) => r.name === area.region);
  const dLat = area.radius / 69, dLon = area.radius / (69 * Math.cos((area.lat * Math.PI) / 180));
  return regions.filter(({ bbox: [s, w, n, e] }) => area.lat + dLat >= s && area.lat - dLat <= n && area.lon + dLon >= w && area.lon - dLon <= e);
}

// Pay areas, as defined in the School Teachers' Pay and Conditions Document
// 2026 (England). Wales has its own pay document.
const INNER_LONDON = new Set([
  'Barking and Dagenham', 'Brent', 'Camden', 'City of London', 'Ealing', 'Greenwich', 'Hackney',
  'Hammersmith and Fulham', 'Haringey', 'Islington', 'Kensington and Chelsea', 'Lambeth', 'Lewisham',
  'Merton', 'Newham', 'Southwark', 'Tower Hamlets', 'Wandsworth', 'Westminster',
]);
const OUTER_LONDON = new Set([
  'Barnet', 'Bexley', 'Bromley', 'Croydon', 'Enfield', 'Harrow', 'Havering', 'Hillingdon', 'Hounslow',
  'Kingston upon Thames', 'Redbridge', 'Richmond upon Thames', 'Sutton', 'Waltham Forest',
]);
const FRINGE = new Set([
  // Berkshire
  'Bracknell Forest', 'Slough', 'Windsor and Maidenhead',
  // Essex
  'Basildon', 'Brentwood', 'Epping Forest', 'Harlow', 'Thurrock',
  // Hertfordshire
  'Broxbourne', 'Dacorum', 'East Hertfordshire', 'Hertsmere', 'St Albans', 'Three Rivers', 'Watford', 'Welwyn Hatfield',
  // Kent
  'Dartford', 'Sevenoaks',
  // Surrey (the whole county)
  'Elmbridge', 'Epsom and Ewell', 'Guildford', 'Mole Valley', 'Reigate and Banstead', 'Runnymede',
  'Spelthorne', 'Surrey Heath', 'Tandridge', 'Waverley', 'Woking',
  // West Sussex
  'Crawley',
]);

const ALIASES = {
  'city of westminster': 'Westminster',
  'kingston-upon-thames': 'Kingston upon Thames',
  'richmond-upon-thames': 'Richmond upon Thames',
  'kensington & chelsea': 'Kensington and Chelsea',
  'hammersmith & fulham': 'Hammersmith and Fulham',
  'barking & dagenham': 'Barking and Dagenham',
  'epsom & ewell': 'Epsom and Ewell',
  'reigate & banstead': 'Reigate and Banstead',
  'windsor & maidenhead': 'Windsor and Maidenhead',
  'st. albans': 'St Albans',
};
export const tidyDistrict = (name) => (name ? ALIASES[String(name).toLowerCase()] ?? String(name).replace(/^London Borough of /, '') : null);

export const M1_2026 = { 'Inner London': 41729, 'Outer London': 39196, Fringe: 35602, 'Rest of England': 34069 };

/**
 * @param {object} p
 * @param {string} [p.district] local authority district (e.g. "Crawley", "Camden")
 * @param {string} [p.country]  "England" or "Wales"
 * @returns "Inner London" | "Outer London" | "Fringe" | "Rest of England" | "Wales" | null
 */
export function payAreaFor({ district, country } = {}) {
  if (country === 'Wales') return 'Wales';
  const d = tidyDistrict(district);
  if (!d) return null;
  if (INNER_LONDON.has(d)) return 'Inner London';
  if (OUTER_LONDON.has(d)) return 'Outer London';
  if (FRINGE.has(d)) return 'Fringe';
  // Since 2020 South Bucks and Chiltern sit inside Buckinghamshire, which is
  // only partly in the fringe, so we cannot tell from the district alone.
  if (d === 'Buckinghamshire') return null;
  return 'Rest of England';
}

// Places that turn up in job titles. An advert whose title names somewhere
// far from the area (an agency based nearby recruiting for Oldham, say) is
// dropped even if its contact postcode is local.
const CITIES = {
  London: [51.507, -0.128], Manchester: [53.481, -2.243], Birmingham: [52.486, -1.89], Leeds: [53.8, -1.549],
  Liverpool: [53.408, -2.992], Bristol: [51.455, -2.588], Sheffield: [53.381, -1.47], Nottingham: [52.954, -1.158],
  Leicester: [52.637, -1.134], Newcastle: [54.978, -1.617], Cardiff: [51.482, -3.179], Swansea: [51.622, -3.944],
  Newport: [51.588, -2.998], Brighton: [50.823, -0.136], Oxford: [51.752, -1.258], Cambridge: [52.205, 0.122],
  Reading: [51.454, -0.973], Southampton: [50.909, -1.404], Portsmouth: [50.82, -1.088], Oldham: [53.541, -2.112],
  Bradford: [53.796, -1.759], Coventry: [52.407, -1.512], Norwich: [52.63, 1.297], Exeter: [50.718, -3.534],
  Plymouth: [50.375, -4.143], York: [53.96, -1.087], Hull: [53.745, -0.336], Luton: [51.879, -0.418],
  'Milton Keynes': [52.041, -0.759], Watford: [51.656, -0.39], Slough: [51.51, -0.595], Bath: [51.38, -2.36],
  Gloucester: [51.864, -2.244], Swindon: [51.556, -1.78], Wolverhampton: [52.587, -2.129], Stoke: [53.003, -2.18],
  Derby: [52.922, -1.476], Sunderland: [54.906, -1.381], Middlesbrough: [54.574, -1.235], Blackpool: [53.817, -3.036],
  Preston: [53.763, -2.703], Bolton: [53.578, -2.43], Wigan: [53.545, -2.632], Stockport: [53.408, -2.15],
  Peterborough: [52.573, -0.248], Ipswich: [52.057, 1.148], Colchester: [51.896, 0.892], Chelmsford: [51.736, 0.469],
  Canterbury: [51.28, 1.08], Maidstone: [51.272, 0.529], Hastings: [50.855, 0.573], Eastbourne: [50.768, 0.29],
  Worthing: [50.818, -0.372], Crawley: [51.109, -0.187], Guildford: [51.236, -0.57], Bournemouth: [50.72, -1.88],
  Edinburgh: [55.953, -3.188], Glasgow: [55.864, -4.252], Belfast: [54.597, -5.93],
};
const ABROAD = /\b(Dubai|Abu Dhabi|Qatar|Doha|Saudi|Kuwait|Bahrain|Oman|Morocco|China|Shanghai|Beijing|Hong Kong|Singapore|Malaysia|Thailand|Bangkok|Vietnam|Spain|Madrid|Barcelona|Portugal|Egypt|Cairo|Kenya|Nigeria)\b/i;
const CITY_RE = new RegExp(`\\b(${Object.keys(CITIES).join('|')})\\b`, 'g');

export function titleNamesFarPlace(title, area) {
  if (ABROAD.test(title)) return true;
  for (const [name] of title.matchAll(CITY_RE)) {
    const [lat, lon] = CITIES[name];
    if (miles(area.lat, area.lon, lat, lon) > area.radius + 25) return true;
  }
  return false;
}
