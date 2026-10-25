import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHoldClient } from './fixtures/client-hold-harness.mjs'

const original = "  \n用户的原始草稿\t\n  "
const attr = (bar, name) => bar.find(node => node.props?.['data-po06'] === name)
const panel = (ui, bar) => bar.find(node => node.type === ui.mod.__debug.InterceptPanel)
const mismatch = new RegExp('backend/UI version mismatch', 'i')
async function start(ui) {
  const bar = ui.mount('a', original)
  await ui.flush()
  assert.equal(bar.enter().defaultPrevented, true)
  await ui.flush()
  return bar
}
function untouched(ui, bar) {
  assert.equal(ui.submissions.length, 0)
  assert.equal(bar.draft, original)
  assert.equal(ui.order.some(event => event.type === 'draft'), false)
  assert.equal(ui.pending('/settings').length, 0, 'Protocol checks must not change user settings')
}
async function refreshRevision(ui, revision) {
  ui.setPipelineRevision(revision)
  ui.advance(15000)
  await ui.flush()
}

test('loaded missing or incompatible ABI leaves ordinary Enter and send click usable', async t => {
  for (const revision of [undefined, null, 'older-pipeline']) await t.test(String(revision), async t => {
    const ui = loadHoldClient(); t.after(() => ui.close())
    ui.setPipelineRevision(revision)
    const bar = ui.mount('a', original)
    await ui.flush()
    assert.match(attr(bar, 'pipeline-mismatch').children.join(''), mismatch)
    assert.equal(attr(bar, 'pipeline-mismatch').props.role, 'alert')
    assert.equal(attr(bar, 'bar').props['data-po06-actions'], '0')
    assert.notEqual(bar.enter().defaultPrevented, true)
    assert.notEqual(bar.clickSend().defaultPrevented, true)
    await ui.flush()
    assert.equal(ui.pending('/interpret').length, 0)
    assert.equal(ui.pending('/packet').length, 0)
    assert.equal(ui.hold('a'), null)
    untouched(ui, bar)
  })
})

test('initial unknown/loading status never intercepts until the exact ABI arrives', async t => {
  for (const result of ['matching', 'missing', 'unavailable']) await t.test(result, async t => {
    const ui = loadHoldClient({ deferStatus: true }); t.after(() => ui.close())
    const bar = ui.mount('a', original)
    assert.notEqual(bar.enter().defaultPrevented, true)
    assert.notEqual(bar.clickSend().defaultPrevented, true)
    await ui.flush()
    assert.equal(attr(bar, 'pipeline-mismatch'), null, 'Loading is not a known version mismatch')
    assert.equal(ui.pending('/interpret').length, 0)
    const request = ui.requests.find(req => req.path === '/status')
    if (result === 'matching') ui.completeStatus(request)
    else if (result === 'missing') ui.completeStatus(request, { capability: {} })
    else request.respond({ ok: false, reason: 'unreachable' }, 503)
    await ui.flush()
    if (result === 'matching') {
      assert.equal(bar.enter().defaultPrevented, true)
      assert.equal(ui.pending('/interpret').length, 1)
    } else {
      assert.notEqual(bar.enter().defaultPrevented, true)
      assert.notEqual(bar.clickSend().defaultPrevented, true)
      assert.equal(ui.pending('/interpret').length, 0)
      assert.ok(attr(bar, result === 'missing' ? 'pipeline-mismatch' : 'status-error'))
    }
    untouched(ui, bar)
  })
})

test('a restored automatic hold waits for loaded ABI before any packet commit', async t => {
  const ui = loadHoldClient({ deferStatus: true }); t.after(() => ui.close())
  ui.mod.__debug.holdBridgeWrite('a', { runId: 'persisted-run', generation: 17, text: original,
    phase: 'review', packet: 'complete packet', pendingAuto: true })
  const bar = ui.mount('a', original)
  await ui.flush()
  assert.equal(ui.pending('/interpret').length, 0)
  assert.equal(ui.pending('/packet').length, 0)
  assert.equal(ui.win.__PO06_HOLD_RUNS__.a, undefined, 'Unknown status must not claim the restored run')
  ui.completeStatus(); await ui.flush()
  assert.equal(ui.pending('/packet').length, 1)
  assert.equal(ui.pending('/packet')[0].body.runId, 'persisted-run')
  untouched(ui, bar)
  ui.completePacket(); await ui.flush()
  assert.equal(ui.submissions.length, 1)
  assert.equal(ui.submissions[0].text, original)
})

