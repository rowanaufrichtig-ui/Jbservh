import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseCSVObjects } from '../scripts/lib/csv.mjs';
import { osgbToLatLon } from '../scripts/lib/osgb.mjs';
import { nameSimilarity, normPostcode, findPostcode, htmlToText } from '../scripts/lib/text.mjs';
import { PRESETS, inArea, miles, payAreaFor, regionsForArea, titleNamesFarPlace } from '../scripts/lib/places.mjs';
import { buildMatcher } from '../scripts/lib/match.mjs';
import { gradeFromAps, ucasFromAps } from '../scripts/build-schools.mjs';

test('CSV parser handles quotes, commas and newlines', () => {
  assert.deepEqual(parseCSV('a,b\n"x, y","he said ""hi"""\r\n1,"two\nlines"\n'), [
    ['a', 'b'],
    ['x, y', 'he said "hi"'],
    ['1', 'two\nlines'],
  ]);
  assert.deepEqual(parseCSVObjects('﻿URN,Name\n100053,Acland Burghley\n'), [{ URN: '100053', Name: 'Acland Burghley' }]);
});

test('National Grid to latitude/longitude is accurate to a few metres', () => {
  // Ordnance Survey worked example: Caister water tower.
  const p = osgbToLatLon(651409.903, 313177.27);
  assert.ok(Math.abs(p.lat - 52.65798) < 0.0002, `lat ${p.lat}`);
  assert.ok(Math.abs(p.lon - 1.71605) < 0.0002, `lon ${p.lon}`);
  assert.equal(osgbToLatLon('', ''), null);
});

test('A level points convert to grades and UCAS tariff', () => {
  assert.equal(gradeFromAps(60), 'A*');
  assert.equal(gradeFromAps(50), 'A');
  assert.equal(gradeFromAps(36.46), 'B-');
  assert.equal(gradeFromAps(40.55), 'B');
  assert.equal(gradeFromAps(33.92), 'C+');
  assert.equal(gradeFromAps(28.21), 'C-');
  // A* = 60 -> 56 UCAS, E = 10 -> 16 UCAS, B = 40 -> 40 UCAS
  assert.equal(ucasFromAps(60), 56);
  assert.equal(ucasFromAps(10), 16);
  assert.equal(ucasFromAps(40), 40);
});

test('school names and postcodes normalise for matching', () => {
  assert.equal(normPostcode('e62ps'), 'E6 2PS');
  assert.equal(normPostcode('SW1E  5HJ'), 'SW1E 5HJ');
  assert.equal(findPostcode('Egerton Road, Twickenham, Greater London TW2 7SL'), 'TW2 7SL');
  assert.equal(nameSimilarity('St John Bosco College', 'Saint John Bosco College'), 1);
  assert.equal(nameSimilarity('Claremont High School Academy', 'Claremont High School'), 1);
  assert.ok(nameSimilarity("Haberdashers' Girls' School", "Haberdashers' Boys' School") < 0.75);
  assert.equal(htmlToText('<p>Maths&nbsp;&amp; <b>KS5</b></p><p>Next</p>'), 'Maths & KS5\nNext');
});

test('pay areas follow the 2026 pay document', () => {
  assert.equal(payAreaFor({ district: 'Newham', country: 'England' }), 'Inner London');
  assert.equal(payAreaFor({ district: 'Barking and Dagenham', country: 'England' }), 'Inner London');
  // Waltham Forest is Outer London for pay, although statistically inner.
  assert.equal(payAreaFor({ district: 'Waltham Forest', country: 'England' }), 'Outer London');
  assert.equal(payAreaFor({ district: 'Richmond upon Thames', country: 'England' }), 'Outer London');
  assert.equal(payAreaFor({ district: 'City of Westminster', country: 'England' }), 'Inner London');
  assert.equal(payAreaFor({ district: 'Crawley', country: 'England' }), 'Fringe');
  assert.equal(payAreaFor({ district: 'Guildford', country: 'England' }), 'Fringe');
  assert.equal(payAreaFor({ district: 'Brighton and Hove', country: 'England' }), 'Rest of England');
  assert.equal(payAreaFor({ district: 'Cardiff', country: 'Wales' }), 'Wales');
  assert.equal(payAreaFor({ district: 'Buckinghamshire', country: 'England' }), null);
});

test('areas: distance, membership, regions and far-away titles', () => {
  const brighton = PRESETS.find((p) => p.slug === 'brighton');
  const london = PRESETS.find((p) => p.slug === 'london');
  const cardiff = PRESETS.find((p) => p.slug === 'cardiff');
  assert.ok(Math.abs(miles(51.5072, -0.1276, 51.4816, -3.1791) - 131) < 3, 'London to Cardiff is about 131 miles');
  assert.ok(inArea(brighton, { lat: 50.8503, lon: -0.13714 }));
  assert.ok(!inArea(brighton, { lat: 51.109, lon: -0.187 }), 'Crawley is outside Brighton');
  assert.ok(inArea(london, { lat: 51.4, lon: -0.3, region: 'London' }));
  assert.ok(!inArea(london, { lat: 51.48, lon: -0.6, region: 'South East' }), 'London means Greater London');
  const regions = [
    { name: 'South West', bbox: [49.9, -6.4, 52.0, -1.5] },
    { name: 'Wales', bbox: [51.37, -5.3, 53.43, -2.65] },
    { name: 'London', bbox: [51.29, -0.51, 51.69, 0.31] },
  ];
  assert.deepEqual(regionsForArea(cardiff, regions).map((r) => r.name), ['South West', 'Wales']);
  assert.deepEqual(regionsForArea(london, regions).map((r) => r.name), ['London']);
  assert.ok(titleNamesFarPlace('Outreach Maths Teacher - Oldham', london));
  assert.ok(titleNamesFarPlace('Maths Teacher (Dubai)', brighton));
  assert.ok(!titleNamesFarPlace('Maths Teacher - Worthing', brighton));
  assert.ok(!titleNamesFarPlace('Teacher of Maths', cardiff));
});

test('jobs are matched to schools by URN, name or postcode', () => {
  const est = [
    { urn: '140373', name: 'Langdon Academy', postcode: 'E6 2PS', kind: 'state' },
    { urn: '101837', name: 'Whitgift School', postcode: 'CR2 6YT', kind: 'independent' },
    { urn: '143036', name: 'Overton Grange School', postcode: 'SM2 6TQ', kind: 'state' },
  ];
  const match = buildMatcher(est, [{ urn: '140373', name: 'Langdon Academy' }]);
  assert.equal(match({ urn: '140373', employer: '' }).school.urn, '140373');
  assert.equal(match({ employer: 'Whitgift School' }).establishment.kind, 'independent');
  assert.equal(match({ employer: 'Langdon Academy (Brampton Manor Trust)', postcode: 'E6 2PS' }).establishment.urn, '140373');
  // An agency advertising at a school's postcode is not that school.
  assert.equal(match({ employer: 'Test Teach', postcode: 'SM2 6TQ' }).establishment, null);
});
