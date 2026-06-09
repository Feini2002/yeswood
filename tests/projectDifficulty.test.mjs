import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_DIFFICULTY_RULES,
  scoreProjectDifficulty,
} from '../src/backend/projectDifficulty.mjs';

test('scoreProjectDifficulty combines matched director rules into adjusted workday score', () => {
  const project = {
    rawFields: {
      组别: { display: '直营新店' },
      店态: { display: '常规店' },
      店铺性质: { display: '新店' },
      面积: { display: '700㎡' },
      硬装项目进度: { display: '施工图' },
      软装项目进度: { display: '软装方案中' },
    },
    storeStatus: '常规店',
    businessType: '购物中心',
  };

  const difficulty = scoreProjectDifficulty(project);

  assert.equal(PROJECT_DIFFICULTY_RULES.length >= 13, true);
  assert.equal(difficulty.score, 46);
  assert.equal(difficulty.level, '难');
  assert.equal(difficulty.workdays, 46.2);
  assert.equal(difficulty.weight, 2.1);
  assert.equal(difficulty.hard.workdays, 27.3);
  assert.equal(difficulty.soft.workdays, 18.9);
  assert.deepEqual(
    difficulty.components.map((item) => item.ruleKey),
    ['direct-hard-regular', 'direct-soft-regular']
  );
});

test('scoreProjectDifficulty uses sinking-store standards and area factor for franchise hard projects', () => {
  const difficulty = scoreProjectDifficulty({
    rawFields: {
      组别: { display: '加盟新店' },
      店态: { display: '下沉店' },
      面积: { display: '400' },
      硬装项目进度: { display: '施工图' },
    },
    storeStatus: '下沉店',
  });

  assert.equal(difficulty.score, 18);
  assert.equal(difficulty.level, '中');
  assert.equal(difficulty.weight, 0.81);
  assert.deepEqual(
    difficulty.components.map((item) => item.ruleKey),
    ['franchise-hard-sinking']
  );
});

test('scoreProjectDifficulty ignores purchase-only workload for owner load', () => {
  const difficulty = scoreProjectDifficulty({
    rawFields: {
      组别: { display: '直营新店' },
      店态: { display: '常规店' },
      面积: { display: '700' },
      采购资料: { display: '已发出' },
    },
    storeStatus: '常规店',
  });

  assert.equal(difficulty.score, 0);
  assert.equal(difficulty.ignoredPurchase, true);
  assert.deepEqual(difficulty.components, []);
});

test('scoreProjectDifficulty treats sleep stores as hard-decoration-only even when soft fields are filled', () => {
  const difficulty = scoreProjectDifficulty({
    rawFields: {
      组别: { display: '加盟新店' },
      店态: { display: '睡眠店' },
      面积: { display: '500㎡' },
      硬装项目进度: { display: '施工图' },
      软装项目进度: { display: '点位待跟进' },
      VM组长: { display: '误填软装组长' },
      VM设计师: { display: '误填软装设计师' },
    },
    storeStatus: '睡眠店',
  });

  assert.equal(difficulty.storeTier, 'sleep');
  assert.equal(difficulty.score, 20);
  assert.equal(difficulty.soft.workdays, 0);
  assert.equal(difficulty.design.workdays, 0);
  assert.deepEqual(
    difficulty.components.map((item) => item.ruleKey),
    ['franchise-hard-regular']
  );
});

test('scoreProjectDifficulty reports no score when no work dimension can be inferred', () => {
  const difficulty = scoreProjectDifficulty({
    rawFields: {
      店态: { display: '常规店' },
      面积: { display: '700' },
    },
  });

  assert.equal(difficulty.score, 0);
  assert.equal(difficulty.level, '未判定');
  assert.deepEqual(difficulty.components, []);
});
