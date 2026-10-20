// 档位区分度（2026-10-19 用户）：不靠"写更多"，靠"把大概念发散到小概念"。
//
// 真机事实：重度/轻度的补充长度 686 vs 688 字、条数 7.1 vs 7.3 —— 档位在产物上不可区分。
// 新的区分轴是 subConcepts：轻度只给方向；标准关键 1-2 条带一个例子；重度每条都带例子。
// 同时守住两条纪律（用户同日追加）：关键决定不许写死；声明开放就不许按某形态写验收。
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeOptimizerSystem, buildOptimizerUserMessage } from '../lib/optimizer-protocol.js'
import { strategyForTier } from '../lib/strategy.js'

const sys = (tier, language = 'zh') => composeOptimizerSystem({ language, strategy: strategyForTier(tier) }).text

test('策略轴：轻度 / 标准 / 重度 在 subConcepts 上是三档', () => {
  assert.equal(strategyForTier('light').subConcepts, 'off')
  assert.equal(strategyForTier('standard').subConcepts, 'one')
  assert.equal(strategyForTier('heavy').subConcepts, 'rich')
})

test('重度要求每条带例子（——比如），轻度明确不展开子概念', () => {
  const heavy = sys('heavy')
  const light = sys('light')
  assert.ok(heavy.includes('——比如'), '重度必须给出例子格式')
  assert.ok(/每一条都必须带例子/.test(heavy), '重度要求逐条带例子')
  assert.ok(light.includes('不展开更小的子概念或例子'), '轻度明确不给子概念')
  assert.ok(!light.includes('——比如'), '轻度的提示词里不出现例子格式')
})

test('关键决定与自相矛盾两条纪律写进了核心', () => {
  for (const language of ['zh', 'en']) {
    const core = composeOptimizerSystem({ language, strategy: strategyForTier('standard') }).text
    assert.ok(/没说的关键决定不许写死|Never decide what the user left open/.test(core), '不许替用户写死未定的决定')
    assert.ok(/不许自相矛盾|No self-contradiction/.test(core), '声明开放就不许按某形态写验收')
  }
})

test('例子要求不引入配额（提示词里不出现"最多 N 条"式的输出配额）', () => {
  for (const tier of ['light', 'standard', 'heavy']) {
    const t = sys(tier)
    assert.ok(!/最多\s*\d+\s*条/.test(t), tier + ' 不该出现硬配额')
    assert.ok(!/At most\s*\d+\s*items/i.test(sys(tier, 'en')), tier + ' 不该出现英文硬配额')
  }
})

test('举例要求同时进用户消息（system 里那条实测被忽略）', () => {
  const um = JSON.parse(buildOptimizerUserMessage({ userText: 'x', styleHint: '每条以「——比如：A」结尾' }))
  assert.equal(um.styleHint, '每条以「——比如：A」结尾')
  const none = JSON.parse(buildOptimizerUserMessage({ userText: 'x' }))
  assert.equal(none.styleHint, undefined, '没有 hint 时不得出现该字段')
})
