// 第 5 项 · 「本次注入」卡片（2026-10-18）。
//
// 定稿形态（用户 2026-10-18）：**对话流里、用户消息之后、首个思考之前**一条默认收起的小卡片，
// 点开**只显示实际注入文**——原话与"优化后的意图包"都不展示。
//
// 这里钉五件事（都是会静默坏掉、且坏了看不出来的）：
//   ① 没真的注入过（跳过 / 按原文发出 / 解释失败）时**不许有卡片**——伪成功是本项目的头号失败形态；
//   ② 卡片只画注入文，不再夹带原话/意图包（来源单一，免得把"意图包"当成"注入文"读）；
//   ③ 默认收起：不点开就连正文都不渲染；
//   ④ 对话流的位置靠 anchorSeq（用户消息的 seq）——不是靠事件写入的时间先后；
//   ⑤ 宿主侧写事件的两个纪律：延后一抽（append 重入会失败）、包为空不写。
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

test('默认收起：卡片只在点开后渲染正文', () => {
  assert.ok(/const \[open, setOpen\] = React\.useState\(false\)/.test(CLIENT_SRC), '卡片默认收起')
  assert.ok(/open \? h\('div', \{ 'data-po06': 'injection-row-body'/.test(CLIENT_SRC), '正文由 open 守着')
})

test('展开体只有「实际注入文」一段，没有原话/意图包', () => {
  const row = CLIENT_SRC.slice(CLIENT_SRC.indexOf('function InjectionChatRow'), CLIENT_SRC.indexOf('const INJECTION_DEFINITION'))
  assert.ok(row.includes("'inject-body'"), '要渲染注入文')
  assert.ok(!row.includes('你的原话'), '不许再画原话')
  assert.ok(!row.includes('优化后的意图包'), '不许再画意图包')
  assert.ok(row.includes("'data-po06': 'inject-note'"), '截断时要有说明')
})

test('快照只在 submit 成功之后才记（失败不冒充已注入）', () => {
  const at = CLIENT_SRC.indexOf('const releaseHold = (text, h, mark) =>')
  assert.ok(at > 0, '找不到 releaseHold')
  const body = CLIENT_SRC.slice(at, at + 1200)
  const submit = body.indexOf('inputActions.submit()')
  const snap = body.indexOf('injectionCardModel(h)')
  assert.ok(submit > 0 && snap > submit, '必须先 submit 成功，才留注入快照')
  assert.ok(body.includes('setInject(card)'))
})

test('跳过 / 按原文发出 / 解释失败三条路都显式标成未注入', () => {
  const marks = CLIENT_SRC.match(/injectCard: false/g) || []
  assert.ok(marks.length >= 3, '三条不注入的路径都要显式标记，实际：' + marks.length)
})

test('新一轮开始就收起上一轮的卡（陈旧卡片不许替新消息作证）', () => {
  const at = CLIENT_SRC.indexOf('const beginHold = (text, via) =>')
  assert.ok(at > 0, '找不到 beginHold')
  assert.ok(/setInject\(null\)/.test(CLIENT_SRC.slice(at, at + 900)))
})

test('对话流卡片：事件定义只接 po06/injection，并按 anchorSeq 排在用户消息之后', () => {
  const d = dbg()
  const def = d.INJECTION_DEFINITION
  assert.equal(def.kind, 'po06-injection', 'kind 必须等于 conversation.chat.node 的座位 key')
  assert.equal(d.INJECTION_KIND, 'po06-injection')
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
  const def = dbg().INJECTION_DEFINITION
  assert.equal(def.buildViewNode({ state: { seq: 3, data: { injected: '' } }, key: 'k', id: 'i', matches: [] }), null)
  assert.equal(def.buildViewNode({ state: null }), null)
  assert.equal(def.buildViewNode({ get state() { throw new Error('boom') } }), null)
})

test('宿主侧：放行时只写注入文，包为空不写，且必须延后一抽', () => {
  assert.ok(/session\.append\('po06\/injection'/.test(INDEX_SRC), '要真的 append 事件')
  assert.ok(/anchorSeq/.test(INDEX_SRC), '要带 anchorSeq，卡片才会排在用户消息下面')
  assert.ok(/setTimeout\(/.test(INDEX_SRC), '必须延后一抽：回调在 append 边界内，同步 append 会 reenter 失败')
  assert.ok(/if \(working\.trim\(\)\)/.test(INDEX_SRC), '没有注入文时不写事件')
  const at = INDEX_SRC.indexOf("session.append('po06/injection'")
  const payloadAt = INDEX_SRC.lastIndexOf('const payload = {', at)
  const payload = INDEX_SRC.slice(payloadAt, at)
  assert.ok(payload.includes('injected:'), '事件里要有注入文')
  assert.ok(!payload.includes('original:'), '不再写原话')
  assert.ok(!payload.includes('optimized:'), '不再写意图包')
})

test('接口不再为卡片单独提供意图包（卡片只显示注入文）', () => {
  assert.ok(!/intent: typeof out\.intent/.test(API_SRC), 'control-api 不再透传 intent')
  assert.ok(!/intent: intentText/.test(INDEX_SRC), 'interpret 不再返回 intent')
})
