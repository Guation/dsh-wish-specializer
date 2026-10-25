import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket } from '../lib/optimizer-protocol.js'
const base = { intent: { text: '做一辆跑车', relation: 'continue' }, add: ['轮廓一眼优雅', '漆面在冷光下有层次'] }

test('renderer preserves advice and leaves the independent user request with the host', () => {
  const original = '做一个精细的跑车，能开'
  const text = renderOptimizerPacket(base, 'zh', { userText: original })
  assert.match(text, /^请优先考虑/); assert.match(text, /不覆盖用户明确要求/)
  assert.ok(text.includes('【制作建议】' + String.fromCharCode(10) + '1. 轮廓一眼优雅'))
  assert.equal(text.includes(original), false); assert.equal(base.intent.text, '做一辆跑车')
})

test('all meaningful entries and their technical wording survive in either language', () => {
  const advice = ['用 roughness 和 ambient occlusion 做出质感。', 'Keep PBR, shaders and AO.', '8. This number is part of the model text.']
  for (const language of ['zh', 'en']) {
    const text = renderOptimizerPacket({ ...base, add: advice }, language)
    for (const row of advice) assert.ok(text.includes(row))
  }
})

test('Ask delegates real questions without replacing the supplied question text', () => {
  const question = '要展厅还是赛道？ / Which setting?'
  const text = renderOptimizerPacket({ ...base, ask: [{ question }] })
  assert.match(text, /请调用 ask_user_question，自行组织合适的选项/)
  assert.ok(text.includes(question)); assert.ok(text.indexOf('【制作建议】') < text.indexOf('【Ask用户'))
})

test('numbering never truncates long lists or deduplicates distinct source entries', () => {
  const rows = Array.from({ length: 16 }, (_, i) => '方向' + (i + 1))
  rows.push(rows[0])
  const text = renderOptimizerPacket({ ...base, add: rows })
  assert.ok(text.includes('16. 方向16')); assert.ok(text.includes('17. 方向1'))
})

test('intent and pep talk without advice render as empty in every framing', () => {
  for (const language of ['zh', 'en']) for (const framing of ['neutral', 'hard'])
    assert.equal(renderOptimizerPacket({ intent: { text: 'ok' }, add: [], hardNote: 'Only a note.' }, language, { framing }), '')
})
