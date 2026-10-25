import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHoldClient } from './fixtures/client-hold-harness.mjs'

const original = '保留用户输入的原话'
const plain = value => JSON.parse(JSON.stringify(value))
async function start(ui, sid = 'a', text = original) {
  const bar = ui.mount(sid, text)
  await ui.flush()
  assert.equal(bar.enter().defaultPrevented, true, 'The real composer listener should intercept Enter')
  await ui.flush()
  return bar
}
const packetReads = ui => ui.requests.filter(req => req.method === 'GET' && req.path === '/packet')

test('automatic, reviewed, and skipped sends preserve the complete multiline original including boundary whitespace', async t => {
  const raw = '  \n\t第一行保留尾空格  \n  second line\t\n \t  '
  for (const mode of ['auto', 'review', 'skip']) await t.test(mode, async t => {
    const ui = loadHoldClient({ permission: mode === 'review' ? 'review' : 'auto' }); t.after(() => ui.close())
    const bar = await start(ui, 'a', raw)
    const interpretation = ui.pending('/interpret')[0]
    assert.equal(interpretation.body.text, raw, 'Interpretation receives the exact captured original')
    assert.equal(ui.hold('a').text, raw)
    let confirmation
    if (mode === 'skip') bar.panel().onSkip()
    else {
      ui.completeInterpret(interpretation); await ui.flush()
      if (mode === 'review') confirmation = bar.panel().onConfirm()
    }
    await ui.flush()
    const commit = ui.pending('/packet')[0]
    assert.equal(commit.body.originalText, raw)
    assert.equal(commit.body.outgoingText, raw)
    assert.equal(commit.body.disposition, mode === 'skip' ? 'skip' : 'send')
    assert.equal(ui.submissions.length, 0)
    ui.completePacket(commit); await ui.flush(); await confirmation
    assert.equal(ui.submissions.length, 1)
    assert.equal(ui.submissions[0].text, raw, 'The host submits every leading/trailing space, tab, and line break')
    assert.equal(bar.draft, raw)
    assert.equal(ui.hold('a').text, raw)
  })
})

test('whitespace-only composer input remains empty for interception', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const bar = ui.mount('a', '  \n\t  '); await ui.flush()
  assert.notEqual(bar.enter().defaultPrevented, true)
  await ui.flush()
  assert.equal(ui.pending('/interpret').length, 0)
  assert.equal(ui.submissions.length, 0)
})

test('automatic release commits the final packet once before changing the draft or submitting', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const bar = await start(ui)
  const interpretation = ui.pending('/interpret')[0]
  const runId = interpretation.body.messageId
  assert.ok(runId)
  assert.equal(runId, ui.hold('a').runId)
  assert.ok(Number.isSafeInteger(interpretation.body.generation) && interpretation.body.generation > 0)
  assert.equal(ui.hold('a').generation, interpretation.body.generation)
  assert.equal(ui.submissions.length, 0)
  const finalPacket = '[Final, already rendered framing] requirements'
  ui.completeInterpret(interpretation, { packet: finalPacket, chars: finalPacket.length })
  await ui.flush()
  assert.equal(ui.pending('/packet').length, 1)
  assert.deepEqual(ui.pending('/packet')[0].body, { sessionId: 'a', runId, generation: interpretation.body.generation, text: finalPacket, disposition: 'send', originalText: original, outgoingText: original })
  assert.equal(ui.submissions.length, 0)
  assert.equal(ui.order.some(event => event.type === 'draft'), false, 'Do not touch the host draft before the commit acknowledgement')
  const first = bar.panel().onConfirm(), second = bar.panel().onConfirm()
  ui.mod.__debug.holdBridgeWrite('a', ui.hold('a'))
  await ui.flush()
  assert.equal(ui.pending('/packet').length, 1, 'Repeated confirm/bridge callbacks must share one commit')
  ui.completePacket()
  await ui.flush(); await Promise.all([first, second])
  assert.equal(ui.submissions.length, 1)
  assert.equal(ui.submissions[0].text, original)
  assert.equal(ui.submissions[0].commit.packet, finalPacket)
  assert.equal(ui.hold('a').packet, finalPacket)
  assert.equal(ui.hold('a').pendingAuto, false)
  const committed = ui.order.findIndex(event => event.type === 'response' && event.path === '/packet')
  const submitted = ui.order.findIndex(event => event.type === 'submit')
  assert.ok(committed >= 0 && submitted > committed)
  ui.advance(20000); await ui.flush()
  assert.equal(packetReads(ui).length, 0, 'Packet readiness never uses polling or a timed fallback')
  assert.equal(ui.submissions.length, 1)
})

