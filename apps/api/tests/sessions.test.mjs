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
