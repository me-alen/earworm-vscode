import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressText } from '../src/common';

test('progress bar text', () => {
  assert.deepEqual(progressText(83, 225), { text: '1:23 ━━━━────── 3:45', label: '1:23 of 3:45' });
  assert.equal(progressText(0, 59.9).text, '0:00 ────────── 0:59');
  assert.equal(progressText(3725, 3725).text, '62:05 ━━━━━━━━━━ 62:05');
});