test('ordinary pending status refresh preserves a previously confirmed live run', async t => {
  const ui = loadHoldClient({ deferStatus: true }); t.after(() => ui.close())
  const bar = ui.mount('a', original)
  ui.completeStatus(); await ui.flush()
  bar.enter(); await ui.flush()
  const request = ui.pending('/interpret')[0]
  ui.advance(15000); await ui.flush()
  assert.equal(request.signal.aborted, false)
  assert.equal(ui.hold('a').phase, 'optimizing')
  assert.equal(attr(bar, 'pipeline-mismatch'), null)
  ui.completeInterpret(request); await ui.flush()
  ui.completePacket(); await ui.flush()
  assert.equal(ui.submissions.length, 1)
})

test('loaded old ABI locally retires restored legacy, running, completed, and committing holds', async t => {
  for (const state of ['legacy', 'optimizing', 'completed', 'committing']) await t.test(state, async t => {
    const ui = loadHoldClient(); t.after(() => ui.close())
    let interpretation, commit, run
    if (state === 'legacy') {
      ui.mod.__debug.holdBridgeWrite('a', { text: original, phase: 'error', packet: 'old packet', pendingAuto: true })
    } else {
      const first = await start(ui)
      interpretation = ui.pending('/interpret')[0]
      run = ui.win.__PO06_HOLD_RUNS__.a
      if (state === 'committing') { ui.completeInterpret(interpretation); await ui.flush(); commit = ui.pending('/packet')[0] }
      first.unmount()
      if (state === 'completed') { ui.completeInterpret(interpretation); await ui.flush() }
    }
    const packetCount = ui.pending('/packet').length
    const stale = ui.hold('a')
    ui.setPipelineRevision(undefined)
    const restored = ui.mount('a', original)
    await ui.flush()
    assert.match(attr(restored, 'pipeline-mismatch').children.join(''), mismatch)
    assert.equal(ui.hold('a'), null)
    assert.equal(panel(ui, restored), null)
    assert.equal(restored.find(node => node.type?.name === 'InterceptBall'), null)
    assert.equal(ui.pending('/packet').length, packetCount, 'Never send new skip/cancel to an older backend')
    if (run) {
      assert.equal(run.stopped, true)
      if (state === 'optimizing') assert.equal(interpretation.signal.aborted, true)
      if (commit) assert.equal(commit.signal.aborted, true)
    } else assert.equal(ui.win.__PO06_HOLD_RUNS__.a, undefined, 'Never synthesize identity for a legacy hold')
    ui.mod.__debug.holdBridgeWrite('a', stale)
    await ui.flush()
    assert.equal(ui.hold('a'), null, 'A stale broadcast cannot reinstall the retired panel')
    if (state === 'optimizing') ui.completeInterpret(interpretation)
    if (commit) ui.completePacket(commit)
    await ui.flush()
    assert.equal(ui.hold('a'), null)
    assert.equal(ui.pending('/packet').length, packetCount)
    assert.notEqual(restored.enter().defaultPrevented, true)
    assert.notEqual(restored.clickSend().defaultPrevented, true)
    untouched(ui, restored)
  })
})

test('an ABI change during interpret, packet, or rollback blocks late commit and send even after recovery', async t => {
  for (const action of ['interpret', 'packet', 'rollback']) await t.test(action, async t => {
    const ui = loadHoldClient(); t.after(() => ui.close())
    const bar = await start(ui)
    const interpretation = ui.pending('/interpret')[0]
    let request = interpretation
    if (action !== 'interpret') {
      ui.completeInterpret(interpretation); await ui.flush()
      request = ui.pending('/packet')[0]
    }
    if (action === 'rollback') { bar.panel().onRollback(); await ui.flush(); request = ui.pending('/rollback')[0] }
    const stalePanel = bar.panel()
    const packets = ui.pending('/packet').length
    const interpretations = ui.pending('/interpret').length
    await refreshRevision(ui, 'different-api')
    assert.equal(request.signal.aborted, true)
    assert.equal(ui.hold('a'), null)
    assert.equal(panel(ui, bar), null)
    stalePanel.onRegen(); stalePanel.onConfirm(); stalePanel.onOriginal(); stalePanel.onSkip()
    await ui.flush()
    assert.equal(ui.pending('/interpret').length, interpretations, 'A stale regenerate callback cannot bypass the ABI gate')
    assert.equal(ui.pending('/packet').length, packets)
    await refreshRevision(ui, 'single-run-1')
    assert.equal(attr(bar, 'pipeline-mismatch'), null)
    if (action === 'interpret') ui.completeInterpret(request)
    else if (action === 'packet') ui.completePacket(request)
    else ui.completeRollback(request)
    await ui.flush()
    assert.equal(ui.hold('a'), null)
    assert.equal(ui.pending('/packet').length, packets)
    untouched(ui, bar)
    assert.equal(bar.enter().defaultPrevented, true, 'Matching status can arm a new run without changing settings')
    assert.equal(ui.pending('/interpret').length, interpretations + 1)
  })
})

