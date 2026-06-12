import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

const RULEBOOK_PATH = join(root, 'docs', 'rules', 'operational-rulebook.md');
const DASHBOARD_METRICS_CONTRACT_PATH = join(root, 'docs', 'contracts', 'dashboard-metrics.md');
const DATA_AUTHORITY_CONTRACT_PATH = join(root, 'docs', 'contracts', 'data-authority.md');

test('operational rulebook keeps key sections and executable rule references', async () => {
  const rulebook = await readFile(RULEBOOK_PATH, 'utf8');

  assert.match(rulebook, /^# 规则一览与延期提醒规则/m);
  assert.match(rulebook, /运营背景/);
  assert.match(rulebook, /公司项目阶段口径/);
  assert.match(rulebook, /公司阶段判定和真实项目完成判定/);
  assert.match(rulebook, /延期状态优先级/);
  assert.match(rulebook, /钉钉表单填写的延期情况优先/);
  assert.match(rulebook, /硬装提醒规则/);
  assert.match(rulebook, /复尺时间 Y/);
  assert.match(rulebook, /中国日历工作日/);
  assert.match(rulebook, /src\/backend\/hardDecorationDeadlineRules\.mjs/);
  assert.match(rulebook, /HARD_DECORATION_DEADLINE_MATRIX/);
  assert.match(rulebook, /data\/rules\/china-workday-calendar-2026\.json/);
  assert.match(rulebook, /面积与店态 Deadline 矩阵/);
  assert.match(rulebook, /面积 <= 300/);
  assert.match(rulebook, /超体店：2000㎡以上（暂按1500～2000㎡）/);
  assert.match(rulebook, /平面方案效率判断/);
  assert.match(rulebook, /延期完成但效率OK/);
  assert.match(rulebook, /软装提醒规则/);
  assert.match(rulebook, /摆场提醒规则/);
  assert.match(rulebook, /产品清单发出时间.*产品清单接收时间.*流程记录：产品清单接收时间/);
  assert.match(rulebook, /产品清单已接收.*首页采购推进分组/);
  assert.match(rulebook, /采购时间.*采购中.*待采购完成/);
  assert.match(rulebook, /采购完成情况.*采购情况.*已完成.*待采购.*待摆场/);
  assert.match(rulebook, /采购时间.*不等同采购完成/);
  assert.match(rulebook, /摆场开始时间.*进入“摆场中”/);
  assert.match(rulebook, /摆场文件发出时间.*默认摆场结束/);
  assert.match(rulebook, /软装完成情况.*漏填.*主提醒不得停在“待软装完成情况”/);
  assert.match(rulebook, /下游节点已经发生时，不能因为上游字段漏填而卡回早期提醒/);
  assert.match(rulebook, /小组页待处理 Top5 队列规则/);
  assert.match(rulebook, /teamWorkCompletionReview\.mjs/);
  assert.match(rulebook, /商场交付时间/);
  assert.doesNotMatch(rulebook, /300 <= 面积 < 450/);
  assert.doesNotMatch(rulebook, /2000 平方米以上项目暂不在本矩阵内/);
  assert.doesNotMatch(rulebook, /2000 平方米以上项目是否新增面积档/);
  assert.doesNotMatch(rulebook, /不再使用紧急程度判定|不再使用紧急判定/);
  assert.doesNotMatch(rulebook, /项目判断/);
  assert.doesNotMatch(rulebook, /\| [^|\n]* \| 紧急 \|/);
});

test('metrics and data authority contracts keep unified product-list and display aliases', async () => {
  const [metricsContract, dataAuthorityContract] = await Promise.all([
    readFile(DASHBOARD_METRICS_CONTRACT_PATH, 'utf8'),
    readFile(DATA_AUTHORITY_CONTRACT_PATH, 'utf8'),
  ]);

  for (const doc of [metricsContract, dataAuthorityContract]) {
    assert.match(doc, /产品清单发出时间.*产品清单接收时间.*流程记录：产品清单接收时间/);
    assert.match(doc, /摆场文件发出时间\(项目群）.*摆场文件发出时间（项目群）/);
    assert.doesNotMatch(doc, /产品清单.*不推动首页主流程阶段/);
  }
  assert.match(metricsContract, /采购时间在本月.*采购推进.*采购中.*不等同采购完成/);
  assert.match(dataAuthorityContract, /采购时间.*采购中.*采购完成情况.*采购情况.*已完成.*采购完成/);
  assert.match(dataAuthorityContract, /优先于软装项目进度仍写待采购/);
});

test('summary docs link to the rulebook instead of copying full rule text', async () => {
  const [docsIndex, rootContext, readme] = await Promise.all([
    readFile(join(root, 'docs', 'README.md'), 'utf8'),
    readFile(join(root, '公司情况与业务环境.md'), 'utf8'),
    readFile(join(root, 'README.md'), 'utf8'),
  ]);

  for (const doc of [docsIndex, rootContext, readme]) {
    assert.match(doc, /rules\/operational-rulebook\.md/);
  }

  assert.match(docsIndex, /运营规则正文/);
  assert.match(rootContext, /规则一览/);
  assert.match(readme, /规则一览/);
  assert.match(rootContext, /Deadline/);
  assert.doesNotMatch(readme, /mini店：≤300㎡ \| Y \+ 1/);
  assert.doesNotMatch(readme, /杨锦帆（硬装）/);
});

test('AGENTS documents layered rule governance and test scope', async () => {
  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');

  assert.match(agents, /docs\/rules\/operational-rulebook\.md/);
  assert.match(agents, /hardDecorationDeadlineRules\.mjs/);
  assert.match(agents, /rulesDocs\.test\.mjs/);
  assert.match(agents, /hardDecorationDeadlineRules\.test\.mjs/);
  assert.match(agents, /钉钉表单已填写延期情况时优先采用表单/);
  assert.match(agents, /规则冲突/);
  assert.match(agents, /先向用户确认|先确认/);
  assert.doesNotMatch(agents, /同步修改根目录业务说明文档/);
});

test('frontend developer docs page keeps operational rules entry and summaries', async () => {
  const publicIndex = await readFile(join(root, 'public', 'index.html'), 'utf8');

  assert.match(publicIndex, /id="developer-docs"/);
  assert.doesNotMatch(publicIndex, /id="rules" data-page="rules"/);
  assert.match(publicIndex, /延期提醒规则/);
  assert.match(publicIndex, /硬装 \/ 软装 \/ 摆场/);
  assert.match(publicIndex, /采购时间只表示采购中.*采购完成情况已完成才进入待摆场/);
  assert.match(publicIndex, /面积与店态 Deadline 矩阵/);
  assert.match(publicIndex, /负责人责任身份与数据通道/);
  assert.match(publicIndex, /待核对通道/);
  assert.match(publicIndex, /紧急 \/ 非紧急待处理 Top5/);
  assert.match(publicIndex, /人工标记紧急/);
  assert.match(publicIndex, /窗口天数升序/);
  assert.doesNotMatch(publicIndex, /不再使用紧急程度判定|不再使用紧急判定/);
  assert.doesNotMatch(publicIndex, /<span>紧急<\/span>/);
});
