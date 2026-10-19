// 预设提示（2026-10-19 用户要求）：非 Wish / PTC 预设时提示切换，两个出口。
//
// 判据：只在"装了本插件、但当前会话不是 wish/ptc"时出现；"以后不再显示"必须真的持久化。
// 这里钉住四处：设置的默认值与白名单、宿主的记录条件、控制面路由、客户端弹窗的两个按钮。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from '../lib/settings.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const INDEX_SRC = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const CLIENT_SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const API_SRC = readFileSync(join(ROOT, 'lib', 'control-api.js'), 'utf8')

test('设置：默认显示，且是一个持久设置项（以后不再显示 = 写进设置）', () => {
  assert.equal(DEFAULT_SETTINGS.presetNoticeDismissed, false, '默认要提示')
  assert.ok(SETTINGS_KEYS.includes('presetNoticeDismissed'), '必须在白名单里，否则写不进设置')
})

test('宿主：只在非 wish/ptc 时记录，且尊重"以后不再显示"', () => {
  assert.ok(/notePresetNotice\(sid, preset\)/.test(INDEX_SRC), '要有记录入口')
  const at = INDEX_SRC.indexOf('notePresetNotice(sid, preset)')
  const ctx = INDEX_SRC.slice(Math.max(0, at - 700), at)
  assert.ok(ctx.includes("preset !== 'wish'"), 'wish 不提示')
  assert.ok(ctx.includes("preset !== 'ptc'"), 'ptc 不提示')
  assert.ok(ctx.includes('presetNoticeDismissed === true'), '关掉之后不再记录')
  assert.ok(/agentPreset/.test(ctx), '预设要从会话头读（宿主字段，不猜）')
})

test('pending 只对本会话/近期无会话的选择生效（否则所有会话都被判成同一个预设）', () => {
  // 2026-10-19 真机：pending 无条件优先 ⇒ 每个会话都判成 standard，疯狂弹窗
  assert.ok(API_SRC.includes('pendingForMe'), '要有归属判定')
  assert.ok(API_SRC.includes("String(pending.sid || '') === sid"), '同一会话里选的才算')
  assert.ok(API_SRC.includes('recent10'), '只认 10 分钟内的选择')
  assert.ok(API_SRC.includes('sessionFirstSeen'), '新会话要靠"首次出现时间晚于选择"认出来')
  assert.ok(/seenAt\) > Number\(pending\.at/.test(API_SRC), '比较的是时间先后')
  assert.ok(API_SRC.includes('clearPresetPending'), '消费口仍然保留（无会话时的那条路径）')
})

test('控制面：GET /notice 与 POST /notice（forever 写设置）', () => {
  assert.ok(API_SRC.includes("API_PREFIX + '/notice'"), '要有 /notice 路由')
  assert.ok(/getNotice\s*=\s*null/.test(API_SRC) && /clearNotice\s*=\s*null/.test(API_SRC) && /clearNotices\s*=\s*null/.test(API_SRC), '三个注入点都在')
  assert.ok(API_SRC.includes('presetNoticeDismissed: true'), 'forever 要写持久设置')
  assert.ok(/clearNotices\(\)/.test(API_SRC), 'forever 后要清掉所有会话的提示')
  assert.ok(/getNotice: \(p\) => adapter\.getPresetNotice/.test(INDEX_SRC), '宿主要把读取口接上')
})

test('回车闸门的口径：只有非 Wish 且非 PTC 才提醒（用户 2026-10-19 确认）', () => {
  const line = API_SRC.split('\n').find((l) => l.includes('const notice = preset &&'))
  assert.ok(line, '要有 notice 判据')
  assert.ok(line.includes("preset !== 'wish'"), 'Wish 不提示（它本身就是推荐态）')
  assert.ok(line.includes("preset !== 'ptc'"), 'PTC 也不提示')
  assert.ok(line.includes('!dismissed'), '点过「以后不再显示」后一律不提示')
})

test('进入非 Wish/PTC 会话弹一次，且不会"乱弹"（无 MutationObserver、按会话记忆去重）', () => {
  // 2026-10-19 真机：盯输入区的 MutationObserver 让打字/流式输出都能触发判定 ⇒ 弹窗乱出现
  const at = CLIENT_SRC.indexOf('const tick = () => {')
  const seg = CLIENT_SRC.slice(at, at + 1200)
  assert.ok(at > 0, '要有 tick')
  assert.equal(seg.includes('MutationObserver'), false, '预设判定不再盯输入区（其它地方用 MutationObserver 是别的用途）')
  assert.ok(CLIENT_SRC.includes('const PRESET_NOTICE_SEEN = new Map()'), '模块级记忆（重挂载不忘）')
  assert.ok(CLIENT_SRC.includes('setInterval(tick, 2500)'), '轻量定时查询')
  assert.ok(CLIENT_SRC.includes("document.visibilityState === 'hidden'"), '页面不可见时不查')
  // 同一会话同一个预设只弹一次
  assert.ok(CLIENT_SRC.includes('if (rec.shownFor === preset) return'), '同会话同预设去重')
  assert.ok(/if \(!first && !changed\) return/.test(CLIENT_SRC), '只有首次或预设真的变了才判定')
  assert.ok(CLIENT_SRC.includes('rec.shownFor = preset'), '记下已提示的预设')
  assert.ok(CLIENT_SRC.includes('setNotice(r.notice)'), '首次/变更时弹')
})

test('客户端：弹窗有主题色点缀与两个出口', () => {
  assert.ok(CLIENT_SRC.includes("'data-po06': 'preset-notice'"), '要有弹窗节点')
  assert.ok(CLIENT_SRC.includes("'data-po06': 'notice-accent'"), '要有主题色信号点')
  assert.ok(CLIENT_SRC.includes("L('知道了', 'Got it')"), '知道了')
  assert.ok(CLIENT_SRC.includes("L('以后不再显示', 'Do not show again')"), '以后不再显示')
  assert.ok(/apiGet\('\/preset\?(via=enter&)?session='/.test(CLIENT_SRC), '回车前要先问 /preset')
  assert.ok(/apiPost\('\/notice'/.test(CLIENT_SRC), '要能回写（关掉这一次 / 以后不再显示）')
  // 2026-10-19 用户要求：弹窗必须发生在**开始优化之前**，不是发出去之后
  const gate = CLIENT_SRC.indexOf("apiGet('/preset?via=enter&session='")
  const hold = CLIENT_SRC.indexOf("beginHold(draft, 'key')")
  assert.ok(gate > 0 && hold > gate, '先问宿主，再决定要不要 beginHold')
  assert.equal(CLIENT_SRC.includes("setInterval(load, 4000)"), false, '不再后台轮询（避免发完才弹）')
  assert.ok(CLIENT_SRC.includes('forever: true'), '以后不再显示要带 forever')
  assert.ok(/Wish \/ PTC/.test(CLIENT_SRC), '文案要点名 Wish / PTC')
  // 预设在会话开始前拨好的情形，由 2.5s 的轻查询兜住（见上一条测试）
  assert.ok(CLIENT_SRC.includes('via=watch'), '轻查询走 via=watch（不写台账）')
})
