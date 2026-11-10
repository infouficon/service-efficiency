import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWedgeReader, serialFromBarcode } from '../src/features/stock/scanning.ts';

test('only a serial or an IMEI is taken from an Apple box label (D108)', () => {
  assert.equal(serialFromBarcode('SC02XK1ABCD12'), 'SC02XK1ABCD12', 'Mac / iPad: "S" + the serial');
  assert.equal(serialFromBarcode(' sh7q2lp4xyz '), 'SH7Q2LP4XYZ', 'trimmed, upper case like the box');
  assert.equal(serialFromBarcode('356789012345672'), '356789012345672', 'IMEI: 15 digits with a valid check digit (D124)');
  assert.equal(serialFromBarcode('194253433309'), null, 'UPC');
  assert.equal(serialFromBarcode('1942534333091'), null, 'EAN');
  assert.equal(serialFromBarcode('89049032005008882600012345678901'), null, 'EID');
  assert.equal(serialFromBarcode('MHQL4TH/A'), null, 'part number');
  assert.equal(serialFromBarcode('ABC'), null, 'too short');
  assert.equal(serialFromBarcode('AB CD EF GH'), null, 'spaces');
});

test('a scanner typing without a focused box is told from a person (D108)', () => {
  const scans = [];
  const read = createWedgeReader((text) => scans.push(text));
  const type = (text, start, gap) => [...text].forEach((ch, i) => read(ch, start + i * gap));

  // a scanner: 8 ms apart, Shift before capitals, then Enter (swallowed)
  let t = 1000;
  for (const ch of 'SC02XK1ABCD') {
    read('Shift', t);
    read(ch, t + 1);
    t += 8;
  }
  assert.equal(read('Enter', t + 5), true);
  assert.deepEqual(scans, ['SC02XK1ABCD']);

  // a person: 180 ms apart, then Enter on a focused button: not swallowed
  type('ABCDEFGH', 5000, 180);
  assert.equal(read('Enter', 5000 + 8 * 180), false);

  // too short a burst (e.g. a quick "ok") is not a scan
  type('OK', 9000, 10);
  assert.equal(read('Enter', 9030), false);

  // a pause in the middle starts over: only the fast tail counts, and it is too short
  type('ABCDEF', 12000, 10);
  type('GH', 12500, 10);
  assert.equal(read('Enter', 12530), false);

  // an arrow or Tab breaks a burst
  type('ABCDEF', 15000, 10);
  read('Tab', 15065);
  type('GH', 15070, 10);
  assert.equal(read('Enter', 15095), false);
  assert.deepEqual(scans, ['SC02XK1ABCD']);
});

test('D124: an IMEI must be 15 digits with a valid check digit; the MEID and the UPC are not serials', async () => {
  const { serialProblem, luhnOk } = await import('../src/features/stock/scanning.ts');
  assert.equal(luhnOk('355713696420008'), true);
  assert.equal(serialProblem('355713696420008'), '', 'a real IMEI');
  assert.equal(serialProblem('SMG92W35604'), '', 'an Apple serial is not checked for digits');
  assert.match(serialProblem('35571369420008'), /MEID/, '14 digits = the MEID (2026-11-10: the iPhone FileMaker could not find)');
  assert.match(serialProblem('355713696420007'), /เลขตรวจ/, 'one digit wrong');
  assert.match(serialProblem('195951413723'), /12 หลัก/, 'the UPC');
  assert.equal(serialFromBarcode('355713696420007'), null, 'the camera ignores a misread IMEI');
  assert.equal(serialFromBarcode('355713696420008'), '355713696420008');
});
