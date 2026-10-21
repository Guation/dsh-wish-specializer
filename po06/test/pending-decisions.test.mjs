import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket, parseOptimizerValue, composeOptimizerSystem } from '../lib/optimizer-protocol.js'
const optimizer = { intent: { text: '做一颗 O 型蓝超巨星', relation: 'new' }, clarify: [], add: ['能量分配要自洽'],
  decide: ['质量范围？｜15–25 M☉（中子星）/ 40–60 M☉（黑洞）｜未定时按 20 M☉、中子星结局'], ask: [] }

test('旧decide只渲染问题，新格式交给工作模型思考选项', () => {
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

test('旧decide仍能保存问题状态，渲染并不冒充已经询问或得到回答', () => {
  const r = parseOptimizerValue(optimizer, { sessionId: 's1', messageId: 'm1', baseRevision: 1, baseInputRevision: 1, causeId: 'c1' })
  assert.equal(r.ok, true)
  const questions = r.patch.ops.filter(o => o.op === 'add_question')
  assert.equal(questions.length, 1)
  assert.equal(questions[0].question.status, 'proposed')
  assert.ok(questions[0].question.text.includes('15–25 M☉'))
})

test('English Ask delegates options without assuming a default answer', () => {
  const text = renderOptimizerPacket({ intent: { text: 'Build a car', relation: 'new' }, ask: ['Choose a silhouette? | Wedge / Long-nose GT | assumption: Wedge'] }, 'en')
  assert.match(text, /\[Ask user \(ask_user_question\)\]/)
  assert.match(text, /call ask_user_question with suitable options you organize yourself/)
  assert.doesNotMatch(text, /assumption:|Options: Wedge|选项：/)
})

test('反问条件保持在思考契约中，不为了凑三段而提问', () => {
  const system = composeOptimizerSystem({tier:'heavy'}).text
  assert.match(system, /无法合理推断/)
  assert.match(system, /不为了问而问/)
  assert.match(system, /不必给选项或未定时假设/)
  assert.equal(renderOptimizerPacket({intent:{text:'x'},add:['有用建议'],ask:[]}).includes('ask_user_question'),false)
})
