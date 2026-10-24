// 2026-10-25 用户定稿 B 方案：自动模式**等包落库再发**；跳过发送仍然是无包（立即发）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('自动放行前会等包', () => {
  assert.ok(src.includes('const waitForPacket = async'), '要有等包函数')
  assert.ok(/if \(!String\(done\.packet \|\| ''\)\.trim\(\)\)/.test(src), '没包才等')
  assert.ok(src.includes('await waitForPacket(startSid)'), '等的是发起那一轮的会话')
})

test('等包期间被跳过/取消 ⇒ 本轮作废（不许把旧结果发出去）', () => {
  assert.ok(/if \(my !== holdSeq\.current\) return\s+\/\/ 等包期间被跳过/.test(src), '世代号校验')
})

test('跳过发送不等包（它就是无包）', () => {
  const skip = src.slice(src.indexOf('const skipHold'), src.indexOf('const skipHold') + 1200)
  assert.ok(skip.includes("/inference-cancel") || skip.includes("'/packet'"), '跳过要清包')
  assert.equal(skip.includes('waitForPacket'), false, '跳过不等包')
})
