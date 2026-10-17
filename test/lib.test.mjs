import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseCSVObjects } from '../scripts/lib/csv.mjs';
import { osgbToLatLon } from '../scripts/lib/osgb.mjs';
import { nameSimilarity, normPostcode, findPostcode, htmlToText } from '../scripts/lib/text.mjs';
import { findBorough } from '../scripts/lib/london.mjs';
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

test('boroughs resolve to the right pay area', () => {
  assert.equal(findBorough('Newham').pay, 'Inner London');
  assert.equal(findBorough('Barking & Dagenham').pay, 'Inner London');
  assert.equal(findBorough('Richmond upon Thames').pay, 'Outer London');
  assert.equal(findBorough('City of Westminster').name, 'Westminster');
  assert.equal(findBorough('Surrey'), null);
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
