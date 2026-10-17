// London local authorities (DfE LA codes) and the teacher pay area each one
// falls in under the School Teachers' Pay and Conditions Document. The pay
// areas are not the same as the statistical inner/outer split: Barking and
// Dagenham, Brent, Ealing, Haringey, Merton, Newham and Waltham Forest are
// paid on the Inner London scale.

export const BOROUGHS = [
  { la: 201, name: 'City of London', pay: 'Inner London' },
  { la: 202, name: 'Camden', pay: 'Inner London' },
  { la: 203, name: 'Greenwich', pay: 'Inner London' },
  { la: 204, name: 'Hackney', pay: 'Inner London' },
  { la: 205, name: 'Hammersmith and Fulham', pay: 'Inner London' },
  { la: 206, name: 'Islington', pay: 'Inner London' },
  { la: 207, name: 'Kensington and Chelsea', pay: 'Inner London' },
  { la: 208, name: 'Lambeth', pay: 'Inner London' },
  { la: 209, name: 'Lewisham', pay: 'Inner London' },
  { la: 210, name: 'Southwark', pay: 'Inner London' },
  { la: 211, name: 'Tower Hamlets', pay: 'Inner London' },
  { la: 212, name: 'Wandsworth', pay: 'Inner London' },
  { la: 213, name: 'Westminster', pay: 'Inner London' },
  { la: 301, name: 'Barking and Dagenham', pay: 'Inner London' },
  { la: 302, name: 'Barnet', pay: 'Outer London' },
  { la: 303, name: 'Bexley', pay: 'Outer London' },
  { la: 304, name: 'Brent', pay: 'Inner London' },
  { la: 305, name: 'Bromley', pay: 'Outer London' },
  { la: 306, name: 'Croydon', pay: 'Outer London' },
  { la: 307, name: 'Ealing', pay: 'Inner London' },
  { la: 308, name: 'Enfield', pay: 'Outer London' },
  { la: 309, name: 'Haringey', pay: 'Inner London' },
  { la: 310, name: 'Harrow', pay: 'Outer London' },
  { la: 311, name: 'Havering', pay: 'Outer London' },
  { la: 312, name: 'Hillingdon', pay: 'Outer London' },
  { la: 313, name: 'Hounslow', pay: 'Outer London' },
  { la: 314, name: 'Kingston upon Thames', pay: 'Outer London' },
  { la: 315, name: 'Merton', pay: 'Inner London' },
  { la: 316, name: 'Newham', pay: 'Inner London' },
  { la: 317, name: 'Redbridge', pay: 'Outer London' },
  { la: 318, name: 'Richmond upon Thames', pay: 'Outer London' },
  { la: 319, name: 'Sutton', pay: 'Outer London' },
  { la: 320, name: 'Waltham Forest', pay: 'Inner London' },
];

export const BOROUGH_BY_LA = new Map(BOROUGHS.map((b) => [b.la, b]));
export const BOROUGH_BY_NAME = new Map(BOROUGHS.map((b) => [b.name.toLowerCase(), b]));

// Postcodes.io and some job boards spell a few boroughs differently.
const ALIASES = {
  'city of westminster': 'westminster',
  'royal borough of greenwich': 'greenwich',
  'kensington & chelsea': 'kensington and chelsea',
  'royal borough of kensington and chelsea': 'kensington and chelsea',
  'hammersmith & fulham': 'hammersmith and fulham',
  'barking & dagenham': 'barking and dagenham',
  'kingston': 'kingston upon thames',
  'richmond': 'richmond upon thames',
  'city of london': 'city of london',
};

export function findBorough(name) {
  if (!name) return null;
  const key = String(name).toLowerCase().replace(/^london borough of /, '').trim();
  return BOROUGH_BY_NAME.get(ALIASES[key] ?? key) ?? null;
}

// Main pay range point M1 from 1 September 2026 (3.5% award). Shown as a
// guide for ECT starting salaries; always check the advert.
export const M1_2026 = {
  'Inner London': 41729,
  'Outer London': 39196,
  'Fringe': 35602,
  'Rest of England': 34069,
};
