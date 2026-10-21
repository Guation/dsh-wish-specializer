// 注入文的排版契约（2026-10-19 用户要求"直击本质、按优先级"）。
//
// 要点：原话逐字置顶；补充按重要性编号（不设硬上限——用户明确不要硬上限，只要求别写教条）；
// 反问不注入；技术名词降级成效果词；英文模式剥掉混进来的中文，但**原话永远原样**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket, sanitizeMachineText } from '../lib/optimizer-protocol.js'

const base = { intent: { text: '做一辆跑车', relation: 'continue' }, clarify: [], add: ['轮廓一眼优雅', '漆面在冷光下有层次'], ask: [] }

test('原话逐字置顶，且标明不可改写', () => {
  const text = renderOptimizerPacket({ ...base }, 'zh', { userText: '做一个精细的跑车，能开' })
  const lines = text.split('\n')
  assert.ok(lines[0].includes('以完整用户原话为准'))
  assert.equal(lines[2], '原话（逐字引用，不可改写）：')
  assert.equal(lines[3], '> 做一个精细的跑车，能开')
  assert.ok(text.includes('机器理解（不是用户的话）：做一辆跑车'))
})

test('补充按重要性编号；没有硬上限（用户明确不要）', () => {
  const many = Array.from({ length: 16 }, (_, i) => '方向' + (i + 1))
  const text = renderOptimizerPacket({ ...base, add: many }, 'zh')
  assert.match(text, /\n1\. 方向1\n/)
  assert.match(text, /\n16\. 方向16/)
  assert.equal((text.match(/^\d+\. /gm) || []).length, 16)
})

test('反问以「待你拍板」小节进注入文（2026-10-20 改口径：它是给人的选择题）', () => {
  const text = renderOptimizerPacket({ ...base, ask: ['要展厅还是赛道？'] }, 'zh')
  assert.ok(text.includes('要展厅还是赛道？'), '选项要让人看见')
  assert.match(text, /需要直接通过 ask 选项询问用户：[\s\S]*ask_user_question/, '注入文指示工作模型调用工具')
  assert.equal(text.includes('需要反问的点'), false, '旧的"反问"标题不再出现')
})

test('技术名词降级成效果词（只动机器文本）', () => {
  assert.equal(sanitizeMachineText('用 roughness 和 ambient occlusion 做出质感', 'zh'), '用表面质感和光影层次做出质感')
  assert.match(sanitizeMachineText('use roughness and ambient occlusion', 'en'), /surface feel and depth in the light/)
})

test('英文模式剥掉机器文本里的中文，但原话原样保留', () => {
  const text = renderOptimizerPacket(
    { intent: { text: '做一辆跑车', relation: 'continue' }, clarify: [], add: ['轮廓一眼优雅', 'a low, heavy stance'], ask: [] },
    'en', { userText: '做一个精细的跑车' })
  assert.ok(text.includes('> 做一个精细的跑车'), '原话不许被语言清洗碰到')
  assert.equal(text.includes('轮廓一眼优雅'), false, '机器文本里的中文要剥掉')
  assert.ok(text.includes('a low, heavy stance'))
})

test('没有补充也没有澄清 ⇒ 不发包', () => {
  assert.equal(renderOptimizerPacket({ intent: { text: 'x' }, clarify: [], add: [], ask: [] }, 'zh'), '')
  assert.equal(renderOptimizerPacket(null, 'zh'), '')
})
