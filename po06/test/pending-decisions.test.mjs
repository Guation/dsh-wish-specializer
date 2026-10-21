// 「待你拍板」结构化（2026-10-19 用户要求）：
//   ① 注入文里单独一节，列 1–3 个必须由用户决定的岔路 + 未定时假设；
//   ② 这些岔路要**真的问出来**（add_question），而不是只写在注入文里让执行者默认。
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket, parseOptimizerValue, composeOptimizerSystem } from '../lib/optimizer-protocol.js'
import { strategyForTier } from '../lib/strategy.js'

const optimizer = {
  intent: { text: '做一颗 O 型蓝超巨星', relation: 'new' },
  clarify: [],
  add: ['能量要守恒：中微子带走绝大部分，激波与辐射各占一份。'],
  decide: ['质量范围？｜15–25 M☉（中子星）/ 40–60 M☉（黑洞）｜未定时按 20 M☉、中子星结局'],
  ask: [],
}

test('注入文里出现「待你拍板」小节，并**明确要求模型去问用户**（带选项与未定假设）', () => {
  const text = renderOptimizerPacket(optimizer, 'zh', { userText: '做一颗 O 型蓝超巨星' })
  assert.ok(text.includes('需要直接通过 ask 选项询问用户'), '必须有独立小节（用户指定的句式）')
  // 真机 bug（2026-10-20）：只写"待你拍板"，模型当成背景信息直接开做，不会调提问工具。
  assert.ok(text.includes('ask_user_question'), '必须点名提问工具，模型才知道要问')
  assert.ok(/需要直接通过 ask 选项询问用户/.test(text), '用用户给的那句格式')
  assert.ok(text.includes('选项：15–25 M☉'), '选项单独一行，便于照抄')
  // 真机测试：给了"未定时假设"，模型就有理由不问。所以待拍板块里**不再展示**假设。
  assert.ok(!text.includes('未定时假设'), '待拍板块不再给默认退路')
  assert.ok(text.indexOf('需要直接通过 ask') > text.indexOf('正向补充'), '放在补充之后')
})

test('只有 decide 时也要发包（否则问题进不了界面）', () => {
  const only = { intent: { text: 'x', relation: 'new' }, clarify: [], add: [], decide: ['形态？｜A / B｜未定按 A'], ask: [] }
  const text = renderOptimizerPacket(only, 'zh', { userText: 'x' })
  assert.ok(text.includes('需要直接通过 ask 选项询问用户'))
})

test('decide 会变成带选项的提问（add_question）', () => {
  const r = parseOptimizerValue(optimizer, { sessionId: 's1', messageId: 'm1', baseRevision: 1, baseInputRevision: 1, causeId: 'c1' })
  assert.equal(r.ok, true)
  const qs = r.patch.ops.filter((o) => o.op === 'add_question')
  assert.equal(qs.length, 1, '一个 decide 对应一个问题')
  assert.ok(qs[0].question.text.includes('15–25 M☉'))
  assert.ok(qs[0].question.text.includes('未定时按 20 M☉'))
})

test('待拍板是条件式的：不许为了问而问', () => {
  const heavy = renderOptimizerPacket({ intent: { text: 'x', relation: 'new' }, clarify: [], add: ['a'], decide: [], ask: [] }, 'zh', { userText: 'x' })
  assert.ok(!heavy.includes('待你拍板'), '没有待拍板就不该出现这一节')
  const sys = composeOptimizerSystem({ strategy: strategyForTier('heavy') }).text
  assert.ok(sys.includes('只在真的缺信息时才问'), '重度档要写成条件式')
  assert.ok(!/必须给 1–3 条/.test(sys), '不许强制模型产出待拍板')
})