test('a delayed commit uses the current mounted host input actions', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const bar = await start(ui)
  ui.completeInterpret(); await ui.flush()
  const calls = []
  bar.props = { ...bar.props, inputActions: { setDraft: text => calls.push(['draft', text]), submit: () => calls.push(['submit']) } }
  bar.dirty = true; await ui.flush()
  ui.completePacket(); await ui.flush()
  assert.deepEqual(calls, [['draft', original], ['submit']])
  assert.equal(ui.submissions.length, 0, 'The input actions captured by the old render must not submit')
})

test('a proven synchronous submit throw allows a fresh manual retry without retrying coalesced waiters', async t => {
  for (const retryAction of ['onConfirm', 'onOriginal']) await t.test(retryAction, async t => {
    const ui = loadHoldClient({ permission: 'review' }); t.after(() => ui.close())
    const bar = await start(ui)
    ui.completeInterpret(); await ui.flush()
    let attempts = 0
    const host = bar.props.inputActions
    bar.props = { ...bar.props, inputActions: { ...host, submit() {
      if (++attempts === 1) throw new Error('Synchronous host failure')
      return host.submit()
    } } }
    bar.dirty = true; await ui.flush()
    const first = bar.panel().onConfirm(), duplicate = bar.panel().onConfirm()
    ui.completePacket(); await ui.flush(); await Promise.all([first, duplicate])
    assert.equal(attempts, 1, 'Other waiters must not turn a synchronous throw into an automatic retry')
    assert.equal(ui.submissions.length, 0)
    assert.equal(ui.hold('a').phase, 'error')
    assert.equal(ui.hold('a').pendingAuto, false)
    assert.match(ui.hold('a').reason, /Synchronous host failure/)
    const retry = bar.panel()[retryAction]()
    await ui.flush()
    assert.equal(ui.pending('/packet').length, 2, 'A manual retry makes a fresh common commit after invalidating the failed attempt')
    assert.equal(ui.pending('/packet')[1].body.disposition, retryAction === 'onOriginal' ? 'skip' : 'send')
    assert.equal(ui.submissions.length, 0)
    ui.completePacket(ui.pending('/packet')[1]); await ui.flush()
    await retry
    assert.equal(attempts, 2)
    assert.equal(ui.submissions.length, 1)
    assert.equal(ui.submissions[0].text, original)
  })
})

test('an asynchronous submit rejection stays claimed because the host may already have sent', async t => {
  const ui = loadHoldClient({ permission: 'review' }); t.after(() => ui.close())
  const bar = await start(ui)
  ui.completeInterpret(); await ui.flush()
  let reject, attempts = 0
  const host = bar.props.inputActions
  bar.props = { ...bar.props, inputActions: { ...host, submit() { attempts += 1; return new Promise((_, fail) => { reject = fail }) } } }
  bar.dirty = true; await ui.flush()
  const first = bar.panel().onConfirm()
  ui.completePacket(); await ui.flush(); await first
  reject(new Error('Ambiguous asynchronous failure')); await ui.flush()
  assert.equal(ui.hold('a').phase, 'error')
  await bar.panel().onConfirm(); await bar.panel().onOriginal(); await ui.flush()
  assert.equal(attempts, 1)
  assert.equal(ui.pending('/packet').length, 1)
})

