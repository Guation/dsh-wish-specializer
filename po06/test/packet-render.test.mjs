import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket, hasOptimizerContent, normalizeOptimizerValue, parseOptimizerValue, composeOptimizerSystem, OPTIMIZER_OPTIONS } from '../lib/optimizer-protocol.js'
import { handleUserInput } from '../lib/pipeline.js'
import { prepareEnglishInterpretation, resolveEnglishInterpretation, createEnglishMode } from '../lib/english-mode.js'
import * as englishPrompts from '../lib/english-prompts.js'
import * as interpreter from '../lib/interpreter.js'
import { compileAudited } from '../lib/compiler.js'
const base = { intent: { text: '做一辆跑车', relation: 'continue' }, add: ['轮廓一眼优雅', '漆面在冷光下有层次'] }

test('renderer preserves advice and leaves the independent user request with the host', () => {
  const original = '做一个精细的跑车，能开'
  const text = renderOptimizerPacket(base, 'zh')
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

test('content depends on useful prose and empty results stay truly empty', () => {
  for (const row of ['ordinary prose', '【A literal heading】', '- literally starts with a dash', { id: 'a', text: 'No list marker needed.' }]) {
    assert.equal(hasOptimizerContent({ add: [row] }), true)
    assert.ok(renderOptimizerPacket({ add: [row] }).includes(typeof row === 'string' ? row : row.text))
  }
  for (const value of [{}, { intent: { text: 'ok' } }, { add: ['', null, {}] }]) {
    assert.equal(hasOptimizerContent(value), false)
    for (const language of ['zh', 'en']) assert.equal(renderOptimizerPacket(value, language), '')
  }
})

for (const language of ['zh', 'en']) test('ordinary labels and complete advice render once without mutating input: ' + language, () => {
  const advice = 'Keep the literal [Production suggestions] and text 【制作建议】 in this explanation.'
  const value = { ...base, add: [{ id: 'a', text: advice }], scaffold: ['Comparable feedback.'], ask: [{ question: 'Which setting?' }] }
  const before = structuredClone(value), text = renderOptimizerPacket(value, language)
  assert.equal(text, renderOptimizerPacket(value, language)); assert.deepEqual(value, before)
  const introduction = language === 'en' ? 'Give these goal-focused suggestions' : '请优先考虑'
  const production = language === 'en' ? '[Production suggestions]' : '【制作建议】'
  const scaffold = language === 'en' ? '[Temporary scaffold suggestions]' : '【临时脚手架建议】'
  assert.ok(text.startsWith(introduction)); assert.equal(text.split(introduction).length, 2)
  assert.ok(text.includes(production + '\n1. ' + advice)); assert.ok(text.includes(scaffold + '\n1. Comparable feedback.'))
  assert.ok(text.includes('Which setting?')); assert.equal(text.indexOf(scaffold) > text.indexOf(production), true)
})

test('retired metadata cannot enter current prompts, canonical packets or English repair', async () => {
  const retiredText = '老哥们，咱们是肌肉集团；旧字段不能变成指令。'
  const retired = { framing: 'hard', framingNote: retiredText, hardTone: retiredText, hardNote: retiredText, hardOn: ['a1'] }
  const forbidden = /framing|hardNote|hardOn|hardTone|HARD_NOTE|硬邦邦|肌肉集团|Alright lads|Straight-talk|muscle crew/
  const source = { version: '3', intent: { text: 'Build a car.', relation: 'new' }, englishTask: 'Build a car.', add: [{ id: 'a1', text: 'Coherent proportions.' }], scaffold: ['Comparable feedback.'], ask: ['Which setting?'] }
  const acceptedKeys = ['version', 'intent', 'englishTask', 'clarify', 'add', 'scaffold', 'ask', 'decide', 'sourceIds'].sort()
  const legacy = { englishTask: source.englishTask, ops: [], understanding: { summary: 'Build a car.', relation: 'new', action: 'execute' }, support: { mode: 'none' } }
  for (const language of ['zh', 'en']) {
    const ordinary = composeOptimizerSystem({ language }), supplied = composeOptimizerSystem({ language, ...retired })
    assert.deepEqual(supplied, ordinary); assert.doesNotMatch(supplied.text, forbidden)
    assert.deepEqual(Object.keys(OPTIMIZER_OPTIONS[language]).sort(), ['english', 'tools'])
    const value = { ...source, ...retired }, before = structuredClone(value)
    const normalized = normalizeOptimizerValue(value).value
    assert.deepEqual(Object.keys(normalized).sort(), acceptedKeys); assert.doesNotMatch(JSON.stringify(normalized), forbidden)
    const parsed = parseOptimizerValue(value)
    assert.equal(parsed.ok, true); assert.doesNotMatch(JSON.stringify(parsed), forbidden)
    const packet = renderOptimizerPacket(parsed.optimizer, language)
    assert.equal(packet, renderOptimizerPacket(source, language)); assert.equal(packet, renderOptimizerPacket(value, language, retired))
    assert.doesNotMatch(packet, forbidden)
    const out = await handleUserInput(retired, { id: 'retired-metadata' }, { messageId: language, text: source.intent.text, language, policy: { ...retired, englishMode: language === 'en' }, interpret: async () => value })
    assert.equal(out.packet.text, packet); assert.doesNotMatch(JSON.stringify(out), forbidden)
    for (const intent of [source.intent, source.intent.text]) {
      const ready = prepareEnglishInterpretation({ ...value, intent, relation: 'new' }, source.intent.text)
      assert.deepEqual(Object.keys(ready.value).sort(), acceptedKeys); assert.deepEqual(ready.value.intent, source.intent)
      assert.doesNotMatch(JSON.stringify(ready.value), forbidden)
    }
    const oldUtility = interpreter.parseInterpreterOutput(JSON.stringify({ ...legacy, ...retired }), { userText: source.intent.text, sessionId: 's', messageId: 'm', baseRevision: 0, baseInputRevision: 0 })
    assert.equal(oldUtility.ok, true); assert.doesNotMatch(JSON.stringify(oldUtility), forbidden)
    const state = { items: [{ id: 'req', kind: 'user_requirement', text: source.intent.text, status: 'active', sourceRefs: [{ kind: 'human', sessionId: 's', messageId: 'm' }] }] }
    assert.deepEqual(compileAudited(state, { language, ...retired }), compileAudited(state, { language }))
    assert.equal(compileAudited({ items: [] }, { language, ...retired }).text, '')
    assert.deepEqual(value, before)
  }
  assert.equal(Object.hasOwn(englishPrompts, 'EN_HARD_NOTE'), false)
  for (const name of ['HARD_NOTE_SYSTEM', 'HARD_NOTE_SYSTEM_PROMPT']) assert.equal(Object.hasOwn(interpreter, name), false)
  assert.doesNotMatch(JSON.stringify(prepareEnglishInterpretation({ ...legacy, ...retired }, source.intent.text).value), forbidden)
  const requestSource = { ...source, ...retired, add: [{ id: 'a1', text: '制作方向。' }] }, requests = []
  const service = createEnglishMode(), cfg = { provider: 'test', model: 'test' }
  const llm = { stream: async function* (options) {
    requests.push(options)
    const text = JSON.stringify({ translations: { 'add[0]': 'A coherent result.' } })
    yield { type: 'text-delta', text }; yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  let forwarded
  const resolved = await resolveEnglishInterpretation({ value: requestSource, originalText: source.intent.text, cfg, llm,
    service: { translateInterpretation: async (value, original, options) => { forwarded = value; return service.translateInterpretation(value, original, options) } } })
  assert.equal(resolved.ok, true); assert.doesNotMatch(JSON.stringify(forwarded), forbidden)
  assert.equal(requests.length, 1); assert.doesNotMatch(JSON.stringify(requests), forbidden)
  assert.deepEqual(JSON.parse(requests[0].messages[0].content[0].text), { texts: [{ id: 'add[0]', text: '制作方向。' }] })
  assert.deepEqual(resolved.value.add, ['A coherent result.']); assert.deepEqual(resolved.value.sourceIds, { add: ['a1'] })
  assert.doesNotMatch(JSON.stringify(resolved.value), forbidden)
  const cached = await service.translateInterpretation(requestSource, source.intent.text, { cfg, llm })
  assert.equal(cached.cached, true); assert.equal(requests.length, 1); assert.doesNotMatch(JSON.stringify(cached.value), forbidden)
  for (const language of ['zh', 'en']) assert.equal(renderOptimizerPacket({ intent: source.intent, ...retired }, language), '')
})
