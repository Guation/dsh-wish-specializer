// 端到端契约（2026-10-20 重构验收）：走**真正注册的那条链路**（createAdvisor + execute），
// 用假 LLM 喂 report，检查模型实际拿到的 directive 是不是新形态。
//
// 注意范围：报告里的 checks 在没有材料时会被上游的证据评估过滤掉，所以"交付判断"的四种分支
// 由 advisor-delivery-gate 的单测覆盖；这里只钉住**链路可达**与**两段式形态**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdvisor } from '../lib/advisor.js'

const streamOf = (text) => (async function* () { yield { type: 'text-delta', text } })()
const human = (text) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const session = { id: 's1', snapshotEvents: () => [human('做一个单文件的主战坦克演示')] }
const exec = { agent: { session } }

const fixture = (reportValue) => createAdvisor({
  resolveRuntime: async () => ({
    ok: true,
    cfg: { provider: 'p', model: 'optimizer', reasoningEffort: 'high' },
    readTools: false,
    llm: { stream: () => streamOf(JSON.stringify(reportValue)) },
  }),
})

test('入口归一并随结果返回：entry=verify 内部走 review_result', async () => {
  const out = await fixture({ verdict: 'pass', summary: '现在证据齐了，可以收口。', findings: [], checks: [] })({ entry: 'verify', question: '核验' }, exec)
  assert.equal(out.ok, true)
  assert.equal(out.entry, 'verify', '入口要能被调用方看到')
  assert.equal(out.mode, 'review_result', '内部仍按入口映射到 mode')
})

test('旧调用只传 mode 也能落到同一入口', async () => {
  const out = await fixture({ verdict: 'pass', summary: '证据齐全。', findings: [], checks: [] })({ mode: 'review_result', question: '核验' }, exec)
  assert.equal(out.ok, true)
  assert.equal(out.entry, 'verify')
})

test('directive 是两段式，并带上交付判断', async () => {
  const out = await fixture({ verdict: 'pass', summary: '现在证据齐了，是因为三条都有可定位证据，所以可以收口。', findings: [], checks: [] })({ entry: 'verify', question: '核验' }, exec)
  const d = String(out.directive || '')
  assert.ok(d.includes('【顾问的理解】'), '有理解段')
  assert.ok(d.includes('【交付判断】'), '有交付判断行')
  assert.ok(!d.includes('【顾问指令'), '旧的"顾问指令 · 必须执行"不再出现')
  assert.ok(!d.includes('必须修'), '不再用祈使前缀')
})