test('rollback preserves the same run as a manual review edit, then uses the common packet commit', async t => {
  const ui = loadHoldClient({ englishMode: true }); t.after(() => ui.close())
  const bar = await start(ui)
  ui.completeInterpret(undefined, { packet: 'new English packet', outgoingText: 'Translated user request', englishMode: true }); await ui.flush()
  const obsoleteSend = ui.pending('/packet')[0]
  const runId = ui.hold('a').runId
  const rollback = bar.panel().onRollback()
  await ui.flush()
  assert.equal(obsoleteSend.signal.aborted, true)
  assert.equal(ui.pending('/rollback').length, 1)
  assert.deepEqual(ui.pending('/rollback')[0].body, { kind: 'packet', sessionId: 'a', runId, generation: obsoleteSend.body.generation })
  await bar.panel().onConfirm()
  assert.equal(ui.pending('/packet').length, 1, 'Confirm cannot bypass a pending rollback')
  ui.completePacket(obsoleteSend); await ui.flush()
  assert.equal(ui.submissions.length, 0)
  const previous = 'previous final English packet'
  ui.completeRollback(undefined, { packet: previous, chars: previous.length }); await ui.flush(); await rollback
  assert.equal(ui.hold('a').runId, runId)
  assert.equal(ui.hold('a').packet, previous)
  assert.equal(ui.hold('a').edited, previous)
  assert.equal(ui.hold('a').phase, 'review')
  assert.equal(ui.hold('a').pendingAuto, false)
  assert.equal(ui.hold('a').englishMode, true)
  assert.equal(ui.submissions.length, 0)
  assert.equal(packetReads(ui).length, 0, 'Rollback uses its authoritative response instead of another packet read')
  const confirmation = bar.panel().onConfirm(); await ui.flush()
  assert.equal(ui.pending('/packet').length, 2)
  assert.equal(ui.pending('/packet')[1].body.runId, runId)
  assert.equal(ui.pending('/packet')[1].body.text, previous)
  ui.completePacket(ui.pending('/packet')[1]); await ui.flush(); await confirmation
  assert.equal(ui.submissions.length, 1)
  assert.equal(ui.submissions[0].text, 'Translated user request')
  assert.equal(ui.submissions[0].commit.packet, previous)
})

test('late rollback responses cannot change a cancelled or regenerated run', async t => {
  for (const action of ['cancel', 'regen']) await t.test(action, async t => {
    const ui = loadHoldClient({ permission: 'review' }); t.after(() => ui.close())
    const bar = await start(ui)
    ui.completeInterpret(); await ui.flush()
    const oldRun = ui.hold('a').runId
    const rollback = bar.panel().onRollback(); await ui.flush()
    const request = ui.pending('/rollback')[0]
    if (action === 'cancel') {
      const cancellation = bar.panel().onCancel()
      ui.completePacket(); await ui.flush(); await cancellation
      bar.unmount(); ui.mount('a', original); await ui.flush()
    } else { bar.panel().onRegen(); await ui.flush() }
    assert.equal(request.signal.aborted, true)
    ui.completeRollback(request, { packet: 'stale rollback must never appear' }); await ui.flush(); await rollback
    assert.equal(ui.submissions.length, 0)
    if (action === 'cancel') assert.equal(ui.hold('a'), null)
    else {
      assert.notEqual(ui.hold('a').runId, oldRun)
      assert.equal(ui.hold('a').phase, 'optimizing')
      assert.equal(ui.hold('a').packet, '')
    }
    assert.equal(packetReads(ui).length, 0)
  })
})

test('edited review state stays a concrete object across remount and commits the edit once', async t => {
  const ui = loadHoldClient({ permission: 'review' }); t.after(() => ui.close())
  const first = await start(ui)
  ui.completeInterpret(); await ui.flush()
  assert.equal(ui.pending('/packet').length, 0)
  const edited = '这是用户审查后编辑的完整包'
  first.panel().onEdit({ target: { value: edited } })
  await ui.flush()
  assert.equal(typeof ui.hold('a'), 'object')
  assert.equal(ui.hold('a').edited, edited)
  assert.equal(ui.hold('a').text, original)
  first.unmount()
  const restored = ui.mount('a', original); await ui.flush()
  assert.equal(restored.panel().hold.edited, edited)
  const confirmation = restored.panel().onConfirm()
  await ui.flush()
  assert.equal(ui.pending('/packet').length, 1)
  assert.equal(ui.pending('/packet')[0].body.text, edited)
  assert.equal(ui.pending('/packet')[0].body.originalText, original)
  assert.equal(ui.submissions.length, 0)
  ui.completePacket(); await ui.flush(); await confirmation
  assert.equal(ui.submissions.length, 1)
  assert.equal(ui.submissions[0].text, original)
  assert.equal(ui.hold('a').edited, edited)
  assert.notEqual(ui.submissions[0].text, 'undefined')
})

