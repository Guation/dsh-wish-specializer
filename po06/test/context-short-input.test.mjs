// 2026-10-22 真机：用户只发“测试”两个字，优化器却输出“采集端/脚手架/证据”这类内容——
// 因为上下文把上几轮的助手长文也带了进去，模型把“上一轮在讨论什么”当成了这一轮的任务。
// 本文件钉住修好后的两条纪律：默认不含助手全文；本轮输入很短时不注入助手正文。
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderObserverBlock } from '../lib/session-context.js'

const longAssistant = '这是一段很长的助手分析。'.repeat(300)
const turns = [
  { user: '帮我做个跑车', assistant: longAssistant },
  { user: '测试', assistant: '这是最后一条助手回复'.repeat(50) },
]

test('默认不把助手全文塞进上下文：上限是 600 字', () => {
  const r = renderObserverBlock({ mode: 'turns', turns: 2, available: turns })
  assert.ok(r.text.length < longAssistant.length, '不能整段带上助手长文')
  assert.match(r.text, /助手回复每条只留 600 字/)
})

test('本轮输入极短 ⇒ 助手正文一律不注入，只列用户原话', () => {
  const r = renderObserverBlock({ mode: 'turns', turns: 2, available: turns, shortInput: true })
  assert.match(r.text, /本轮输入很短/)
  assert.equal(r.text.includes('这是最后一条助手回复'), false, '助手正文不得出现')
  assert.ok(r.text.includes('测试'), '用户原话仍在')
})

test('正常长度的输入不受影响：仍按 600 字带助手回复', () => {
  const r = renderObserverBlock({ mode: 'turns', turns: 2, available: turns, shortInput: false })
  assert.equal(r.text.includes('这是最后一条助手回复'), true)
})
