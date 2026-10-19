// 刷新/失败恢复的**判定与载荷构造**单测（`lib/client.js` 的 `__restore` 出口）。
//
// 运行：node po06/test/restore-decision.test.mjs
//
// 为什么这样测（2026-10-19）：`client.js` 不是普通 ESM 模块，而是 DSH 的模块加载器包装
//   window.__ModuleLoader__.load({ id, factory })
// 没有 ESM 导入、也没有构建步骤（仓库零依赖、无打包配置），所以纯函数只能放在 factory
// 作用域里、通过 `exports.__restore` 暴露。这里用**假的 __ModuleLoader__** 加载
// **真实生产文件**再取那个出口——测的是线上跑的那份代码，不是复制品。
//
// 覆盖的判定表（action 四态）：
//   无 pending / requestId 无效        → none（清理）
//   progress 请求失败（null / !ok）     → retry（**不能当 gone**，否则误清 pending）
//   requestId 不匹配（串号）            → none
//   running                            → poll
//   done + result.ok === true           → review（贴回正文，可提交）
//   done + result.ok !== true           → none（**修掉的缺陷**：以前会贴回"审查态 + 空包"）
//   cancelled / gone / 未知 state       → none
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── 假宿主环境：只为让 client.js 的模块包装能执行 ────────────────────
// factory 只 require('react')（以及在 UI 路径里可选 require 原语包），
// 纯函数不碰 React / DOM，所以桩可以极小。
let spec = null
globalThis.window = { __ModuleLoader__: { load: (s) => { spec = s } } }
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, body: {},
}