test('a cancel from a remounted bar aborts the shared request and rejects its completion after another remount', async t => {
  const serverFloor = Date.now() + 60000
  const ui = loadHoldClient({ permission: 'review', optimizationGeneration: serverFloor }); t.after(() => ui.close())
  const first = await start(ui)
  const oldRequest = ui.pending('/interpret')[0]
  first.unmount()
  assert.equal(oldRequest.signal.aborted, false, 'Changing sessions is not a cancellation')
  const restored = ui.mount('a', original); await ui.flush()
  const cancellation = restored.panel().onCancel()
  assert.equal(oldRequest.signal.aborted, true, 'The remount must abort the original controller')
  assert.equal(ui.pending('/packet').length, 1)
  assert.deepEqual(ui.pending('/packet')[0].body, { sessionId: 'a', runId: oldRequest.body.messageId, generation: oldRequest.body.generation, text: '', disposition: 'cancel', originalText: original, outgoingText: original })
  ui.completePacket(); await ui.flush(); await cancellation
  assert.equal(ui.hold('a'), null)
  restored.unmount()
  const current = await start(ui)
  const newRequest = ui.pending('/interpret').at(-1)
  assert.notEqual(newRequest.body.messageId, oldRequest.body.messageId)
  assert.ok(Number.isSafeInteger(oldRequest.body.generation) && oldRequest.body.generation > serverFloor, 'A fresh run starts above the observed server generation')
  assert.ok(newRequest.body.generation > oldRequest.body.generation, 'Run generation remains monotonic across remount and cancellation')
  ui.completeInterpret(oldRequest, { packet: '迟到且必须丢弃的旧结果', outgoingText: 'must never send' })
  await ui.flush()
  assert.equal(ui.hold('a').runId, newRequest.body.messageId)
  assert.equal(ui.hold('a').phase, 'optimizing')
  assert.equal(ui.submissions.length, 0)
  ui.completeInterpret(newRequest, { packet: '这一轮的结果' }); await ui.flush()
  assert.equal(current.panel().hold.packet, '这一轮的结果')
  assert.equal(ui.requests.some(req => req.path === '/inference-cancel'), false)
})

for (const action of ['onSkip', 'onOriginal']) {
  test(action + ' aborts interpretation and arms exactly one packet-free original send', async t => {
    const ui = loadHoldClient({ englishMode: true }); t.after(() => ui.close())
    const bar = await start(ui)
    const interpretation = ui.pending('/interpret')[0]
    bar.panel()[action](); bar.panel()[action]()
    await ui.flush()
    assert.equal(interpretation.signal.aborted, true)
    assert.ok(ui.order.findIndex(event => event.type === 'abort' && event.path === '/interpret')
      < ui.order.findIndex(event => event.type === 'request' && event.path === '/packet'), 'Abort must precede the skip write')
    assert.equal(ui.pending('/packet').length, 1)
    assert.deepEqual(ui.pending('/packet')[0].body, { sessionId: 'a', runId: interpretation.body.messageId, generation: interpretation.body.generation, text: '', disposition: 'skip', originalText: original, outgoingText: original })
    assert.equal(ui.submissions.length, 0)
    ui.completeInterpret(interpretation, { packet: 'must be discarded', outgoingText: 'translation must be discarded', englishMode: true })
    await ui.flush()
    assert.equal(ui.submissions.length, 0)
    ui.completePacket(); await ui.flush()
    assert.equal(ui.submissions.length, 1)
    assert.equal(ui.submissions[0].text, original)
    assert.equal(ui.submissions[0].commit.disposition, 'skip')
    assert.equal(ui.submissions[0].commit.packet, '')
    assert.equal(ui.hold('a').packet, '')
    assert.equal(ui.hold('a').englishMode, false)
    assert.equal(ui.hold('a').injectCard, false)
    assert.equal(ui.pending('/interpret').length, 1)
    assert.equal(ui.requests.some(req => req.path === '/inference-cancel'), false)
    assert.equal(packetReads(ui).length, 0)
  })
}

test('packet write failures and mismatched run acknowledgements never release, including after restore', async t => {
  for (const action of ['auto', 'review', 'onSkip', 'onOriginal', 'wrong-run']) await t.test(action, async t => {
    const ui = loadHoldClient({ permission: action === 'review' ? 'review' : 'auto' }); t.after(() => ui.close())
    const bar = await start(ui)
    if (action === 'onSkip' || action === 'onOriginal') bar.panel()[action]()
    else { ui.completeInterpret(); await ui.flush(); if (action === 'review') bar.panel().onConfirm() }
    await ui.flush()
    assert.equal(ui.pending('/packet').length, 1)
    ui.completePacket(undefined, action === 'wrong-run' ? { runId: 'someone-elses-run' } : { ok: false, reason: 'write-failed:disk' })
    await ui.flush()
    assert.equal(ui.submissions.length, 0)
    assert.equal(ui.hold('a').phase, 'error')
    assert.equal(ui.hold('a').pendingAuto, false)
    bar.unmount(); ui.mount('a', original); await ui.flush()
    assert.equal(ui.submissions.length, 0)
    assert.equal(ui.pending('/packet').length, 1, 'Restore must not silently retry a failed write')
  })
})

