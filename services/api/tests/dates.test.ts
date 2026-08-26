/**
 * Unit tests for date parsing & normalization (§10.1 Unit layer).
 * Reminder accuracy target (>99%, §1.5) depends on these.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDates } from '../src/extraction/dates';

test('parses ISO format', () => {
  const d = findDates('valid till 2026-09-04 as per policy')[0];
  assert.equal(d.iso, '2026-09-04');
  assert.ok(d.confidence >= 0.95);
});

test('parses "26 Aug 2026" style', () => {
  const d = findDates('purchased on 14 Aug 2026 at TechMart')[0];
  assert.equal(d.iso, '2026-08-14');
});

test('parses "Aug 26, 2026" style', () => {
  const d = findDates('billed Aug 26, 2026')[0];
  assert.equal(d.iso, '2026-08-26');
});

test('parses DD/MM/YYYY (Indian convention)', () => {
  const d = findDates('due date: 30/08/2026')[0];
  assert.equal(d.iso, '2026-08-30');
});

test('swaps impossible MM/DD into DD/MM with lower confidence', () => {
  const d = findDates('dated 09/14/2026')[0]; // month 9, day 14 → must be MM/DD
  assert.equal(d.iso, '2026-09-14');
  assert.equal(d.confidence, 0.75);
});

test('rejects invalid calendar dates like 31 Feb', () => {
  const d = findDates('expiry 31/02/2026');
  // 31/02 invalid as DD/MM; swap makes month=31 invalid too → no match
  assert.equal(d.length, 0);
});

test('finds multiple dates in order with non-overlapping spans', () => {
  const ds = findDates('from 05 Sep 2026 to 04 Sep 2027');
  assert.equal(ds.length, 2);
  assert.equal(ds[0].iso, '2026-09-05');
  assert.equal(ds[1].iso, '2027-09-04');
  assert.ok(ds[0].span[1] <= ds[1].span[0]);
});

test('prefers higher-confidence ISO over numeric overlap', () => {
  const ds = findDates('date 2026-08-26');
  assert.equal(ds.length, 1);
  assert.equal(ds[0].confidence, 0.98);
});