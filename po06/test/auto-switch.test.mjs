// 切会话期间跑完的那一轮（2026-10-19 真机 bug）：自动模式下原来会"优化自己消失、也没发出去"。
//
// 原因：完成回调在**当前**会话上执行 —— setHold 会写进当前会话的桥、inputActions.submit() 会提交当前草稿。
// 规则：发起会话 ≠ 当前会话时，只把结果写回**发起会话**的桥并标记 pendingAuto；回到该会话时再补发。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

test('完成回调要认账：结果写回发起会话的桥，不写进当前会话', () => {
  assert.ok(CLIENT_SRC.includes('const startSid = sessionId'), '发起时记住会话')
  assert.ok(CLIENT_SRC.includes('if (startSid !== liveSidRef.current || !isActiveInstance())'), '完成时对比当前会话/当前实例')
  assert.ok(CLIENT_SRC.includes('holdBridgeWrite(startSid, {') || CLIENT_SRC.includes('holdBridgeWrite(startSid,'), '写回发起会话')
  assert.ok(CLIENT_SRC.includes('pendingAuto: permissionRef.current !== \'review\''), '自动权限才标记待补发')
})

test('旧实例不许清桥（"优化自己消失"的真因）', () => {
  assert.ok(/if \(!isActiveInstance\(\)\) return/.test(CLIENT_SRC), 'setHold 里挡掉旧实例')
  assert.ok(CLIENT_SRC.includes('clearHoldSoon'), '注释里点明是哪条路径会清桥')
})

test('回到该会话时补发（自动权限），而不是让它消失', () => {
  assert.ok(CLIENT_SRC.includes("saved.pendingAuto === true"), '识别待补发')
  assert.ok(/inputActions\.setDraft\(text\); inputActions\.submit\(\)/.test(CLIENT_SRC), '补发：先回填再提交')
  assert.ok(CLIENT_SRC.includes("phase: 'sent', pendingAuto: false"), '标记已补发，避免重复提交')
})