test('a complete English result survives both a background completion and a background commit, then releases once', async t => {
  const ui = loadHoldClient({ englishMode: true, sessionSettings: { b: { englishMode: false } } }); t.after(() => ui.close())
  const first = await start(ui)
  const interpretation = ui.pending('/interpret')[0]
  first.unmount()
  const other = ui.mount('b', 'B session draft'); await ui.flush()
  const result = { packet: '[English framing already rendered] Full requirements', chars: 51,
    outgoingText: 'The complete English user request', englishMode: true, translation: { text: 'The complete English user request', literals: ['C:/user/path'] },
    noAddition: false, understanding: { goal: 'full goal' }, support: { evidence: ['input'] },
    usage: { input: 120, output: 60 }, usageTotal: 180, ms: 3210, route: { provider: 'p', model: 'm' }, unsourced: 2 }
  ui.completeInterpret(interpretation, result); await ui.flush()
  assert.equal(ui.pending('/packet').length, 0, 'A background result must wait for its own session')
  assert.equal(ui.submissions.length, 0)
  for (const [key, value] of Object.entries(result)) assert.deepEqual(plain(ui.hold('a')[key]), value, key + ' must survive the bridge')
  assert.equal(ui.hold('a').edited, result.packet)
  assert.equal(ui.hold('a').text, original)
  assert.equal(ui.hold('b'), null)
  other.unmount()
  const returning = ui.mount('a', original); await ui.flush()
  assert.equal(ui.pending('/packet').length, 1)
  const commit = ui.pending('/packet')[0]
  assert.equal(commit.body.text, result.packet)
  assert.equal(commit.body.outgoingText, result.outgoingText)
  assert.equal(commit.body.originalText, original)
  assert.equal(commit.body.generation, interpretation.body.generation)
  assert.equal(ui.submissions.length, 0)
  returning.unmount()
  const elsewhere = ui.mount('b', 'untouched B draft'); await ui.flush()
  ui.completePacket(commit); await ui.flush()
  assert.equal(ui.submissions.length, 0, 'A successful background commit must not submit through old input actions')
  assert.equal(ui.hold('a').pendingAuto, true)
  elsewhere.unmount()
  const finalMount = ui.mount('a', original); await ui.flush()
  assert.equal(ui.pending('/packet').length, 1, 'The restored action must reuse its existing commit')
  assert.equal(ui.submissions.length, 1)
  assert.equal(ui.submissions[0].sessionId, 'a')
  assert.equal(ui.submissions[0].mountId, finalMount.id)
  assert.equal(ui.submissions[0].text, result.outgoingText)
  assert.equal(first.draft, original)
  assert.equal(elsewhere.draft, 'untouched B draft')
  assert.equal(ui.hold('a').englishMode, true)
  assert.deepEqual(plain(ui.hold('a').translation), result.translation)
  finalMount.unmount(); ui.mount('a', original); await ui.flush()
  assert.equal(ui.submissions.length, 1, 'A terminal run cannot be sent again by remount')
})

test('an empty committed interpretation still uses the same acknowledgement gate without polling', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  await start(ui)
  ui.completeInterpret(undefined, { status: 'empty', packet: '', chars: 0, noAddition: true }); await ui.flush()
  assert.equal(ui.pending('/packet').length, 1)
  assert.equal(ui.pending('/packet')[0].body.text, '')
  assert.equal(ui.pending('/packet')[0].body.disposition, 'send')
  ui.advance(20000); await ui.flush()
  assert.equal(packetReads(ui).length, 0)
  assert.equal(ui.submissions.length, 0, 'There is no timeout that sends without an acknowledgement')
  ui.completePacket(); await ui.flush()
  assert.equal(ui.submissions.length, 1)
  assert.equal(ui.submissions[0].text, original)
})

