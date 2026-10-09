import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { escapeHtml, formatClock } from '../src/utils/dom.js';
import { buildExportSheets } from '../src/utils/leaderboard.js';

test('escapeHtml neutralises markup so names render as text', () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.equal(escapeHtml(`Tom & "Jerry's"`), 'Tom &amp; &quot;Jerry&#39;s&quot;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
  // Already-escaped input is escaped again, never "decoded" into something live.
  assert.equal(escapeHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
});

test('formatClock matches the in-game timer format', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(83.9), '01:23');
  assert.equal(formatClock(3599), '59:59');
  assert.equal(formatClock(3600), '60:00');
  for (const bad of [null, undefined, NaN, -1, Infinity, 'x']) assert.equal(formatClock(bad), '--:--', String(bad));
});

const participants = [
  { name: 'Slow', email: 'slow@example.com', status: 'finished', scanned: 10, time: 80.5, rank: 2, spotPrize: false, registeredAt: 1_700_000_000_000, finishedAt: 1_700_000_100_000 },
  { name: 'Quit', email: 'quit@example.com', status: 'abandoned', scanned: 4, time: null, rank: null, spotPrize: false, registeredAt: 1_700_000_050_000, finishedAt: null },
  { name: 'Fast', email: 'fast@example.com', status: 'finished', scanned: 10, time: 42.125, rank: 1, spotPrize: true, registeredAt: 1_700_000_060_000, finishedAt: 1_700_000_090_000 }
];

test('export: the leaderboard sheet is ranked, includes email, and keeps the original columns', () => {
  const { leaderboard } = buildExportSheets(participants);
  assert.deepEqual(
    leaderboard.map((row) => [row.Rank, row.Username, row.Email, row['Time (seconds)'], row['Spot Prize']]),
    [
      [1, 'Fast', 'fast@example.com', '42.13', 'Yes'],
      [2, 'Slow', 'slow@example.com', '80.50', '']
    ]
  );
  // The columns the old export had are all still there, with the same names.
  for (const column of ['Username', 'Time (seconds)', 'Date']) assert.ok(column in leaderboard[0], column);
});

test('export: the participants sheet lists everyone, including people who did not finish', () => {
  const { everyone } = buildExportSheets(participants);
  assert.deepEqual(
    everyone.map((row) => [row.Username, row.Status, row.Scanned, row['Time (seconds)']]),
    [
      ['Slow', 'finished', 10, '80.50'],
      ['Quit', 'abandoned', 4, ''],
      ['Fast', 'finished', 10, '42.13']
    ]
  );
});

test('export: produces a valid workbook that reads back with both sheets', () => {
  const { leaderboard, everyone } = buildExportSheets(participants);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(leaderboard), 'Leaderboard');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(everyone), 'All participants');

  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(reread.SheetNames, ['Leaderboard', 'All participants']);
  assert.equal(XLSX.utils.sheet_to_json(reread.Sheets.Leaderboard).length, 2);
  assert.equal(XLSX.utils.sheet_to_json(reread.Sheets['All participants']).length, 3);
});

test('export of an empty event is valid, not a crash', () => {
  const { leaderboard, everyone } = buildExportSheets([]);
  assert.deepEqual([leaderboard, everyone], [[], []]);
});
