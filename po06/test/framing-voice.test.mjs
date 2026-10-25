import test from 'node:test'
import assert from 'node:assert/strict'
import { composeOptimizerSystem, OPTIMIZER_FORMAT, OPTIMIZER_OPTIONS, renderOptimizerPacket } from '../lib/optimizer-protocol.js'
import { framingToneHint } from '../lib/framing.js'

for (const language of ['zh', 'en']) test('the selected expressive style is explicit and shares the model/render contract: ' + language, () => {
  const neutral = composeOptimizerSystem({ language })
  const hard = composeOptimizerSystem({ language, framing: 'hard' })
  assert.equal(neutral.parts.some(part => part.key === 'tone'), false)
  assert.equal(hard.parts.filter(part => part.key === 'tone').length, 1)
  assert.equal(OPTIMIZER_OPTIONS[language].hardTone, framingToneHint('hard', language))
  assert.ok(hard.text.includes(OPTIMIZER_OPTIONS[language].hardTone))
  assert.ok(hard.text.includes(OPTIMIZER_FORMAT[language]))
  const advice = 'Keep scope and unresolved choices intact.'
  const raw = { add: [advice] }, snapshot = structuredClone(raw)
  for (const framing of ['neutral', 'hard']) assert.ok(renderOptimizerPacket(raw, language, { framing }).includes(advice))
  assert.deepEqual(raw, snapshot)
})