test('a previous sent run cleanup cannot erase a new run after remount', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const first = await start(ui)
  ui.completeInterpret(); await ui.flush()
  ui.completePacket(); await ui.flush()
  const oldRun = ui.hold('a').runId
  first.unmount()
  const current = ui.mount('a', original); await ui.flush()
  current.panel().onRegen(); await ui.flush()
  const newRun = ui.hold('a').runId
  assert.notEqual(newRun, oldRun)
  ui.advance(1600); await ui.flush()
  assert.equal(ui.hold('a').runId, newRun)
  assert.equal(ui.hold('a').phase, 'optimizing')
  assert.equal(ui.submissions.length, 1)
})

test('an older mounted bar cannot reclaim submission ownership by rendering in the background', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const background = await start(ui, 'a')
  const interpretation = ui.pending('/interpret')[0]
  const foreground = ui.mount('b', 'B draft'); await ui.flush()
  background.dirty = true
  await ui.flush()
  ui.completeInterpret(interpretation); await ui.flush()
  assert.equal(ui.hold('a').packet, '最终注入文')
  assert.equal(ui.hold('a').pendingAuto, true)
  assert.equal(ui.pending('/packet').length, 0)
  assert.equal(ui.submissions.length, 0)
  background.unmount(); foreground.unmount()
  const restored = ui.mount('a', original); await ui.flush()
  ui.completePacket(); await ui.flush()
  assert.equal(ui.submissions.length, 1)
  assert.equal(ui.submissions[0].mountId, restored.id)
})

test('interpretation failure preserves review consent and automatic original sends still require a skip acknowledgement', async t => {
  for (const permission of ['auto', 'review']) await t.test(permission, async t => {
    const ui = loadHoldClient({ permission }); t.after(() => ui.close())
    await start(ui)
    ui.completeInterpret(undefined, { ok: false, reason: 'upstream-failed' }); await ui.flush()
    assert.equal(ui.submissions.length, 0)
    if (permission === 'review') {
      assert.equal(ui.pending('/packet').length, 0)
      assert.equal(ui.hold('a').phase, 'error')
    } else {
      assert.equal(ui.pending('/packet').length, 1)
      assert.equal(ui.pending('/packet')[0].body.disposition, 'skip')
      assert.equal(ui.pending('/packet')[0].body.outgoingText, original)
      ui.completePacket(); await ui.flush()
      assert.equal(ui.submissions.length, 1)
      assert.equal(ui.hold('a').reason, 'upstream-failed')
      assert.equal(ui.submissions[0].commit.packet, '')
    }
  })
})

test('cancel supersedes an in-flight send commit and blocks both late acknowledgements after remount', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const first = await start(ui)
  ui.completeInterpret(); await ui.flush()
  const send = ui.pending('/packet')[0]
  const cancellation = first.panel().onCancel()
  await ui.flush()
  assert.equal(send.signal.aborted, true)
  const cancel = ui.pending('/packet')[1]
  assert.equal(cancel.body.disposition, 'cancel')
  first.unmount(); ui.mount('a', original); await ui.flush()
  ui.completePacket(send); await ui.flush()
  assert.equal(ui.hold('a'), null)
  assert.equal(ui.submissions.length, 0)
  ui.completePacket(cancel); await ui.flush(); await cancellation
  assert.equal(ui.submissions.length, 0)
  assert.equal(ui.hold('a'), null)
})

test('skip supersedes an in-flight send commit and discards its late acknowledgement', async t => {
  const ui = loadHoldClient({ englishMode: true }); t.after(() => ui.close())
  const bar = await start(ui)
  ui.completeInterpret(undefined, { outgoingText: 'English translation', englishMode: true }); await ui.flush()
  const obsoleteCommit = ui.pending('/packet')[0]
  bar.panel().onSkip(); await ui.flush()
  assert.equal(obsoleteCommit.signal.aborted, true)
  assert.equal(ui.pending('/packet').length, 2)
  assert.equal(ui.pending('/packet')[1].body.disposition, 'skip')
  ui.completePacket(obsoleteCommit); await ui.flush()
  assert.equal(ui.submissions.length, 0)
  ui.completePacket(ui.pending('/packet')[1]); await ui.flush()
  assert.equal(ui.submissions.length, 1)
  assert.equal(ui.submissions[0].text, original)
  assert.equal(ui.submissions[0].commit.packet, '')
})
