// 第 5 项 · 「本次注入了什么」折叠卡片（2026-10-18）。
//
// 用户要的形态：**发布完成之后**、在首个思考出现之前，出现一张默认收起的小卡片，
// 点开能看到「原话 → 优化后的意图包 → 实际注入文」。
//
// 这里钉四件事（都是会静默坏掉、且坏了看不出来的）：
//   ① 没真的注入过（跳过 / 按原文发出 / 解释失败）时**不许有卡片**——伪成功是本项目的头号失败形态；
//   ② 三段来源不互相冒充：意图包 ≠ 注入文；
//   ③ 默认收起：不点开就连卡片 DOM 都不生成；
//   ④ 数据出口真的送到了客户端（interpret 带 intent、control-api 透传）。
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
  const ctx = { slots: { register: () => () => {}, inject: (slot, cb) => cb() } }
  mod.apply(ctx)
  return mod
}

const model = () => loadClient().__debug.injectionCardModel

test('没有真的注入过时，卡片不许出现（跳过 / 按原文发出 / 解释失败）', () => {
  const m = model()
  assert.equal(m(null), null)
  assert.equal(m({ text: '原话', packet: '' }), null, '没有注入文就没有卡片')
  assert.equal(m({ text: '原话', packet: '   ' }), null, '空白注入文同样不算')
  assert.equal(m({ text: '原话', packet: '包', injectCard: false }), null, '标记为未注入的一律不记')
})

test('三段各来自各自的来源，不许互相冒充', () => {
  const m = model()
  const card = m({ text: '做一个坦克', packet: '注入文全文', intent: '优化后的意图包' })
  assert.equal(card.original, '做一个坦克')
  assert.equal(card.optimized, '优化后的意图包')
  assert.equal(card.injected, '注入文全文')
  assert.equal(card.english, '')
})

test('字数以服务端给的真实注入长度为准，缺了才回落到文本长度', () => {
  const m = model()
  assert.equal(m({ packet: 'abc', chars: 42 }).chars, 42)
  assert.equal(m({ packet: 'abcd' }).chars, 4)
})

test('英文模式只在真有英文任务时才多那一段', () => {
  const m = model()
  assert.equal(m({ packet: 'p', englishMode: true, outgoingText: 'English task' }).english, 'English task')
  assert.equal(m({ packet: 'p', englishMode: false, outgoingText: 'English task' }).english, '')
  assert.equal(m({ packet: 'p', englishMode: true, outgoingText: '   ' }).english, '')
})

