// 交付闸门（2026-10-20 重构 4/4）：证据决定交付，拿不到证据就问用户，不擅自死循环也不莫名交付。
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideDelivery, renderDeliveryGate } from '../lib/advisor-delivery-gate.js'
import { renderAdvisorVoice } from '../lib/advisor-voice.js'

const c = (criterion, status, extra = {}) => ({ criterion, status, ...extra })

test('全部 satisfied ⇒ 可以交付', () => {
  const d = decideDelivery({ checks: [c('轮廓比例', 'satisfied'), c('材质分区', 'satisfied')] })
  assert.equal(d.action, 'deliver')
  assert.match(renderDeliveryGate(d), /可以交付/)
})

test('有 failed ⇒ 先改，不许交付', () => {
  const d = decideDelivery({ checks: [c('轮廓比例', 'failed'), c('材质分区', 'satisfied')] })
  assert.equal(d.action, 'fix')
  assert.deepEqual(d.failed, ['轮廓比例'])
  assert.match(renderDeliveryGate(d), /还不能交付/)
})

test('unverified 且影响大 ⇒ 调 ask 问用户（带选项）', () => {
  const d = decideDelivery({ checks: [c('中微子能量分账', 'unverified', { impact: 'major' })] })
  assert.equal(d.action, 'ask')
  assert.ok(d.ask && Array.isArray(d.ask.options) && d.ask.options.length >= 2, '要带选项')
  assert.ok(d.ask.options.some((o) => o.value === 'accept'))
  assert.ok(d.ask.options.some((o) => o.value === 'fix'))
  assert.match(renderDeliveryGate(d), /先问用户/)
})

test('unverified 但影响小 ⇒ 标注后放行', () => {
  const d = decideDelivery({ checks: [c('远处尘埃密度', 'unverified')] })
  assert.equal(d.action, 'deliver-with-note')
  assert.match(renderDeliveryGate(d), /可以交付.*标注/)
})

test('缺省不把 unknown 升级成阻塞（默认 minor）', () => {
  const d = decideDelivery({ checks: [c('背景星点密度', 'unverified', { severity: 'minor' })] })
  assert.equal(d.action, 'deliver-with-note')
})

test('渲染进顾问块：证据齐全时带"可以交付"，有 failed 时带"还不能交付"', () => {
  const ok = renderAdvisorVoice({ verdict: 'pass', summary: '现在证据齐了，可以收口。', checks: [c('轮廓', 'satisfied')] })
  assert.match(ok, /可以交付/)
  const bad = renderAdvisorVoice({ verdict: 'gaps', summary: '现在轮廓还是玩具感。', checks: [c('轮廓', 'failed')] })
  assert.match(bad, /还不能交付/)
})

test('没有 checks 时按 verdict 兜底：unverified ⇒ 问用户，gaps ⇒ 先改', () => {
  const ask = decideDelivery({ verdict: 'unverified', checks: [] })
  assert.equal(ask.action, 'ask')
  const fix = decideDelivery({ verdict: 'gaps', checks: [] })
  assert.equal(fix.action, 'fix')
  const ok = decideDelivery({ verdict: 'pass', checks: [] })
  assert.equal(ok.action, 'deliver')
})

test('ask 的选项要真的渲染出来（模型照着问，不自己编）', () => {
  const d = decideDelivery({ checks: [c('材质分区', 'unverified', { impact: 'major' })] })
  const text = renderDeliveryGate(d)
  assert.match(text, /接受风险/)
  assert.match(text, /先补证据|先去补证据|先补证/)
  assert.match(text, /口径/)
})