const here = new URL('.', import.meta.url).pathname
await import('file://' + join(here, '..', 'lib', 'client.js'))
if (spec === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')
const fakeReact = new Proxy({}, { get: () => () => null })
const mod = spec.factory((name) => (name === 'react' ? fakeReact : ({})))
const R = mod && mod.__restore
if (!R || typeof R.resolveRestore !== 'function' || typeof R.buildRestoredHold !== 'function') {
  throw new Error('client.js 没有导出 __restore.{resolveRestore, buildRestoredHold}')
}
const { resolveRestore, buildRestoredHold } = R

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
async function t(name, fn) { try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const SAVED = { requestId: 'r1', text: '原始输入', startedAt: 1000, sessionId: 's1' }
const OK_RESULT = { ok: true, packet: '包正文', chars: 5, ms: 20, usageTotal: 7, usage: { total: 7 }, route: 'observed', understanding: { summary: 'x' }, support: null, noAddition: false, englishMode: false }
const DONE = { ok: true, requestId: 'r1', state: 'done', result: OK_RESULT }

// ── 判定表 ──────────────────────────────────────────────────────────
await t('无 pending ⇒ none/no-pending', () => {
  eq(resolveRestore(null, DONE), { action: 'none', reason: 'no-pending' })
  eq(resolveRestore(undefined, DONE), { action: 'none', reason: 'no-pending' })
})
await t('pending 无 requestId ⇒ none/invalid-pending', () => {
  eq(resolveRestore({ text: 'x' }, DONE), { action: 'none', reason: 'invalid-pending' })
  eq(resolveRestore({ requestId: '' }, DONE), { action: 'none', reason: 'invalid-pending' })
})
await t('progress 请求失败 ⇒ retry（**不能当 gone**，否则误清 pending）', () => {
  eq(resolveRestore(SAVED, null), { action: 'retry', reason: 'progress-missing' })
  eq(resolveRestore(SAVED, { ok: false, error: 'network' }), { action: 'retry', reason: 'progress-unavailable' })
})
await t('requestId 不匹配（串号）⇒ none', () => {
  eq(resolveRestore(SAVED, { ok: true, requestId: 'r2', state: 'done', result: OK_RESULT }), { action: 'none', reason: 'request-id-mismatch' })
})
await t('running ⇒ poll', () => {
  eq(resolveRestore(SAVED, { ok: true, requestId: 'r1', state: 'running' }), { action: 'poll', reason: 'running' })
})
await t('done + result.ok ⇒ review', () => {
  eq(resolveRestore(SAVED, DONE), { action: 'review', reason: 'done' })
})
await t('done + result.ok=false ⇒ none/failed-round（修掉的缺陷：以前贴回"审查态+空包"）', () => {
  eq(resolveRestore(SAVED, { ok: true, requestId: 'r1', state: 'done', result: { ok: false, reason: 'no-packet' } }),
    { action: 'none', reason: 'failed-round' })
  eq(resolveRestore(SAVED, { ok: true, requestId: 'r1', state: 'done', result: null }),
    { action: 'none', reason: 'failed-round' })
})
await t('已确认发出（arrived）⇒ none/already-sent —— 不管 progress 说什么都不能贴回', () => {
  // 真机 2026-10-19：正常发送成功后 pending 按设计保留，挂载恢复若只查 progress，
  // 会把一个**早已发送成功**的旧轮次当成"待恢复任务"重新弹回面板。
  eq(resolveRestore(SAVED, DONE, { arrived: true }), { action: 'none', reason: 'already-sent' })
  eq(resolveRestore(SAVED, { ok: true, requestId: 'r1', state: 'running' }, { arrived: true }),
    { action: 'none', reason: 'already-sent' }, 'arrived 优先于一切')
  eq(buildRestoredHold(SAVED, DONE, { arrived: true }), null, 'arrived ⇒ 不构造 hold')
})
await t('arrived 缺省/false 时行为不变（不误伤正常恢复）', () => {
  eq(resolveRestore(SAVED, DONE), { action: 'review', reason: 'done' })
  eq(resolveRestore(SAVED, DONE, { arrived: false }), { action: 'review', reason: 'done' })
})
await t('cancelled / gone / 未知 state ⇒ none', () => {
  eq(resolveRestore(SAVED, { ok: true, requestId: 'r1', state: 'cancelled' }), { action: 'none', reason: 'cancelled' })
  eq(resolveRestore(SAVED, { ok: true, requestId: 'r1', state: 'gone' }), { action: 'none', reason: 'gone' })
  eq(resolveRestore(SAVED, { ok: true, requestId: 'r1', state: '啥也不是' }), { action: 'none', reason: 'unknown-state' })
})

// ── 载荷构造 ────────────────────────────────────────────────────────
await t('buildRestoredHold：running ⇒ 优化中，载荷取自 pending', () => {
  const h = buildRestoredHold(SAVED, { ok: true, requestId: 'r1', state: 'running' }, { englishMode: true })
  ok(h, '应返回 hold')
  eq(h.phase, 'optimizing', 'phase')
  eq(h.text, '原始输入', 'text')
  eq(h.requestId, 'r1', 'requestId')
  eq(h.t0, 1000, 't0 用 pending.startedAt')
  eq(h.englishMode, true, 'englishMode 透传')
  eq(h.packet, '', 'running 时没有包')
})
await t('buildRestoredHold：done+ok ⇒ 审查态，正文与用量透传、edited===packet', () => {
  const h = buildRestoredHold(SAVED, DONE, {})
  ok(h, '应返回 hold')
  eq(h.phase, 'review', 'phase')
  eq(h.packet, '包正文', 'packet')
  eq(h.edited, '包正文', 'edited 必须等于 packet')
  eq(h.chars, 5, 'chars')
  eq(h.usageTotal, 7, 'usageTotal')
  eq(h.route, 'observed', 'route')
  eq(h.restored, true, 'restored 标记')
  eq(h.outgoingText, '原始输入', 'outgoingText 回落原文')
})
await t('buildRestoredHold：不该恢复时返回 null', () => {
  eq(buildRestoredHold(null, DONE), null)
  eq(buildRestoredHold(SAVED, { ok: true, requestId: 'r1', state: 'gone' }), null)
  eq(buildRestoredHold(SAVED, { ok: true, requestId: 'r1', state: 'done', result: { ok: false } }), null)
  eq(buildRestoredHold(SAVED, null), null)
})
await t('buildRestoredHold：startedAt 缺失时回落到注入的 now', () => {
  const h = buildRestoredHold({ requestId: 'r1', text: 'x' }, DONE, { now: () => 424242 })
  eq(h.t0, 424242, 't0 回落 now()')
})
await t('幂等：同一输入连调两次结果完全相同（纯函数，无副作用）', () => {
  const a = JSON.stringify(buildRestoredHold(SAVED, DONE, { now: () => 1 }))
  const b = JSON.stringify(buildRestoredHold(SAVED, DONE, { now: () => 1 }))
  eq(a, b, '两次结果一致')
  eq(resolveRestore(SAVED, DONE), resolveRestore(SAVED, DONE), 'resolve 幂等')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-restore-decision', phase: 'P11', total, pass, fail: failures.length, failures,
  note: '刷新/失败恢复的判定与载荷构造：假 __ModuleLoader__ 加载真实 client.js，测 __restore 出口。不联网、不碰 DOM 组件。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
