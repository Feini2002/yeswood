import test from 'node:test';
import assert from 'node:assert/strict';

import { isTerminalProjectStatus, readProjectStatusFromRawFields } from '../src/backend/projectStatus.mjs';

const PROJECT_STATUS_FIELD = '\u9879\u76ee\u72b6\u6001';
const COMPLETE_STATUS = '\u5b8c\u6210';
const CANCELED_STATUS = '\u53d6\u6d88';
const PENDING_COMPLETE_CONFIRMATION = '\u5f85\u5b8c\u6210\u786e\u8ba4';

test('readProjectStatusFromRawFields reads exact and normalized-exact status fields', () => {
  assert.equal(readProjectStatusFromRawFields({ [PROJECT_STATUS_FIELD]: COMPLETE_STATUS }), COMPLETE_STATUS);
  assert.equal(
    readProjectStatusFromRawFields({ [` ${PROJECT_STATUS_FIELD} `]: { display: COMPLETE_STATUS } }),
    COMPLETE_STATUS
  );
});

test('readProjectStatusFromRawFields falls back when normalized field matches are ambiguous', () => {
  const rawFields = {
    [` ${PROJECT_STATUS_FIELD} `]: { display: COMPLETE_STATUS },
    [`\t${PROJECT_STATUS_FIELD}\t`]: { display: CANCELED_STATUS },
  };

  assert.equal(readProjectStatusFromRawFields(rawFields, PENDING_COMPLETE_CONFIRMATION), PENDING_COMPLETE_CONFIRMATION);
});

test('isTerminalProjectStatus uses exact lifecycle status matching', () => {
  assert.equal(isTerminalProjectStatus(COMPLETE_STATUS), false);
  assert.equal(isTerminalProjectStatus('已完成'), false);
  assert.equal(isTerminalProjectStatus(CANCELED_STATUS), true);
  assert.equal(isTerminalProjectStatus('已取消'), true);
  assert.equal(isTerminalProjectStatus('关闭'), true);
  assert.equal(isTerminalProjectStatus('已关闭'), true);
  assert.equal(isTerminalProjectStatus(PENDING_COMPLETE_CONFIRMATION), false);
});
