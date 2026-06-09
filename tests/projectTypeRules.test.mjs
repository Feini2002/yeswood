import assert from 'node:assert/strict';
import test from 'node:test';

import { isSleepHardDecorationClosed, isSleepStoreProject } from '../src/backend/projectTypeRules.mjs';

test('sleep store detection uses exact store status or explicit sleep-store project name only', () => {
  assert.equal(
    isSleepStoreProject({
      storeStatus: '睡眠店',
      rawFields: { 店态: { display: '睡眠店' } },
    }),
    true
  );
  assert.equal(
    isSleepStoreProject({
      name: '杭州远洋乐堤港睡眠店',
      storeStatus: '家居卖场',
      rawFields: { 店态: { display: '家居卖场' } },
    }),
    true
  );
  assert.equal(
    isSleepStoreProject({
      name: '普通睡眠体验项目',
      storeStatus: '家居卖场',
      rawFields: { 店态: { display: '家居卖场' } },
    }),
    false
  );
  assert.equal(
    isSleepStoreProject({
      name: '普通项目',
      businessType: '睡眠体验专区',
      rawFields: {
        店态: { display: '家居卖场' },
        组别: { display: '睡眠产品组' },
      },
    }),
    false
  );
});

test('sleep stores close when hard construction or construction-review stage is closed', () => {
  assert.equal(
    isSleepHardDecorationClosed({
      storeStatus: '睡眠店',
      rawFields: {
        店态: { display: '睡眠店' },
        硬装项目进度: { display: '施工闭环' },
      },
    }),
    true
  );
  assert.equal(
    isSleepHardDecorationClosed({
      storeStatus: '睡眠店',
      rawFields: {
        店态: { display: '睡眠店' },
        硬装项目进度: { display: '施工图审核通过' },
      },
    }),
    true
  );
  assert.equal(
    isSleepHardDecorationClosed({
      storeStatus: '睡眠店',
      rawFields: {
        店态: { display: '睡眠店' },
        硬装项目进度: { display: '施工图' },
      },
    }),
    false
  );
});