test('默认收起：卡片只在 injectOpen 为真时渲染，且点开前不生成 DOM', () => {
  const openDecl = /const \[injectOpen, setInjectOpen\] = React\.useState\(false\)/.exec(CLIENT_SRC)
  assert.ok(openDecl, 'injectOpen 必须默认 false（默认收起）')
  assert.ok(/injectOpen && inject \? h\('div'[\s\S]{0,200}data-po06': 'inject-card'/.test(CLIENT_SRC),
    '展开体必须由 injectOpen && inject 同时守着')
  assert.ok(/inject \? h\('button', \{[\s\S]{0,260}'data-po06': 'inject-pill'/.test(CLIENT_SRC),
    '胶囊只在真的有一份注入快照时出现')
})

test('展开体的三段标题都在（原话 / 优化后 / 注入文）', () => {
  for (const label of ["'你的原话'", "'优化后的意图包'", "'实际注入文'"]) {
    assert.ok(CLIENT_SRC.includes(label + ',') || CLIENT_SRC.includes(label + ')'), '缺标题：' + label)
  }
  assert.ok(CLIENT_SRC.includes("'inject-section'"), '每段要有自己的标记（便于核对与测试）')
  assert.ok(CLIENT_SRC.includes("'data-section': key"), '每段要能按 key 分辨')
})

test('快照只在 submit 成功之后才记（失败不冒充已注入）', () => {
  const at = CLIENT_SRC.indexOf('const releaseHold = (text, h, mark) =>')
  assert.ok(at > 0, '找不到 releaseHold')
  const body = CLIENT_SRC.slice(at, at + 1200)
  const submit = body.indexOf('inputActions.submit()')
  const snap = body.indexOf('injectionCardModel(h)')
  assert.ok(submit > 0 && snap > submit, '必须先 submit 成功，才留注入快照')
  assert.ok(body.includes('setInject(card)'), '要落一份快照')
})

test('跳过 / 按原文发出 / 解释失败三条路都显式标成未注入', () => {
  const marks = CLIENT_SRC.match(/injectCard: false/g) || []
  assert.ok(marks.length >= 3, '三条不注入的路径都要显式标记，实际：' + marks.length)
})

test('数据出口：interpret 返回 intent，control-api 透传 intent', () => {
  assert.ok(/intent: intentText/.test(INDEX_SRC), 'interpret 的返回值里要有 intent')
  assert.ok(/adapter\.getIntentText\(sid\)/.test(INDEX_SRC), 'intent 必须取自 getIntentText')
  assert.ok(/intent: typeof out\.intent === 'string'\s*\? out\.intent\.slice\(0, 4000\) : null/.test(API_SRC),
    'control-api 要透传 intent（并截断到 4000）')
  assert.ok(/intent: typeof r\.intent === 'string' \? r\.intent : ''/.test(CLIENT_SRC),
    '客户端要把 intent 收进 hold')
})
test('意图包被截断时，卡片如实说明（不把截断当成完整）', () => {
  const m = model()
  assert.equal(m({ packet: 'p', intent: 'x'.repeat(10), intentTruncated: true }).truncated, true)
  assert.equal(m({ packet: 'p', intent: 'short' }).truncated, false)
  assert.ok(API_SRC.includes("intentTruncated: typeof out.intent === 'string' && out.intent.length > 4000"),
    'control-api 要标出截断')
  assert.ok(CLIENT_SRC.includes("inject.truncated ? L("), '展开体要显示截断说明')
})

test('新一轮开始就收起上一轮的卡（陈旧卡片不许替新消息作证）', () => {
  const at = CLIENT_SRC.indexOf('const beginHold = (text, via) =>')
  assert.ok(at > 0, '找不到 beginHold')
  const body = CLIENT_SRC.slice(at, at + 900)
  assert.ok(/setInject\(null\)/.test(body), 'beginHold 里要清掉上一轮的注入快照')
})

test('外点只豁免胶囊与卡片本体，不豁免整条控件栏（避免两块浮层叠开）', () => {
  const at = CLIENT_SRC.indexOf('const placeInject = () =>')
  assert.ok(at > 0, '找不到 placeInject')
  const body = CLIENT_SRC.slice(at, at + 2200)
  assert.ok(/const btn = injectBtnRef\.current[\s\S]{0,120}btn\.contains\(e\.target\)/.test(body),
    '胶囊本体要单独豁免')
  assert.ok(!/const bar = rootRef\.current/.test(body), '不能再拿整条控件栏当豁免范围')
  assert.ok(/addEventListener\('resize'/.test(body) && /addEventListener\('scroll'/.test(body),
    '打开期间要在滚动/缩放时重算位置')
})

test('对话流卡片：事件定义只接 po06/injection，并按 anchorSeq 排在用户消息之后', () => {
  const dbg = loadClient().__debug
  const def = dbg.INJECTION_DEFINITION
  assert.equal(def.kind, 'po06-injection', 'kind 必须等于 conversation.chat.node 的座位 key')
  assert.equal(dbg.INJECTION_KIND, 'po06-injection')
  assert.equal(def.target, 'chat')
  assert.equal(def.match({ type: 'user/message', seq: 3 }), null, '别的会话事件不许被我们接管')
  assert.deepEqual(def.match({ type: 'po06/injection', seq: 12 }), { id: '12', role: 'start' })
  const state = def.start({}, { event: { seq: 12, data: { anchorSeq: 7, injected: 'x', chars: 1 } } })
  const node = def.buildViewNode({ state, key: 'k', id: 'i', start: { location: { kind: 'msg' } }, matches: [] })
  assert.equal(node.kind, 'po06-injection')
  assert.equal(node.target, 'chat')
  assert.equal(node.anchorSeq, 7, '排序位置用 anchorSeq（用户消息的 seq），不是事件自己的 seq')
  assert.equal(node.visibility, 'visible')
})

test('对话流卡片：没有注入文的旧事件不画空卡；坏数据也不许炸会话流', () => {
  const dbg = loadClient().__debug
  const def = dbg.INJECTION_DEFINITION
  assert.equal(def.buildViewNode({ state: { seq: 3, data: { injected: '' } }, key: 'k', id: 'i', matches: [] }), null)
  assert.equal(def.buildViewNode({ state: null }), null)
  assert.equal(def.buildViewNode({ get state() { throw new Error('boom') } }), null, '异常要吞掉，不能让整条会话流崩')
})

test('宿主侧：放行时写一条 po06/injection 事件（包为空就不写）', () => {
  assert.ok(/session\.append\('po06\/injection'/.test(INDEX_SRC), '要真的 appende 事件')
  assert.ok(/anchorSeq/.test(INDEX_SRC), '要带 anchorSeq，卡片才会排在用户消息下面')
  assert.ok(/setTimeout\(/.test(INDEX_SRC), '必须延后一抽：回调在 append 边界内，同步 append 会 reenter 失败')
  assert.ok(/if \(working\.trim\(\)\)/.test(INDEX_SRC), '没有注入文时不写事件')
})
