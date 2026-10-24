// 英文模式 + 硬邦邦：应当是**英文的硬邦邦**，不是中文基调块混进英文骨架。
// 判据：块里没有中日韩字符；语域标记（称呼/催促）落在英文里；边界行仍在末尾。
import test from 'node:test'
import assert from 'node:assert/strict'
import { framingBlock, framingLabels } from '../lib/framing.js'

test('en + hard：整块是英文，且保留边界行', () => {
  const block = framingBlock('hard', null, 'en')
  assert.ok(block.includes('Alright lads'), '英文语域标记要在')
  assert.ok(block.trim().endsWith('keep the line.'), '边界行仍在末尾')
  assert.equal(/[\u4e00-\u9fff]/.test(block), false, '不能夹中文')
})

test('en + neutral：不注入任何基调块', () => {
  assert.equal(framingBlock('neutral', null, 'en'), '')
})

test('en + hard：包头与节标题也是英文', () => {
  const labels = framingLabels('hard', 'en')
  assert.ok(labels.header.includes('not new user commands'))
  assert.equal(/[\u4e00-\u9fff]/.test(Object.values(labels).join(' ')), false, '骨架文案不能夹中文')
})
