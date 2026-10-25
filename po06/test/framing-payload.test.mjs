import test from 'node:test'
import assert from 'node:assert/strict'
import { hasOptimizerContent, renderOptimizerPacket } from '../lib/optimizer-protocol.js'

test('content is measured from normalized fields rather than formatted list markers', () => {
  for (const row of ['ordinary prose', '【A literal heading】', '- literally starts with a dash', { id: 'a', text: 'No list marker needed.' }]) {
    const value = { add: [row] }
    assert.equal(hasOptimizerContent(value), true)
    const text = typeof row === 'string' ? row : row.text
    assert.ok(renderOptimizerPacket(value).includes(text))
  }
  for (const value of [{}, { add: ['', null, {}] }, { hardNote: 'Only a note' }]) {
    assert.equal(hasOptimizerContent(value), false); assert.equal(renderOptimizerPacket(value, 'zh', { framing: 'hard' }), '')
  }
})
