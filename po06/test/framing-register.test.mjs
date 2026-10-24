// 2026-10-23 用户要求：硬邦邦不是“多一段话”，而是**整段注入文换一种风格**。
// 这里钉住三件事：包头换、节标题换、neutral 一个都不变。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../lib/compiler.js'
import { framingLabels, framingToneHint } from '../lib/framing.js'

const state = { items: [
  { id: 'req-1', kind: 'user_requirement', text: '做个跑车', status: 'active', scope: 'turn', sourceRefs: [{ kind: 'human', sessionId: 's', messageId: 'm' }] },
  { id: 'unk-1', kind: 'unknown', text: '要不要联机', status: 'active', scope: 'turn', sourceRefs: [{ kind: 'human', sessionId: 's', messageId: 'm' }] },
] }

test('hard 时包头与节标题整段换，neutral 保持默认', () => {
  const neutral = compile(state, { budget: 1200, framing: 'neutral', language: 'zh' }).text
  const hard = compile(state, { budget: 1200, framing: 'hard', language: 'zh' }).text
  assert.ok(neutral.includes('插件辅助上下文'), '默认包头')
  assert.ok(neutral.includes('本轮原话摘录'), '默认节标题')
  assert.ok(hard.includes('插件加的说明'), 'hard 包头要换')
  assert.ok(hard.includes('这一轮的原话'), 'hard 节标题要换')
  assert.equal(hard.includes('本轮原话摘录'), false, 'hard 下不应残留默认标题')
})

test('hard 的骨架文案表与口吻提示存在，neutral 为空', () => {
  assert.equal(framingLabels('neutral'), null)
  assert.ok(framingLabels('hard').header)
  assert.equal(framingToneHint('neutral'), '')
  assert.ok(framingToneHint('hard').includes('命令式'))
})
