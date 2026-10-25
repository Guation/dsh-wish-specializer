import test from 'node:test'
import assert from 'node:assert/strict'
import { framingBlock } from '../lib/framing.js'
import { renderOptimizerPacket } from '../lib/optimizer-protocol.js'

for (const language of ['zh', 'en']) test('repeated renders are deterministic and compose one block: ' + language, () => {
  const value = { add: [{ id: 'a', text: 'One useful direction.' }], hardNote: 'Same scope, more energy.', hardOn: ['a'] }
  const snapshot = structuredClone(value)
  const first = renderOptimizerPacket(value, language, { framing: 'hard' })
  const second = renderOptimizerPacket(value, language, { framing: 'hard' })
  const marker = framingBlock('hard', null, language).split(String.fromCharCode(10))[0]
  assert.equal(first, second); assert.equal(first.split(marker).length - 1, 1)
  assert.ok(first.endsWith(value.hardNote)); assert.deepEqual(value, snapshot)
})
