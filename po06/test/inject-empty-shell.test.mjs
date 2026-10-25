import test from 'node:test'
import assert from 'node:assert/strict'
import { adapter as productionAdapter } from '../lib/index.js'

test('only the completed packet reaches working context; empty and failed runs remain empty', async () => {
  const adapter = new productionAdapter.constructor()
  adapter.services.agents = { get: () => ({}) }; adapter.policyNow = () => ({ advisor: false })
  const session = { id: 'no-shell' }
  const ready = await adapter.handleInput(session, { messageId: 'm1', text: 'A task', interpret: async () => ({ intent: { text: 'A task', relation: 'new' }, add: ['A useful direction.'] }) })
  assert.equal(ready.ok, true); assert.equal(adapter.getWorkingText(session.id), ready.packet.text)
  const empty = await adapter.handleInput(session, { messageId: 'm2', text: 'Thanks', interpret: async () => ({ intent: { text: 'Acknowledgment', relation: 'continue' } }) })
  assert.equal(empty.status, 'empty'); assert.equal(adapter.getWorkingText(session.id), '')
  const failed = await adapter.handleInput(session, { messageId: 'm3', text: 'Continue', interpret: async () => 'broken response' })
  assert.equal(failed.ok, false); assert.equal(adapter.getWorkingText(session.id), '')
})
