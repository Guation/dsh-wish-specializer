// 顾问调用的会话外壳（2026-10-20）：台账注入 / 记账 / 销账 / 开关清账。
// 这套测试存在的理由很具体：真机两次都回"没有旧账"，根因是把 question 写到了 args[1]（exec）上；
// 当时那段逻辑在 apply 里，够不着任何单测。抽出来之后，这条回归用一行断言就能钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLedger } from '../lib/advisor-ledger.js'
import { createAdvisorWrapper, sessionIdOf } from '../lib/advisor-session.js'

// 注意：工具回调是 (toolArgs, exec) 两个位置参数；exec 是对象，不是数组。
const execOf = (sid = 's1') => ({ agent: { session: { id: sid } } })

function setup(policy = { advisor: true }) {
  const ledger = createLedger()
  const wrap = createAdvisorWrapper({ ledger, policyFor: () => policy })
  const calls = []
  const execute = async (toolArgs, ex) => { calls.push({ toolArgs, ex }); return { ok: true, report: { checks: [], findings: [] } } }
  return { ledger, wrapped: wrap(execute), calls }
}

test('sessionIdOf 从 (toolArgs, exec) 里取会话', () => {
  assert.equal(sessionIdOf([{}, execOf('abc')]), 'abc')
  assert.equal(sessionIdOf([{}, {}]), '')
})

test('台账要写进 args[0].question（不是 args[1]）——真机事故的回归', async () => {
  const policy = { advisor: true }
  const ledger = createLedger()
  ledger.add('s1', { claim: '轮廓像玩具' }, { turn: 1 })
  const wrap = createAdvisorWrapper({ ledger, policyFor: () => policy })
  let seen = null
  const wrapped = wrap(async (toolArgs) => { seen = toolArgs; return { ok: true, report: { checks: [], findings: [] } } })
  await wrapped({ question: '这版怎么样' }, { agent: { session: { id: 's1' } } })
  assert.ok(seen && typeof seen.question === 'string', '执行函数要拿到参数对象')
  assert.ok(seen.question.includes('轮廓像玩具'), '台账内容要进 question')
  assert.ok(seen.question.indexOf('轮廓像玩具') < seen.question.indexOf('这版怎么样'), '旧账在前')
})

test('调用成功后记账：failed check 记 major，finding 记 minor', async () => {
  const { ledger, wrapped } = setup()
  const wrapped2 = createAdvisorWrapper({
    ledger,
    policyFor: () => ({ advisor: true }),
  })(async () => ({ ok: true, report: { checks: [{ criterion: '轮廓比例', status: 'failed' }], findings: [{ text: '接缝有硬边' }] } }))
  await wrapped2({ question: 'q' }, execOf('s1'))
  const open = ledger.open('s1')
  assert.equal(open.length, 2)
  assert.ok(open.some((r) => r.claim === '轮廓比例' && r.severity === 'major'))
  assert.ok(open.some((r) => r.claim === '接缝有硬边' && r.severity === 'minor'))
})

test('顾问自己给的 resolvedClaims 会被应用（销账）', async () => {
  const ledger = createLedger()
  const row = ledger.add('s1', { claim: '轮廓像玩具' }, { turn: 1 })
  const wrap = createAdvisorWrapper({ ledger, policyFor: () => ({ advisor: true }) })
  const wrapped = wrap(async () => ({ ok: true, report: { checks: [], findings: [], resolvedClaims: [{ id: row.id, status: 'resolved' }] } }))
  await wrapped({ question: 'q' }, execOf('s1'))
  assert.equal(ledger.open('s1').length, 0)
})

test('顾问关掉：清账，且不改 question', async () => {
  const ledger = createLedger()
  ledger.add('s1', { claim: '旧结论' }, { turn: 1 })
  const wrap = createAdvisorWrapper({ ledger, policyFor: () => ({ advisor: false }) })
  let seen = null
  const wrapped = wrap(async (toolArgs) => { seen = toolArgs; return { ok: true, report: {} } })
  await wrapped({ question: '原问题' }, execOf('s1'))
  assert.equal(seen.question, '原问题', '关掉时不许注入')
  assert.equal(ledger.open('s1').length, 0, '关掉即清账')
})
