// 「双击 Enter 跳过优化」（2026-10-19）。
//
// 语义：开着时，第一次 Enter 正常拦截并开始解释；600ms 内的第二次 Enter = 放弃本轮解释、
// 按原文立即发出（与面板「跳过」同一语义：不发包、不出注入卡片）。
// 默认关：不改变任何人的现有手感。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, SETTINGS_KEYS, normalizeSettings } from '../lib/settings.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLIENT_SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

test('设置：默认关、在白名单里、非布尔值回落为关', () => {
  assert.equal(DEFAULT_SETTINGS.doubleEnterSkip, false, '默认必须是关')
  assert.ok(SETTINGS_KEYS.includes('doubleEnterSkip'), '必须进白名单，否则写不进设置')
  assert.equal(normalizeSettings({ doubleEnterSkip: true }).settings.doubleEnterSkip, true)
  const bad = normalizeSettings({ doubleEnterSkip: 'yes' })
  assert.equal(bad.settings.doubleEnterSkip, false, '非布尔值回落默认')
  assert.ok(bad.problems.some((p) => p.key === 'doubleEnterSkip'), '要如实报告这一项被回落')
})

test('界面：开关在「内置 Bash」与「详情」之间', () => {
  const bashAt = CLIENT_SRC.indexOf("'data-po06': 'bash'")
  const desAt = CLIENT_SRC.indexOf("'data-po06': 'double-enter'")
  const detailAt = CLIENT_SRC.indexOf("'data-po06': 'detail'")
  assert.ok(bashAt > 0 && desAt > 0 && detailAt > 0, '三个控件都要在')
  assert.ok(bashAt < desAt && desAt < detailAt, '顺序必须是 bash → 双击 Enter → 详情')
  assert.ok(CLIENT_SRC.includes('双击 Enter 跳过:'), '按钮文案')
  assert.ok(CLIENT_SRC.includes("save({ doubleEnterSkip: !doubleEnterSkip })"), '点击要保存设置')
})

test('行为：600ms 内的第二次 Enter 放弃本轮优化、按原文发出', () => {
  const at = CLIENT_SRC.indexOf("markSeen('key:intercepted')")
  assert.ok(at > 0, '找不到 Enter 拦截入口')
  const body = CLIENT_SRC.slice(at, at + 900)
  assert.ok(/enterAtRef/.test(body), '要记录上一次 Enter 时间')
  assert.ok(/now - prevAt < 600/.test(body), '判定窗口 600ms')
  assert.ok(/holdRef\.current\.phase === 'optimizing'/.test(body), '只有正在优化时才允许双击跳过')
  assert.ok(/skipHold\(\)/.test(body), '跳过走与面板「跳过」同一个函数（不发包）')
  assert.ok(/desRef\.current/.test(body), '设置默认关，必须读当前值')
})
