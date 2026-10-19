// 「本次注入」卡片（2026-10-18 定，2026-10-19 因 P0 事故改形态）。
//
// 事故：最早的做法是往会话日志里 append 一条自定义事件 po06/injection 来画对话流里的卡片。
// 宿主读取器对未知事件类型是 fail-closed 的（信封没有 ignorable: true 就整条会话拒绝解释），
// 而 Session.append() 无法设置该标记 ⇒ 重启后会话打不开。现在：
//   · 注入记录只进**插件自己的内存**（adapter.noteInjection）；
//   · 客户端用 /po06/api/injection 取回，输入栏胶囊在刷新/重开后仍然在；
//   · **会话日志一个字节都不写**（这条由下面的回归门钉死）。
//
// 仍然要钉的（都是会静默坏掉、且坏了看不出来的）：
//   ① 没真的注入过（跳过 / 按原文发出 / 解释失败）时**不许有卡片**；
//   ② 卡片只画注入文；
//   ③ 默认收起；
//   ④ **绝不 append 自定义会话事件**（P0 回归门）；
//   ⑤ 记录经由插件 API 回到界面。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLIENT_SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const INDEX_SRC = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const API_SRC = readFileSync(join(ROOT, 'lib', 'control-api.js'), 'utf8')

function loadClient() {
  const win = {}
  win.__regs = []
  win.__ModuleLoader__ = { load: (reg) => { win.__regs.push(reg) } }
  const react = {
    createElement: () => null, Fragment: 'Fragment',
    useState: (v) => [v, () => {}], useEffect: () => {}, useCallback: (f) => f,
    useMemo: (f) => f(), useRef: (v) => ({ current: v }), useReducer: (r, i) => [i, () => {}],
    createContext: () => ({ Provider: null, Consumer: null }),
  }
  const fakeRequire = (name) => (name === 'react' ? react : {})
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', CLIENT_SRC)(win, fakeRequire)
  const reg = win.__regs[win.__regs.length - 1]
  assert.ok(reg && typeof reg.factory === 'function', 'client.js 必须注册一个 factory')
  const mod = reg.factory(fakeRequire)
  mod.apply({ slots: { register: () => () => {}, inject: (slot, cb) => cb() } })
  return mod
}
const dbg = () => loadClient().__debug
const model = () => dbg().injectionCardModel

test('没有真的注入过时，卡片不许出现（跳过 / 按原文发出 / 解释失败）', () => {
  const m = model()
  assert.equal(m(null), null)
  assert.equal(m({ text: '原话', packet: '' }), null, '没有注入文就没有卡片')
  assert.equal(m({ text: '原话', packet: '   ' }), null, '空白注入文同样不算')
  assert.equal(m({ text: '原话', packet: '包', injectCard: false }), null, '标记为未注入的一律不记')
})

test('只保留实际注入文：原话与意图包都不再进卡片', () => {
  const card = model()({ text: '做一个坦克', packet: '注入文全文', intent: '优化后的意图包', englishMode: true, outgoingText: 'English' })
  assert.deepEqual(Object.keys(card).sort(), ['chars', 'injected'])
  assert.equal(card.injected, '注入文全文')
})

test('字数以服务端给的真实注入长度为准，缺了才回落到文本长度', () => {
  const m = model()
  assert.equal(m({ packet: 'abc', chars: 42 }).chars, 42)
  assert.equal(m({ packet: 'abcd' }).chars, 4)
})

test('输入栏胶囊已移除：注入只在对话流里展示一次', () => {
  // 2026-10-19 用户要求：对话流已有卡片，输入栏那颗「本次注入」是重复噪音，去掉。
  assert.equal(CLIENT_SRC.includes("'data-po06': 'inject-pill'"), false, '胶囊按钮不许回来')
  assert.equal(CLIENT_SRC.includes("id: 'po06-inject-card'"), false, '胶囊展开体也不许回来')
  assert.equal(/setInject\(card\)/.test(CLIENT_SRC), false, '放行路径不再留快照')
  assert.ok(CLIENT_SRC.includes("'data-po06': 'injection-row'"), '对话流卡片还在')
})

test('卡片正文只有「实际注入文」一段', () => {
  assert.ok(CLIENT_SRC.includes('rec.injected'), '要渲染注入文')
  assert.equal(CLIENT_SRC.includes("injectSection('original'"), false, '不许画原话')
  assert.equal(CLIENT_SRC.includes("injectSection('optimized'"), false, '不许画意图包')
})

