// 2026-10-23 真机：注入文里基调块出现**两遍**——编译器那条遗留路径自己加了一次，
// 包级换装又前置了一次。守卫：同一段文本里只能有一份。
import test from 'node:test'
import assert from 'node:assert/strict'
import { framingBlock, applyFramingToPacket } from '../lib/framing.js'

test('文本里已有基调块时不再前置', () => {
  const block = framingBlock('hard', null, 'zh')
  const already = block + '\n\n【要干的事】\n1. 先干这个'
  const out = applyFramingToPacket(already, 'hard', 'zh')
  const hits = out.split('【协作基调').length - 1
  assert.equal(hits, 1, '基调块只能出现一次')
})

test('没有基调块时照常前置一份', () => {
  const out = applyFramingToPacket('【要干的事】\n1. 先干这个', 'hard', 'zh')
  assert.equal(out.split('【协作基调').length - 1, 1)
})
