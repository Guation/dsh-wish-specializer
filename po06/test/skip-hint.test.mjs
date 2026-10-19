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

test('跳过按钮：只有"双击跳过没开"且"没点过以后不再显示"时才弹', () => {
  assert.ok(CLIENT_SRC.includes('setSkipHint(true)'), '要能弹')
  assert.ok(/if \(!doubleEnterSkip && \(s\.skipHintDismissed !== true\)\) setSkipHint\(true\)/.test(CLIENT_SRC), '两个前置条件')
  assert.ok(CLIENT_SRC.includes('save({ skipHintDismissed: true })'), '以后不再显示要写设置')
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
