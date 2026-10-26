// 刷新/失败恢复的**判定与载荷构造**单测（`lib/client.js` 的 `__restore` 出口）。
//
// 运行：node po06/test/restore-decision.test.mjs
//
// 为什么这样测（2026-10-26）：`client.js` 不是普通 ESM 模块，而是 DSH 的模块加载器包装
//   window.__ModuleLoader__.load({ id, factory })
// 仓库没有构建步骤（零依赖、无打包配置），所以纯函数只能放在 factory 作用域里、经
// `exports.__restore` 暴露（`apply()` 时赋值）。这里用**假的 __ModuleLoader__** 加载
// **真实生产文件**再取那个出口——测的是线上跑的那份代码，不是复制品。
//
// 判定表（action 四态）：
//   无记录 / runId 无效                 → none（清理）
//   progress 请求失败（null / !ok）      → retry（**不能当 gone**，否则误清记录）
//   runId 不匹配（串号）                 → none
//   **已确认发出（arrived）**            → none/already-sent（优先于一切）
//   running                             → poll
//   done + result.ok === true            → review（贴回正文，可提交）
//   done + result.ok !== true            → none（优化失败也会落成 done，不能贴回空包）
//   cancelled / gone / 未知 state        → none
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

// ── 假宿主环境：只为让 client.js 的模块包装与 apply() 能执行 ────────────
const listeners = new Map()
const store = new Map()
globalThis.window = {
  __ModuleLoader__: { load: (s) => { globalThis.__spec = s } },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  },
  addEventListener: (n, f) => { if (!listeners.has(n)) listeners.set(n, new Set()); listeners.get(n).add(f) },
  removeEventListener: (n, f) => { const s = listeners.get(n); if (s) s.delete(f) },
  dispatchEvent: () => true,
}
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, body: {},
}
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail } }

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
await import('file://' + clientPath)
const spec = globalThis.__spec
assert.ok(spec, 'client.js 没有调用 window.__ModuleLoader__.load')

const fakeReact = new Proxy({}, { get: () => () => null })
const mod = spec.factory((name) => (name === 'react' ? fakeReact : ({})))
mod.apply({ slots: { register: () => () => {}, inject: (s, cb) => cb() }, locale: 'en' })
const R = mod.__restore
assert.ok(R && typeof R.resolveRestore === 'function' && typeof R.buildRestoredHold === 'function',
  'client.js 没有导出 __restore.{resolveRestore, buildRestoredHold}')
const { resolveRestore, buildRestoredHold } = R

const SAVED = { runId: 'r1', generation: 1000, text: '原始输入', startedAt: 1000, sessionId: 's1' }
const OK_RESULT = { ok: true, packet: '包正文', chars: 5, ms: 20, usageTotal: 7, usage: { total: 7 }, route: 'observed', understanding: { summary: 'x' }, support: null, noAddition: false, englishMode: false }
const DONE = { ok: true, runId: 'r1', state: 'done', result: OK_RESULT }

test('无记录 ⇒ none/no-pending', () => {
  assert.deepEqual(resolveRestore(null, DONE), { action: 'none', reason: 'no-pending' })
  assert.deepEqual(resolveRestore(undefined, DONE), { action: 'none', reason: 'no-pending' })
})

test('记录无 runId ⇒ none/invalid-pending', () => {
  assert.deepEqual(resolveRestore({ text: 'x' }, DONE), { action: 'none', reason: 'invalid-pending' })
  assert.deepEqual(resolveRestore({ runId: '' }, DONE), { action: 'none', reason: 'invalid-pending' })
})

test('progress 请求失败 ⇒ retry（不能当 gone，否则误清记录）', () => {
  assert.deepEqual(resolveRestore(SAVED, null), { action: 'retry', reason: 'progress-missing' })
  assert.deepEqual(resolveRestore(SAVED, { ok: false, error: 'network' }), { action: 'retry', reason: 'progress-unavailable' })
})

test('runId 不匹配（串号）⇒ none', () => {
  assert.deepEqual(resolveRestore(SAVED, { ok: true, runId: 'r2', state: 'done', result: OK_RESULT }),
    { action: 'none', reason: 'run-id-mismatch' })
})