test('P0 回归门：只许写宿主**已注册**的事件类型（自定义类型会让会话打不开）', () => {
  // 宿主读取器对未知类型 fail-closed，而 Session.append() 无法设置 ignorable ⇒ 写自定义类型
  // = 会话重启后打不开。命令事件是宿主自己的行类型，允许；其它一律不许。
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  const code = strip(INDEX_SRC)
  const types = [...code.matchAll(/session\.append\(\s*'([^']+)'/g)].map((m) => m[1])
  const ALLOWED = new Set(['command/run', 'command/done'])
  for (const t of types) assert.ok(ALLOWED.has(t), '只允许宿主已知类型，发现：' + t)
  assert.ok(types.includes('command/run') && types.includes('command/done'), '卡片的行锚要写成命令事件')
  assert.ok(!/po06\/injection/.test(code + strip(CLIENT_SRC)), '不得再出现 po06/injection 自定义事件')
  // 插件自己的状态投影同样不走会话日志：生产调用必须传 persist（projection.js 的 EV-0081 分流）。
  assert.ok(/persist:\s*\(s, state\)/.test(INDEX_SRC), 'commitPatch 必须带 persist，禁止回落到 session.append')
})

test('注入记录进插件内存，经 /po06/api/injection 回到界面（按 id 或按会话）', () => {
  assert.ok(/noteInjection\(sid/.test(INDEX_SRC), '放行时记录到 adapter')
  assert.ok(/getInjection\(p && p\.sessionId|getInjection\(id \?/.test(INDEX_SRC + API_SRC), '控制面要接上读取口')
  assert.ok(/API_PREFIX \+ '\/injection'/.test(API_SRC), '要有 /po06/api/injection 路由')
  assert.ok(API_SRC.includes("query.get('id')"), '卡片要能按记录 id 取')
  assert.ok(API_SRC.includes('getInjection'), '路由要调用注入读取口')
  assert.ok(CLIENT_SRC.includes("apiGet('/injection?id='"), '对话流卡片按 id 取正文')
  assert.equal(CLIENT_SRC.includes("apiGet('/injection?session='"), false, '胶囊已移除，不再按会话拉')
})

test('对话流卡片挂在宿主的 commandview 子槽上（已知事件类型 + 命令名分发）', () => {
  const d = dbg()
  assert.equal(d.INJECTION_COMMAND, 'po06-inject')
  assert.equal(typeof d.InjectionCommandCard, 'function')
  assert.ok(/mountKeyed\('conversation\.chat\.commandview', INJECTION_COMMAND/.test(CLIENT_SRC), '要按命令名注册卡片视图')
  assert.ok(/commandId, name: 'po06-inject'/.test(INDEX_SRC), '事件里要带同一个命令名')
})

test('放行路径不再自己记卡片（正文由宿主命令事件 + 记录 id 决定）', () => {
  const at = CLIENT_SRC.indexOf('const releaseHold = (text, h, mark) =>')
  assert.ok(at > 0, '找不到 releaseHold')
  const body = CLIENT_SRC.slice(at, at + 1200)
  assert.equal(body.includes('injectionCardModel(h)'), false, '不再在放行时留快照')
  assert.ok(body.includes('inputActions.submit()'), '放行仍然要真的提交')
})

test('跳过 / 按原文发出 / 解释失败三条路都显式标成未注入', () => {
  const marks = CLIENT_SRC.match(/injectCard: false/g) || []
  assert.ok(marks.length >= 3, '三条不注入的路径都要显式标记，实际：' + marks.length)
})

test('新旧卡片互不干扰：旧的胶囊状态已彻底删除', () => {
  for (const gone of ['setInject(', 'setInjectOpen(', 'injectOpen', 'placeInject']) {
    assert.equal(CLIENT_SRC.includes(gone), false, '残留：' + gone)
  }
})

test('控制面按 id 查询要真的到达 adapter（整包转发，不许只取 sessionId）', () => {
  // 2026-10-19 真机：对话流卡片是一片空行——事件写了、记录也在盘上，但 ?id= 查询永远 null。
  // 根因就在这行包装：只把 p.sessionId 传下去，id 被丢了。
  assert.ok(/getInjection: \(p\) => adapter\.getInjection\(p\)/.test(INDEX_SRC), '必须整包转发')
  assert.equal(/getInjection: \(p\) => adapter\.getInjection\(p && p\.sessionId\)/.test(INDEX_SRC), false, '旧写法不许回来')
  assert.ok(/getInjection\(id \? \{ id \} : \{ sessionId: sid \}\)/.test(API_SRC), '控制面要按 id/session 分头查')
})
