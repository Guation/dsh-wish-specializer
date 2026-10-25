import test from 'node:test'
import assert from 'node:assert/strict'
import { handleUserInput } from '../lib/pipeline.js'
import { renderOptimizerPacket } from '../lib/optimizer-protocol.js'

test('an old compiler placeholder cannot supply content for a new v3 result', async () => {
  const adapter = { intentStateOf: () => ({ items: [{ kind: 'unknown', text: '这一轮没有从中提取到可执行内容（原话仍完整在本轮上下文里）。' }] }) }
  const out = await handleUserInput(adapter, { id: 's' }, { messageId: 'm', text: '继续', interpret: async () => ({ intent: { text: 'Continue', relation: 'continue' }, add: [] }) })
  assert.equal(out.ok, true); assert.equal(out.status, 'empty'); assert.equal(out.packet.text, '')
})

test('model prose is not silently stripped because it mentions an old placeholder phrase', () => {
  const advice = '检查“这一轮没有从中提取到可执行内容”的错误归因，保留可诊断信息。'
  assert.ok(renderOptimizerPacket({ add: [advice] }).includes(advice))
})
