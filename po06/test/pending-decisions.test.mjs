import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket, parseOptimizerValue, composeOptimizerSystem } from '../lib/optimizer-protocol.js'
const optimizer = { intent: { text: '做一颗 O 型蓝超巨星', relation: 'new' }, clarify: [], add: ['能量分配要自洽'],
  decide: [{ id: 'mass-range', question: '质量范围？', options: ['15–25 M☉（中子星）', '40–60 M☉（黑洞）'], assumption: '未定时按 20 M☉、中子星结局' }], ask: [] }

test('decide compatibility reads the explicit question and ignores option and assumption metadata', () => {
  const text = renderOptimizerPacket(optimizer, 'zh')
  assert.match(text, /【Ask用户\(ask_user_question\)】/)
  assert.match(text, /自行组织合适的选项/)
  assert.match(text, /1\. 质量范围？/)
  assert.doesNotMatch(text, /15–25|未定时按|已选：/)
})

test('只有Ask也正常发包，不需要伪造制作内容或脚手架', () => {
  const text = renderOptimizerPacket({ intent: { text: 'x', relation: 'new' }, ask: ['哪种形态更符合你的目标？'] })
  assert.match(text, /【Ask用户\(ask_user_question\)】/)
  assert.doesNotMatch(text, /【制作建议】|【临时脚手架建议】/)
})

test('旧decide保留原始问题数据，渲染不冒充已经询问或得到回答', () => {
  const r = parseOptimizerValue(optimizer)
  assert.equal(r.ok, true)
  assert.deepEqual(r.optimizer.decide, ['质量范围？'])
  assert.deepEqual(r.optimizer.sourceIds.decide, ['mass-range'])
  assert.equal(optimizer.decide[0].options.length, 2)
  assert.equal(r.patch, undefined)
  assert.equal(r.optimizer.decide[0].includes('15–25 M☉'), false)
  assert.doesNotMatch(renderOptimizerPacket(r.optimizer), /15–25|已选：/)
})

test('English Ask delegates options without assuming a default answer', () => {
  const text = renderOptimizerPacket({ intent: { text: 'Build a car', relation: 'new' }, ask: [{ question: 'Choose a silhouette?', options: ['Wedge', 'Long-nose GT'], assumption: 'Wedge' }] }, 'en')
  assert.match(text, /\[Ask user \(ask_user_question\)\]/)
  assert.match(text, /call ask_user_question with suitable options you organize yourself/)
  assert.doesNotMatch(text, /assumption:|Options: Wedge|选项：/)
})

test('literal pipe characters survive string, text and question entries in both Ask lists', () => {
  const question = 'Should the input keep a|b and c｜d intact?'
  const rows = [question, { id: 'literal', text: question, options: ['discard-option'], assumption: 'discard-assumption' }, { id: 'literal', question, options: ['discard-option'], assumption: 'discard-assumption' }]
  for (const field of ['ask', 'decide']) for (const row of rows) for (const language of ['zh', 'en']) {
    const raw = { intent: { text: 'Preserve input literals', relation: 'continue' }, [field]: [row] }
    const parsed = parseOptimizerValue(raw)
    assert.equal(parsed.ok, true); assert.deepEqual(parsed.optimizer[field], [question])
    for (const value of [raw, parsed.optimizer]) {
      const text = renderOptimizerPacket(value, language)
      assert.ok(text.includes(question)); assert.ok(!text.includes('discard-option')); assert.ok(!text.includes('discard-assumption'))
    }
  }
})

test('反问条件保持在思考契约中，不为了凑三段而提问', () => {
  const system = composeOptimizerSystem({tier:'heavy'}).text
  assert.match(system, /无法合理推断/)
  assert.match(system, /不为了问而问/)
  assert.match(system, /不必给选项或未定时假设/)
  assert.equal(renderOptimizerPacket({intent:{text:'x'},add:['有用建议'],ask:[]}).includes('ask_user_question'),false)
})