test('raw interpret success missing current ABI fields is a visible mismatch, never an automatic skip', async t => {
  for (const omitted of ['old-shape', 'runId', 'status', 'packet']) await t.test(omitted, async t => {
    const ui = loadHoldClient(); t.after(() => ui.close())
    const bar = await start(ui)
    const request = ui.pending('/interpret')[0]
    const result = { ok: true, runId: request.body.messageId, status: 'ready', packet: 'generated packet' }
    if (omitted === 'old-shape') { delete result.runId; delete result.status }
    else delete result[omitted]
    request.respond(result)
    await ui.flush()
    const held = ui.hold('a')
    assert.equal(held.phase, 'error')
    assert.equal(held.pendingAuto, false)
    assert.equal(held.text, original)
    assert.match(held.reason, mismatch)
    assert.equal(bar.panel().hold.reason, held.reason)
    assert.equal(ui.pending('/packet').length, 0)
    bar.unmount()
    const restored = ui.mount('a', original); await ui.flush()
    const callbacks = restored.panel()
    callbacks.onConfirm(); callbacks.onOriginal(); callbacks.onSkip(); callbacks.onRollback()
    await ui.flush()
    assert.equal(ui.pending('/packet').length, 0)
    assert.equal(ui.pending('/rollback').length, 0)
    untouched(ui, restored)
    await callbacks.onCancel(); await ui.flush()
    assert.equal(ui.hold('a'), null, 'A malformed legacy response can be dismissed locally')
    assert.equal(ui.pending('/packet').length, 0)
  })
})

test('wrong nonempty interpret runId under matching ABI remains a strict identity error', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const bar = await start(ui)
  const request = ui.pending('/interpret')[0]
  request.respond({ ok: true, runId: 'another-run', status: 'ready', packet: 'wrong result' })
  await ui.flush()
  assert.equal(ui.hold('a').runId, request.body.messageId)
  assert.match(ui.hold('a').reason, /invalid-interpret-response/)
  assert.doesNotMatch(ui.hold('a').reason, mismatch)
  await bar.panel().onConfirm(); await bar.panel().onOriginal(); await ui.flush()
  assert.equal(ui.pending('/packet').length, 0)
  untouched(ui, bar)
})

test('raw packet success missing runId or packet never releases or becomes a restored automatic retry', async t => {
  for (const omitted of ['runId', 'packet']) await t.test(omitted, async t => {
    const ui = loadHoldClient(); t.after(() => ui.close())
    const bar = await start(ui)
    ui.completeInterpret(); await ui.flush()
    const request = ui.pending('/packet')[0]
    const result = { ok: true, runId: request.body.runId, packet: request.body.text }
    delete result[omitted]
    request.respond(result)
    await ui.flush()
    assert.equal(ui.hold('a').phase, 'error')
    assert.match(ui.hold('a').reason, mismatch)
    assert.equal(ui.hold('a').pendingAuto, false)
    bar.unmount()
    const restored = ui.mount('a', original); await ui.flush()
    assert.equal(ui.pending('/packet').length, 1)
    untouched(ui, restored)
  })
})

test('HTTP 500 forces failure for success-shaped send, skip, and cancel packet acknowledgements', async t => {
  for (const disposition of ['send', 'skip', 'cancel']) for (const reason of [undefined, 'write-rejected']) await t.test(disposition + '/' + String(reason), async t => {
    const ui = loadHoldClient(); t.after(() => ui.close())
    const bar = await start(ui)
    if (disposition === 'send') { ui.completeInterpret(); await ui.flush() }
    else if (disposition === 'skip') bar.panel().onSkip()
    else bar.panel().onCancel()
    await ui.flush()
    const request = ui.pending('/packet')[0]
    request.respond({ ok: true, runId: request.body.runId, packet: request.body.text, ...(reason ? { reason } : {}) }, 500)
    await ui.flush()
    assert.equal(ui.hold('a').phase, 'error')
    assert.equal(ui.hold('a').pendingAuto, false)
    assert.match(ui.hold('a').reason, reason ? /write-rejected/ : /HTTP 500/)
    untouched(ui, bar)
    bar.unmount(); ui.mount('a', original); await ui.flush()
    assert.equal(ui.pending('/packet').length, 1)
    assert.equal(ui.submissions.length, 0)
  })
})

test('HTTP 500 interpret success is treated as failure and cannot release through a success-shaped HTTP 500 skip', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const bar = await start(ui)
  const request = ui.pending('/interpret')[0]
  request.respond({ ok: true, runId: request.body.messageId, status: 'ready', packet: 'not a successful interpretation' }, 500)
  await ui.flush()
  const skip = ui.pending('/packet')[0]
  assert.equal(skip.body.disposition, 'skip')
  assert.equal(skip.body.text, '')
  untouched(ui, bar)
  skip.respond({ ok: true, runId: skip.body.runId, packet: '' }, 500)
  await ui.flush()
  assert.match(ui.hold('a').reason, /HTTP 500/)
  untouched(ui, bar)
})
