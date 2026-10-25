import test from 'node:test'
import assert from 'node:assert/strict'
import { handleUserInput } from '../lib/pipeline.js'
import { parseOptimizerValue, renderOptimizerPacket } from '../lib/optimizer-protocol.js'
import { normalizeHardNote, HARD_NOTE_MAX } from '../lib/framing.js'
const note = 'Big energy, same task and same user choices.'
const value = (over = {}) => ({ intent: { text: 'Improve this result', relation: 'continue' }, add: [{ id: 'a1', text: 'Coherent proportions.' }], hardNote: note, hardOn: ['a1'], ...over })

for (const language of ['zh', 'en']) test('current source IDs admit the note at the very end: ' + language, () => {
  const parsed = parseOptimizerValue(value())
  const text = renderOptimizerPacket(parsed.optimizer, language, { framing: 'hard' })
  assert.ok(text.endsWith(note)); assert.equal(text.split(note).length - 1, 1)
  assert.ok(text.indexOf('Coherent proportions.') < text.indexOf(note))
})

test('optional citations may be absent; invalid citations suppress only the note', () => {
  const uncited = renderOptimizerPacket(parseOptimizerValue(value({ hardOn: [] })).optimizer, 'en', { framing: 'hard' })
  assert.ok(uncited.endsWith(note))
  const invalid = parseOptimizerValue(value({ hardOn: ['not-in-this-response'] }))
  assert.equal(invalid.ok, true); assert.ok(invalid.warnings.some(w => w.includes('unknown suggestion IDs')))
  const text = renderOptimizerPacket(invalid.optimizer, 'en', { framing: 'hard' })
  assert.ok(text.includes('Coherent proportions.')); assert.equal(text.includes(note), false)
  assert.equal(renderOptimizerPacket(parseOptimizerValue(value()).optimizer, 'en').includes(note), false)
})

test('empty, pathological and note-only results cannot manufacture a packet', () => {
  assert.equal(normalizeHardNote('  a\n\n\n\nb  '), 'a\n\nb')
  assert.equal(normalizeHardNote('x'.repeat(HARD_NOTE_MAX + 1)), '')
  assert.equal(renderOptimizerPacket(value({ add: [] }), 'en', { framing: 'hard' }), '')
})

test('a note never leaks from a previous pipeline result', async () => {
  const adapter = { framing: 'hard' }, session = { id: 's' }
  const first = await handleUserInput(adapter, session, { messageId: 'm1', text: 'task', interpret: async () => value() })
  assert.ok(first.packet.text.endsWith(note))
  const second = await handleUserInput(adapter, session, { messageId: 'm2', text: 'continue', interpret: async () => value({ hardNote: undefined, hardOn: undefined }) })
  assert.equal(second.ok, true); assert.ok(second.packet.text.includes('Coherent proportions.'))
  assert.equal(second.packet.text.includes(note), false)
})
