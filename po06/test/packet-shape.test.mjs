// 生效政策改变后，旧包文本必须作废。
//
// 包文本是**按当时政策编译好的一整段字符串**；政策变了它就过期。
// 这个文件钉住"什么算形状变了"，以及"两侧取不到时不许乱作废"。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packetShapeOf, packetShapeChanged } from '../lib/policy.js'

const P = (over) => Object.assign({ assist: 'auto', detail: 'standard', budget: 'standard' }, over)

test('形状只含辅助、补充程度、自主预算与英文模式', () => {
  // 英文模式也进形状：它决定注入文本的语言，语言换了旧包必须作废。
  assert.equal(packetShapeOf(P()), 'scaffold-directions-1|auto|standard|standard|original')
  assert.equal(packetShapeOf(P({ englishMode: true })), 'scaffold-directions-1|auto|standard|standard|en')
  assert.equal(packetShapeOf(null), '')
})

test('英文模式变了 ⇒ 旧包必须作废', () => {
  assert.equal(packetShapeChanged(P({ englishMode: true }), P({ englishMode: false })), true)
  assert.equal(packetShapeChanged(P({ englishMode: false }), P({ englishMode: true })), true)
})

test('旧 framing 不再改变包形状，缺失与任意旧值相同', () => {
  for (const framing of ['hard', 'neutral']) {
    assert.equal(packetShapeOf(P({ framing })), packetShapeOf(P()))
    assert.equal(packetShapeChanged(P({ framing }), P()), false)
    assert.equal(packetShapeChanged(P(), P({ framing })), false)
  }
})

test('档位/补充程度/辅助开关变了 ⇒ 形状也变', () => {
  assert.equal(packetShapeChanged(P({ assist: 'off' }), P()), true)
  assert.equal(packetShapeChanged(P({ detail: 'detailed' }), P()), true)
  assert.equal(packetShapeChanged(P({ budget: 'generous' }), P()), true)
})

test('形状没变 ⇒ 不作废（别把好好的包清掉）', () => {
  assert.equal(packetShapeChanged(P(), P()), false)
  assert.equal(packetShapeChanged(P({ englishMode: true }), P({ englishMode: true })), false)
})

test('两侧取不到 ⇒ 一律不作废（宁可漏作废，不要误清）', () => {
  assert.equal(packetShapeChanged(null, P()), false)
  assert.equal(packetShapeChanged(P(), null), false)
  assert.equal(packetShapeChanged(null, null), false)
})