test('已确认发出（arrived）⇒ none/already-sent，优先于一切', () => {
  // 真机 2026-10-19：发送成功后记录按设计保留；挂载恢复若只查 progress，
  // 会把一个早已发送成功的旧轮次当成"待恢复任务"重新弹回面板。
  assert.deepEqual(resolveRestore(SAVED, DONE, { arrived: true }), { action: 'none', reason: 'already-sent' })
  assert.deepEqual(resolveRestore(SAVED, { ok: true, runId: 'r1', state: 'running' }, { arrived: true }),
    { action: 'none', reason: 'already-sent' })
  assert.equal(buildRestoredHold(SAVED, DONE, { arrived: true }), null)
})

test('arrived 缺省/false 时不误伤正常恢复', () => {
  assert.deepEqual(resolveRestore(SAVED, DONE), { action: 'review', reason: 'done' })
  assert.deepEqual(resolveRestore(SAVED, DONE, { arrived: false }), { action: 'review', reason: 'done' })
})

test('running ⇒ poll', () => {
  assert.deepEqual(resolveRestore(SAVED, { ok: true, runId: 'r1', state: 'running' }), { action: 'poll', reason: 'running' })
})

test('done + result.ok ⇒ review', () => {
  assert.deepEqual(resolveRestore(SAVED, DONE), { action: 'review', reason: 'done' })
})

test('done + result.ok=false ⇒ none/failed-round（不能贴回空包面板）', () => {
  assert.deepEqual(resolveRestore(SAVED, { ok: true, runId: 'r1', state: 'done', result: { ok: false, reason: 'no-packet' } }),
    { action: 'none', reason: 'failed-round' })
  assert.deepEqual(resolveRestore(SAVED, { ok: true, runId: 'r1', state: 'done', result: null }),
    { action: 'none', reason: 'failed-round' })
})

test('cancelled / gone / 未知 state ⇒ none', () => {
  assert.deepEqual(resolveRestore(SAVED, { ok: true, runId: 'r1', state: 'cancelled' }), { action: 'none', reason: 'cancelled' })
  assert.deepEqual(resolveRestore(SAVED, { ok: true, runId: 'r1', state: 'gone' }), { action: 'none', reason: 'gone' })
  assert.deepEqual(resolveRestore(SAVED, { ok: true, runId: 'r1', state: '啥也不是' }), { action: 'none', reason: 'unknown-state' })
})

test('buildRestoredHold：running ⇒ 优化中，run 身份取自记录', () => {
  const h = buildRestoredHold(SAVED, { ok: true, runId: 'r1', state: 'running' }, { englishMode: true })
  assert.ok(h, '应返回 hold')
  assert.equal(h.phase, 'optimizing')
  assert.equal(h.runId, 'r1')
  assert.equal(h.generation, 1000)
  assert.equal(h.text, '原始输入')
  assert.equal(h.t0, 1000)
  assert.equal(h.englishMode, true)
  assert.equal(h.packet, '')
})

test('buildRestoredHold：done+ok ⇒ 审查态，正文与用量透传、edited===packet', () => {
  const h = buildRestoredHold(SAVED, DONE, {})
  assert.ok(h, '应返回 hold')
  assert.equal(h.phase, 'review')
  assert.equal(h.packet, '包正文')
  assert.equal(h.edited, '包正文')
  assert.equal(h.chars, 5)
  assert.equal(h.usageTotal, 7)
  assert.equal(h.route, 'observed')
  assert.equal(h.restored, true)
  assert.equal(h.outgoingText, '原始输入')
})

test('buildRestoredHold：不该恢复时返回 null', () => {
  assert.equal(buildRestoredHold(null, DONE), null)
  assert.equal(buildRestoredHold(SAVED, { ok: true, runId: 'r1', state: 'gone' }), null)
  assert.equal(buildRestoredHold(SAVED, { ok: true, runId: 'r1', state: 'done', result: { ok: false } }), null)
  assert.equal(buildRestoredHold(SAVED, null), null)
})

test('buildRestoredHold：startedAt 缺失时回落到注入的 now', () => {
  const h = buildRestoredHold({ runId: 'r1', text: 'x' }, DONE, { now: () => 424242 })
  assert.equal(h.t0, 424242)
})

test('幂等：同一输入连调两次结果完全相同（纯函数，无副作用）', () => {
  const a = JSON.stringify(buildRestoredHold(SAVED, DONE, { now: () => 1 }))
  const b = JSON.stringify(buildRestoredHold(SAVED, DONE, { now: () => 1 }))
  assert.equal(a, b)
  assert.deepEqual(resolveRestore(SAVED, DONE), resolveRestore(SAVED, DONE))
})
