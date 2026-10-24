// 2026-10-25 真机终极样本：包 370 字，结尾是
//   【没定的事（别替我拍板）】
//   - 这一轮没有从中提取到可执行内容（…）
// 这行以 “- ” 开头，把“有没有条目”的判据骗过去了 ⇒ 壳被当成内容注入。
import test from 'node:test'
import assert from 'node:assert/strict'
import { hasPayloadLines, stripPlaceholderNotice } from '../lib/framing.js'

const SHELL = [
  '【插件加的说明 · 不是用户新下的命令】',
  '',
  '【协作基调 · 硬邦邦（插件所加，不是用户的新要求）】',
  '老哥们，话我先撂这儿。',
  '',
  '【没定的事（别替我拍板）】',
  '- 这一轮没有从中提取到可执行内容（原话仍完整在本轮上下文里）。',
].join('\n')

test('占位说明不算条目：壳必须被判为空', () => {
  assert.equal(hasPayloadLines(SHELL), true, '直接看会被骗（这正是 bug 的形状）')
  assert.equal(hasPayloadLines(stripPlaceholderNotice(SHELL)), false, '剥掉占位后应为空')
})

test('真实未决项不会被误删', () => {
  const real = '【没定的事（别替我拍板）】\n- 要不要联机还没定'
  assert.equal(hasPayloadLines(stripPlaceholderNotice(real)), true)
  assert.ok(stripPlaceholderNotice(real).includes('联机'))
})
