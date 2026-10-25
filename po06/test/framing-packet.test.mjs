import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket } from '../lib/optimizer-protocol.js'
import { framingBlock, optimizerFramingLabels } from '../lib/framing.js'
const value = { intent: { text: 'Build a car', relation: 'new' }, add: ['Keep the proportions coherent.'], scaffold: ['Comparable feedback.'], ask: [{ question: 'Which setting?' }] }

for (const language of ['zh', 'en']) test('renderer selects final framing before writing any text: ' + language, () => {
  for (const framing of ['neutral', 'hard']) {
    const labels = optimizerFramingLabels(framing, language)
    const text = renderOptimizerPacket(value, language, { framing })
    assert.ok(text.includes(labels.introduction)); assert.ok(text.includes(labels.production)); assert.ok(text.includes(labels.scaffold))
    if (framing === 'hard') assert.ok(text.startsWith(framingBlock('hard', null, language)))
    else assert.ok(!text.includes(framingBlock('hard', null, language)))
    for (const advice of [value.add[0], value.scaffold[0], value.ask[0].question]) assert.ok(text.includes(advice))
  }
})

test('literal text matching a neutral heading is never post-replaced inside advice', () => {
  const advice = 'Keep the label [Production suggestions] and text 【制作建议】 in this explanation.'
  const text = renderOptimizerPacket({ ...value, add: [advice] }, 'en', { framing: 'hard' })
  assert.ok(text.includes(advice))
})
