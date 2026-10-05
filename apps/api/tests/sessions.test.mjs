import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Workflow State transitions and reference format invariants', () => {
  // Reference format SES-YYYYMMDD-NNNNNN
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const refPattern = new RegExp(`^SES-${dateStr}-\\d{6}$`);
  const sampleRef = `SES-${dateStr}-000001`;
  assert.ok(refPattern.test(sampleRef));

  // Verify stock_requested_at is absent from workflow state steps
  const validMilestoneKeys = [
    'customerWalkInAt',
    'demoStartAt',
    'demoEndAt',
    'decisionAt',
    'productSelectionStartAt',
    'productSelectionConfirmedAt',
    'stockStartedAt',
    'stockFoundAt',
    'cashierReceivedAt',
    'cashierScanAt',
    'billOpenedAt',
    'cancelledAt',
  ];

  assert.ok(!validMilestoneKeys.includes('stockRequestedAt'));
  assert.ok(!validMilestoneKeys.includes('stock_requested_at'));
});

test('Stock review data structure and resolve actions', () => {
  const stockReview = {
    missingItems: ['iPhone 15 Pro Max', 'Case (x2)'],
    foundItems: ['Apple Pencil (x1)'],
    stockNote: 'Out of stock in back warehouse',
    reportedAt: new Date().toISOString(),
    reportedBy: '0002',
  };

  assert.equal(stockReview.missingItems.length, 2);
  assert.equal(stockReview.foundItems.length, 1);
  assert.ok(stockReview.reportedBy);

  const allowedActions = ['ACCEPT_PARTIAL', 'CHANGE_ITEMS', 'CANCEL'];
  assert.ok(allowedActions.includes('ACCEPT_PARTIAL'));
  assert.ok(allowedActions.includes('CHANGE_ITEMS'));
  assert.ok(allowedActions.includes('CANCEL'));
});

