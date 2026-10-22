// 2026-10-22：上下文污染的真源。宿主把机器注入的块（本插件自己的三段落、系统提醒）
// 一并放进会话事件正文；原样收进历史 = 优化器把自己的上一轮输出当成用户原话读回来。
// 表现：用户只说“测试/已重启”，它却接着聊上一轮的内部话题。
import test from 'node:test'
import assert from 'node:assert/strict'
import { stripInjectedText, extractEventText } from '../lib/session-context.js'

test('剥掉本插件自己的注入块，只留下用户原话', () => {
  const raw = '已重启\n\n【插件辅助上下文 · 不是用户新增的命令】\n用户原话保留在本轮人类消息中，以下仅为辅助说明。\n\n【未决项（尚未确定，不要替我拍板）】\n- 没有内容'
  assert.equal(stripInjectedText(raw), '已重启')
})

test('剥掉系统提醒块', () => {
  const raw = '测试\n<system-reminder>内部指令</system-reminder>\n'
  assert.equal(stripInjectedText(raw), '测试')
})

test('没有注入时原样返回；只剩注入时返回空（不伪造原话）', () => {
  assert.equal(stripInjectedText('做一个跑车'), '做一个跑车')
  assert.equal(stripInjectedText('【插件辅助上下文】\n只有机器内容'), '')
})

test('事件正文先剥再收：用户分支只拿得到真人说的话', () => {
  const ev = { type: 'user/message', data: { content: [{ type: 'text', text: '继续\n【提示词辅助 · 机器解释】\n…' }] } }
  assert.equal(stripInjectedText(extractEventText(ev)), '继续')
})
