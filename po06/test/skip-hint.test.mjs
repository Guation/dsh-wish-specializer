// 跳过提示（2026-10-19 用户要求）与"对话一次后重新识别预设"。
//
// ① 点「跳过并直接发送」时，若双击跳过没开且没点过"以后不再显示"，弹一张提示卡；
// ② 更新设置项 skipHintDismissed（持久化）；
// ③ 会话里说过一轮之后，宿主重新问一次 sessionController，把真实预设记下来。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from '../lib/settings.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLIENT_SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const INDEX_SRC = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')

test('设置：skipHintDismissed 默认关、在白名单、可持久化', () => {
  assert.equal(DEFAULT_SETTINGS.skipHintDismissed, false, '默认要提示')
  assert.ok(SETTINGS_KEYS.includes('skipHintDismissed'), '必须在白名单里')
})

test('跳过按钮：开关开着也提示（默认开，新用户不知道），只被"以后不再显示"拦住', () => {
  assert.ok(CLIENT_SRC.includes('setSkipHint({ on: doubleEnterSkip })'), '要能弹，并带上当时的开关状态')
  assert.ok(/if \(s\.skipHintDismissed !== true\) setSkipHint\(/.test(CLIENT_SRC), '唯一的前置条件就是没点过以后不再显示')
  assert.equal(CLIENT_SRC.includes('!doubleEnterSkip &&'), false, '不再要求开关关闭')
  assert.ok(CLIENT_SRC.includes('save({ skipHintDismissed: true })'), '以后不再显示要写设置')
  // 文案按开关状态分岔（开着说"已开启，连按两次即可"；关着说"开启后可以"）
  assert.ok(CLIENT_SRC.includes('「双击 Enter 跳过」已开启'), '开着的文案')
  assert.ok(CLIENT_SRC.includes('开启「双击 Enter 跳过」后'), '关着的文案')
})

test('提示卡画在 body 上，两个出口都齐全', () => {
  assert.ok(CLIENT_SRC.includes("'data-po06', 'skip-hint'"), '卡片节点')
  assert.ok(CLIENT_SRC.includes('document.body.appendChild(el)'), 'body 级浮层')
  assert.ok(CLIENT_SRC.includes('skip-hint-ok') && CLIENT_SRC.includes('skip-hint-never'), '两个出口')
  assert.ok(CLIENT_SRC.includes('双击 Enter 来直接跳过优化'), '文案要说明怎么用')
})

test('对话一轮后重新识别预设（用户提议）', () => {
  assert.ok(INDEX_SRC.includes('async refreshSessionPreset(sid)'), '要有刷新入口')
  assert.ok(INDEX_SRC.includes('adapter.refreshSessionPreset(sid)'), '用户消息事件里要触发')
  assert.ok(/Date\.now\(\) - last < 4000/.test(INDEX_SRC), '节流，别每轮狂问')
})
