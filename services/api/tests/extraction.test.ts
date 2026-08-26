/**
 * Extraction accuracy tests (§10.1 Document layer; §10.2 evaluation approach).
 * Uses realistic synthetic documents (never real user data in tests).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/extraction/classifier';
import { buildContext, extractFields } from '../src/extraction/extractors';

const INVOICE = `TechMart Electronics Pvt Ltd
Tax Invoice
Invoice No: TM-2026-08112
Date of Purchase: 14 Aug 2026

Item: MacBook Air M3 13-inch
Qty: 1
Total Amount: Rs. 92,900.00
Order ID: 5539021188

Returns accepted within 10 days of delivery.
Manufacturer warranty of 24 months from date of purchase.`;

const POLICY = `HDFC ERGO General Insurance
Private Car Package Policy
Policy No: 2312-3456-7890-1234
Insured Name: Test User
Period of Insurance: From 05 Sep 2026 to 04 Sep 2027
Premium Amount: Rs. 18,540.00`;

const SUBSCRIPTION = `StreamFlix India
Subscription Invoice
Merchant: StreamFlix
Plan: Premium Monthly Plan
Amount: Rs. 649.00
Renewal Date: 02 Sep 2026
Auto-debit mandate active.`;

const BILL = `BSES Rajdhani Power Limited
Electricity Bill - Domestic
Consumer No: 1234-5678-9012
Amount Due: Rs. 2,340.00
Due Date: 30 Aug 2026`;

function fieldsOf(text: string): Map<string, string> {
  const { category } = classify(text);
  const ctx = buildContext(text);
  const map = new Map<string, string>();
  for (const f of extractFields(category, ctx)) map.set(f.field, f.normalizedValue ?? f.value);
  return map;
}

test('classifies invoice as purchase_invoice', () => {
  assert.equal(classify(INVOICE).category, 'purchase_invoice');
});

test('extracts invoice core fields (UC-001)', () => {
  const m = fieldsOf(INVOICE);
  assert.equal(m.get('purchase_date'), '2026-08-14');
  assert.equal(m.get('price_amount'), 'INR:92900');
  assert.equal(m.get('return_window_days'), '10');
  assert.equal(m.get('warranty_duration_months'), '24');
  assert.ok(m.get('order_id')?.includes('5539021188'));
});

test('extracts insurance policy dates and premium', () => {
  assert.equal(classify(POLICY).category, 'insurance');
  const m = fieldsOf(POLICY);
  assert.equal(m.get('start_date'), '2026-09-05');
  assert.equal(m.get('end_date'), '2027-09-04');
  assert.equal(m.get('premium_amount'), 'INR:18540');
});

test('extracts subscription cadence and renewal (UC-004)', () => {
  assert.equal(classify(SUBSCRIPTION).category, 'subscription');
  const m = fieldsOf(SUBSCRIPTION);
  assert.equal(m.get('cadence'), 'monthly');
  assert.equal(m.get('renewal_date'), '2026-09-02');
  assert.equal(m.get('amount'), 'INR:649');
});

test('extracts bill due date and amount (UC-012)', () => {
  assert.equal(classify(BILL).category, 'bills');
  const m = fieldsOf(BILL);
  assert.equal(m.get('due_date'), '2026-08-30');
  assert.equal(m.get('amount_due'), 'INR:2340');
  // §7.2 highly sensitive: account numbers stored masked
  const acct = m.get('account_number') ?? '';
  assert.ok(acct.includes('*'), 'account number should be masked');
});

test('every extracted field carries provenance span within text bounds', () => {
  const { category } = classify(POLICY);
  for (const f of extractFields(category, buildContext(POLICY))) {
    assert.ok(f.span[0] >= 0 && f.span[1] <= POLICY.length, `span out of bounds for ${f.field}`);
    assert.ok(f.confidence > 0 && f.confidence <= 1);
  }
});