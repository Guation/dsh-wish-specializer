import test from 'node:test'
import assert from 'node:assert/strict'
import { handleUserInput } from '../lib/pipeline.js'

test('a valid empty result stays empty even when old state contains requirements and framing', async () => {
  const state = { items: [{ kind: 'user_requirement', text: 'old tank requirement' }], revision: 20 }
  const adapter = { intentStateOf: () => state, framing: 'hard', language: 'en', setIntentText() { throw new Error('publication belongs to parent') } }
  const out = await handleUserInput(adapter, { id: 's' }, { messageId: 'm', text: 'Thanks', interpret: async () => ({ intent: { text: 'Acknowledgment', relation: 'continue' }, hardNote: 'old shell must not appear' }) })
  assert.equal(out.ok, true); assert.equal(out.status, 'empty'); assert.equal(out.packet.text, '')
  assert.equal(state.revision, 20); assert.equal(state.items.length, 1)
})
