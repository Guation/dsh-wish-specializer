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

test('设置：默认**开**、在白名单里、非布尔值回落为默认', () => {
  // 2026-10-19 用户改口径：这个开关改为默认开（双击仍然只是"跳过一次"，不会误发）。
  assert.equal(DEFAULT_SETTINGS.doubleEnterSkip, true, '默认必须是开')
  assert.ok(SETTINGS_KEYS.includes('doubleEnterSkip'), '必须进白名单，否则写不进设置')
  assert.equal(normalizeSettings({ doubleEnterSkip: true }).settings.doubleEnterSkip, true)
  const bad = normalizeSettings({ doubleEnterSkip: 'yes' })
  assert.equal(bad.settings.doubleEnterSkip, true, '非布尔值回落默认（现在是开）')
  assert.ok(bad.problems.some((p) => p.key === 'doubleEnterSkip'), '要如实报告这一项被回落')
})

test('界面：开关在「内置 Bash」与「详情」之间', () => {
  const bashAt = CLIENT_SRC.indexOf("'data-po06': 'bash'")
  const desAt = CLIENT_SRC.indexOf("'data-po06': 'double-enter'")
  const detailAt = CLIENT_SRC.indexOf("'data-po06': 'detail'")
  assert.ok(bashAt > 0 && desAt > 0 && detailAt > 0, '三个控件都要在')
  assert.ok(bashAt < desAt && desAt < detailAt, '顺序必须是 bash → 双击 Enter → 详情')
  // 2026-10-19：设置行改成「左标签 + 右状态值」两段式（设计感），冒号没了
  assert.ok(CLIENT_SRC.includes("L('双击 Enter 跳过', 'Double Enter skip')"), '按钮文案')
  assert.ok(CLIENT_SRC.includes('optVal(desKnown && doubleEnterSkip)'), '状态值用主题色')
  assert.ok(CLIENT_SRC.includes("save({ doubleEnterSkip: !doubleEnterSkip })"), '点击要保存设置')
})

test('行为：600ms 内的第二次 Enter 放弃本轮优化、按原文发出', () => {
  const at = CLIENT_SRC.indexOf("markSeen('key:intercepted')")
  assert.ok(at > 0, '找不到 Enter 拦截入口')
  // 2026-10-19：回车路径上多了"预设闸门"那一段（先问宿主再决定要不要优化），窗口放宽。
  const body = CLIENT_SRC.slice(at, at + 1800)
  assert.ok(/enterAtRef/.test(body), '要记录上一次 Enter 时间')
  assert.ok(/now - prevAt < 600/.test(body), '判定窗口 600ms')
  // 2026-10-19 起：优化中=跳过；审查完成=确认发送（两条分支，判据都在 held.phase 上）
  assert.ok(/if \(held\.phase === 'optimizing'\)/.test(body), '优化中才允许双击跳过')
  // 2026-10-23 用户实测更正：双击 Enter **永远是跳过**，review 相位也一样——
  // 旧规则“审查完成双击=确认”会让“想跳过的人”反而把包发出去（陀螺会话实录）。
  assert.ok(/if \(held\.phase === 'review'\)[\s\S]{0,120}skipHold/.test(CLIENT_SRC), 'review 时双击也走 skipHold')
  assert.ok(/skipHold\(\)/.test(body), '跳过走与面板「跳过」同一个函数（不发包）')
  assert.ok(/desRef\.current/.test(body), '设置默认关，必须读当前值')
})

test('审查完成态：双击 Enter 也是跳过（2026-10-23 更正）', () => {
  // 用户的动作意图只有一个：双击 = 这轮别要、按原文发。
  // 旧规则“审查完成双击=确认”会把包发出去，正是陀螺会话里“跳过了还被注入”的来源。
  assert.equal(CLIENT_SRC.includes("markSeen('key:double-confirm')"), false, '不再有“双击=确认”的分支')
  assert.equal(/if \(held\.phase === 'review'\)[\s\S]{0,140}confirmHold/.test(CLIENT_SRC), false, 'review 时不能再调 confirmHold')
  assert.ok(/if \(held\.phase === 'review'\)[\s\S]{0,140}skipHold/.test(CLIENT_SRC), 'review 时也要走 skipHold')
})
