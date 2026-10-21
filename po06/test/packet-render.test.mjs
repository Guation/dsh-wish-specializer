// Three advisory sections; the host sends the original request independently, unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket, sanitizeMachineText } from '../lib/optimizer-protocol.js'
const base = { intent: { text: '做一辆跑车', relation: 'continue' }, clarify: [], add: ['轮廓一眼优雅', '漆面在冷光下有层次'], ask: [] }

test('制作建议保留正文，使用适度权重，不重复用户原话或输出多余理解段', () => {
  const original = '做一个精细的跑车，能开'
  const text = renderOptimizerPacket(base, 'zh', { userText: original })
  assert.match(text, /^请优先考虑/)
  assert.match(text, /不覆盖用户明确要求/)
  assert.match(text, /【制作建议】\n1\. 轮廓一眼优雅/)
  assert.doesNotMatch(text, /机器理解|原话（逐字引用|本轮先做的动作/)
  assert.equal(text.includes(original), false)
  assert.equal(base.intent.text, '做一辆跑车')
})

test('编号保留有意义的条目，不按固定条数截断', () => {
  const many = Array.from({ length: 16 }, (_, i) => '方向' + (i + 1))
  const text = renderOptimizerPacket({ ...base, add: many }, 'zh')
  assert.match(text, /\n1\. 方向1\n/)
  assert.match(text, /\n16\. 方向16/)
  assert.equal((text.match(/^\d+\. /gm) || []).length, 16)
})

test('Ask独立提示工作模型调用工具并自行组织选项', () => {
  const text = renderOptimizerPacket({ ...base, ask: ['要展厅还是赛道？'] }, 'zh')
  assert.match(text, /【Ask用户\(ask_user_question\)】/)
  assert.match(text, /请调用 ask_user_question，自行组织合适的选项/)
  assert.ok(text.includes('要展厅还是赛道？'))
  assert.ok(text.indexOf('【制作建议】') < text.indexOf('【Ask用户'))
})

test('技术名词清洗仍只处理机器文本', () => {
  assert.equal(sanitizeMachineText('用 roughness 和 ambient occlusion 做出质感', 'zh'), '用表面质感和光影层次做出质感')
  assert.match(sanitizeMachineText('use roughness and ambient occlusion', 'en'), /surface feel and depth in the light/)
})

test('英文三段不夹中文，原话参数未被修改', () => {
  const opts = { userText: '做一个精细的跑车' }
  const text = renderOptimizerPacket({ ...base, add: ['轮廓一眼优雅', 'a low, heavy stance'], scaffold: ['comparable automatic feedback'], ask: ['Which setting?'] }, 'en', opts)
  assert.match(text, /\[Production suggestions\]/)
  assert.match(text, /\[Temporary scaffold suggestions\]/)
  assert.match(text, /\[Ask user \(ask_user_question\)\]/)
  assert.equal(opts.userText, '做一个精细的跑车')
  assert.equal(text.includes('轮廓一眼优雅'), false)
})

test('只有理解、无三类增量时不发空壳包', () => {
  assert.equal(renderOptimizerPacket({ intent: { text: 'ok' }, clarify: [], add: [], scaffold: [], ask: [] }), '')
})
