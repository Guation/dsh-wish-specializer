// 2026-10-25 真机：优化跑了很久，注入的只有 250 字的壳（包头 + 基调块），零条目。
// 判据不能是“字符串非空”，得是“有没有真正的条目行”。
import test from 'node:test'
import assert from 'node:assert/strict'
import { hasPayloadLines } from '../lib/framing.js'

test('只有壳/包头 ⇒ 不算有内容', () => {
  assert.equal(hasPayloadLines(''), false)
  assert.equal(hasPayloadLines('【插件加的说明 · 不是用户新下的命令】'), false)
  assert.equal(hasPayloadLines('【要干的事】\n'), false, '标题下面没有条目')
  assert.equal(hasPayloadLines('- '), false, '空条目')
})

test('有条目行 ⇒ 算有内容（中英、编号、星号都认）', () => {
  assert.equal(hasPayloadLines('【要干的事】\n- 先把比例立住'), true)
  assert.equal(hasPayloadLines('1. Lock the shader first'), true)
  assert.equal(hasPayloadLines('* something'), true)
})
