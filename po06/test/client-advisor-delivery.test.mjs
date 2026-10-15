import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const value = (sessionId = 's-1', seq = 30, extra = {}) => ({
  ok: true, sessionId, seq, requestId: 'human:10', status: 'reviewed-scope',
  checks: [{ criterion: 'Original requirement', status: 'satisfied' }],
  counts: { failed: 0, unverified: 0, stale: 0, satisfied: 1 },
  limitations: [], completionClaimAllowed: false, scopeOnly: true, ...extra,
})
const ownerProps = (extra = {}) => ({
  sessionId: 's-1', seq: 30,
  turn: { turn: 7, start: undefined, end: undefined, status: 'closed', steps: [], data: {} },
  openFile() { throw new Error('delivery annotation must not open or block files') },
  ...extra,
})
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }

// Execute the entire shipped loader module in an isolated VM. The deterministic
// hook driver exposes render-before-effect races, but is not a browser/React test.
function load(locale = 'en', { abortSupport = true } = {}) {
  const entries = [], requests = [], timers = new Map(), intervals = new Map(), subscribers = new Set()
  let factory, nextTimer = 0, active = null, language = locale
  const localeService = {
    getSnapshot: () => ({ active: language }),
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn) },
  }
  const win = {
    __ModuleLoader__: { load: r => { factory = r.factory } },
    addEventListener() {}, removeEventListener() {},
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id },
    clearTimeout(id) { timers.delete(id) },
    setInterval(fn, ms) { const id = ++nextTimer; intervals.set(id, { fn, ms }); return id },
    clearInterval(id) { intervals.delete(id) },
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useState(initial) {
      assert.ok(active, 'hook must run in the lifecycle driver')
      const owner = active, at = owner.cursor++
      if (!(at in owner.states)) owner.states[at] = typeof initial === 'function' ? initial() : initial
      return [owner.states[at], next => {
        if (owner.unmounted) owner.postUnmountUpdates++
        owner.updates++
        owner.states[at] = typeof next === 'function' ? next(owner.states[at]) : next
      }]
    },
    useRef(initial) {
      const owner = active, at = owner.cursor++
      return owner.refs[at] || (owner.refs[at] = { current: initial })
    },
    useEffect(effect, deps) {
      const owner = active, at = owner.cursor++
      const old = owner.effects[at]
      if (!old || deps.length !== old.deps.length || deps.some((v, i) => !Object.is(v, old.deps[i]))) owner.pending.push({ at, effect, deps })
    },
    useCallback: f => f,
    useMemo: f => f(),
  }
  const req = name => name === 'react' ? React : {}
  const fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }))
  runInNewContext(source, { window: win, document: {}, fetch, console,
    AbortController: abortSupport ? AbortController : undefined,
    requestAnimationFrame: fn => fn() }, { filename: 'po06/lib/client.js' })
  assert.equal(typeof factory, 'function', 'the real loader entry is evaluated')
  const mod = factory(req)
  const dispose = mod.apply({ locale: localeService, slots: {
    register(def, component) {
      const entry = { def, component, disposed: false, renderers: new Set() }
      entries.push(entry)
      // Simulate the host unregistering a slot: all mounted component effects
      // are unmounted too, so apply disposal tests the actual abort cleanup.
      return () => {
        entry.disposed = true
        for (const r of entry.renderers) r.unmount()
        entry.renderers.clear()
      }
    },
    inject(_name, register) { return register() },
  } })
  const d = mod.__debug
  function renderer(component) {
    const owner = { cursor: 0, states: [], refs: [], effects: [], pending: [], unmounted: false, postUnmountUpdates: 0, updates: 0, hookCount: null }
    return {
      owner,
      render(props, commit = true) {
        assert.equal(owner.unmounted, false, 'do not render an unmounted component')
        owner.cursor = 0; owner.pending = []
        active = owner
        let result
        try { result = component(props) } finally { active = null }
        if (owner.hookCount === null) owner.hookCount = owner.cursor
        assert.equal(owner.cursor, owner.hookCount, 'owner rebinding preserves hook order')
        if (commit) this.commit()
        return result
      },
      commit() {
        const pending = owner.pending
        owner.pending = []
        for (const p of pending) owner.effects[p.at]?.cleanup?.()
        for (const p of pending) owner.effects[p.at] = { deps: p.deps, cleanup: p.effect() }
      },
      unmount() {
        if (owner.unmounted) return
        owner.unmounted = true
        for (const effect of owner.effects) effect?.cleanup?.()
        owner.pending = []
      },
    }
  }
  function mountTail() {
    const entry = entries.findLast(e => e.def.name === 'conversation.chat.turnTail' && !e.disposed)
    assert.ok(entry, 'the additive turnTail entry is registered')
    const r = renderer(entry.component)
    entry.renderers.add(r)
    return r
  }
  function respond(index, data, status = 200) {
    requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => data })
  }
  function timeout() {
    const timer = [...timers].find(([, t]) => t.ms === d.ADVISOR_DELIVERY_TIMEOUT_MS)
    assert.ok(timer, 'delivery request has its timeout')
    timers.delete(timer[0]); timer[1].fn()
  }
  function setLocale(next) { language = next; for (const fn of subscribers) fn() }
  return { d, entries, requests, timers, intervals, subscribers, dispose, renderer, mountTail, respond, timeout, setLocale }
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ')
  if (node && typeof node === 'object') return text(node.children)
  return node === null || node === undefined || node === false ? '' : String(node)
}
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  return node && typeof node === 'object' ? [node, ...descendants(node.children)] : []
}
const refreshButton = node => descendants(node).find(n => n.type === 'button')

// Slot lifecycle and installed SDK currency: flattened Session + TurnTailOwnerProps.
test('one additive turnTail list item owns mount/dispose and does not replace assistant or file actions', async () => {
  const h = load(), tail = h.entries.filter(e => e.def.name === 'conversation.chat.turnTail')
  assert.equal(tail.length, 1)
  assert.equal(tail[0].def.id, 'dsh-po06-advisor-delivery')
  assert.equal(tail[0].def.order, 10)
  assert.equal(tail[0].def.key, undefined)
  assert.equal(tail[0].component, h.d.AdvisorDeliveryTail)
  assert.equal(h.entries.some(e => ['conversation.chat.node', 'conversation.chat.assistant-actions', 'deliverables.file.actions'].includes(e.def.name)), false)
  const r = h.mountTail()
  r.render(ownerProps())
  assert.equal(h.requests.length, 1)
  assert.equal(h.subscribers.size, 1)
  h.dispose()
  assert.equal(tail[0].disposed, true)
  assert.equal(r.owner.unmounted, true)
  assert.equal(h.requests[0].options.signal.aborted, true)
  assert.equal(h.timers.size, 0)
  assert.equal(h.subscribers.size, 0)
  h.respond(0, value()); await flush()
  assert.equal(r.owner.postUnmountUpdates, 0)
})

test('owned remount unmounts the prior tail and drops its late same-identity request', async () => {
  const h = load(), old = h.mountTail(), props = ownerProps()
  old.render(props)
  h.d.remount('conversation.chat.turnTail')
  assert.equal(old.owner.unmounted, true)
  assert.equal(h.requests[0].options.signal.aborted, true)
  const current = h.mountTail()
  current.render(props)
  assert.equal(h.requests.length, 2)
  h.respond(1, value('s-1', 30, { requestId: 'current-mount', status: 'not-reviewed' })); await flush()
  h.respond(0, value('s-1', 30, { requestId: 'old-mount', status: 'known-defects' })); await flush()
  const view = current.render(props)
  assert.equal(view.props['data-po06-delivery-request'], 'current-mount')
  assert.equal(view.props['data-po06-delivery-status'], 'not-reviewed')
  assert.equal(old.owner.postUnmountUpdates, 0)
  h.dispose()
})

test('exact identity is a Session plus safe event seq, never a display turn number or coerced string', () => {
  const h = load(), { d } = h
  assert.equal(d.advisorDeliveryKey('s-1', 0), '["s-1",0]')
  for (const seq of [-1, NaN, Infinity, 1.5, '30', Number.MAX_SAFE_INTEGER + 1, undefined, null]) assert.equal(d.advisorDeliveryKey('s-1', seq), null)
  for (const sid of ['', null, 123, undefined]) assert.equal(d.advisorDeliveryKey(sid, 30), null)
  assert.ok(d.advisorDeliveryValue(value(), 's-1', 30))
  for (const extra of [{ sessionId: 's-2' }, { seq: 31 }, { seq: '30' }, { ok: false }, { status: 'pass' }, { scopeOnly: false }, { scopeOnly: undefined }, { completionClaimAllowed: true }, { completionClaimAllowed: undefined }]) {
    assert.equal(d.advisorDeliveryValue(value('s-1', 30, extra), 's-1', 30), null)
  }
  assert.equal(d.advisorDeliveryValue(value('', 30), '', 30), null)
  h.dispose()
})

test('owner shape guard declines malformed owner props without fetching or guessing Session/seq', () => {
  const h = load(), r = h.mountTail()
  const invalid = [undefined, null, 5, 'turn', [], {},
    ownerProps({ turn: undefined }), ownerProps({ turn: 7 }), ownerProps({ turn: [] }),
    ...[NaN, Infinity, 1.5, -1, '7', Number.MAX_SAFE_INTEGER + 1, undefined].map(turn => ownerProps({ turn: { turn } })),
    ...[undefined, '', 42].map(sessionId => ownerProps({ sessionId, turn: { turn: 7, sessionId: 'do-not-infer' } })),
    ...[undefined, '30', -1, 1.5].map(seq => ownerProps({ seq, turn: { turn: 30, end: { seq: 30 } } })),
  ]
  for (const props of invalid) {
    assert.equal(h.d.advisorDeliveryBinding(props), null)
    assert.equal(r.render(props), null)
  }
  assert.equal(h.requests.length, 0)
  assert.equal(h.timers.size, 0)
  h.dispose()
})

test('a Turn without closing assistant still uses host seq; turn number changes are display-only', async () => {
  const h = load(), r = h.mountTail(), props = ownerProps()
  assert.equal(props.turn.end, undefined)
  r.render(props)
  assert.equal(h.requests[0].url, '/po06/api/advisor-delivery?session=s-1&seq=30')
  h.respond(0, value()); await flush()
  const changedTurn = { ...props, turn: { ...props.turn, turn: 9, end: { seq: 999 } } }
  const view = r.render(changedTurn)
  assert.match(text(view), /Turn 9/)
  assert.equal(view.props['data-po06-delivery-seq'], 30)
  assert.equal(h.requests.length, 1, 'turn metadata is not part of the request binding')
  h.dispose()
})

test('endpoint status is authoritative, not recomputed from counts, retained checks, or assistant prose', () => {
  const h = load(), { d } = h
  const counts = { failed: 3, unverified: 2, stale: 1, satisfied: 0 }
  const checks = [{ criterion: 'Retained older evidence', status: 'failed' }]
  for (const status of ['known-defects', 'verification-pending', 'reviewed-scope', 'not-reviewed', 'unavailable']) {
    assert.equal(d.advisorDeliveryValue(value('s-1', 30, { status, counts, checks }), 's-1', 30).status, status)
    assert.equal(d.advisorDeliveryValue(value('s-1', 30, { status, counts: {}, checks: [] }), 's-1', 30).status, status)
  }
  h.dispose()
})

test('bounded plain-text metadata and unknown check/contribution states cannot become a verdict', () => {
  const h = load(), { d } = h
  const data = d.advisorDeliveryValue(value('s-1', 30, {
    checks: [null, { criterion: 3 }, { criterion: '  a\n b  ', status: 'unknown', action: '<script>not executed</script>' },
      ...Array.from({ length: 40 }, () => ({ criterion: 'x'.repeat(900), status: 'satisfied' }))],
    limitations: [null, false, '   ', ...Array(9).fill('x'.repeat(900))],
    contribution: { status: 'pass', summary: 'not accepted' },
    counts: { failed: -1, stale: '4', unverified: NaN, satisfied: Infinity },
  }), 's-1', 30)
  assert.equal(data.status, 'reviewed-scope')
  assert.equal(data.checks.length, 8)
  assert.equal(data.checks[0].criterion, 'a b')
  assert.equal(data.checks[0].status, 'unverified')
  assert.equal(data.checks[0].action, '<script>not executed</script>')
  assert.equal(data.checks[1].criterion.length, 360)
  assert.equal(data.limitations.length, 4)
  assert.equal(data.limitations[0].length, 360)
  assert.equal(data.contribution, null)
  assert.equal(JSON.stringify(data.counts), '{"failed":0,"unverified":0,"stale":0,"satisfied":0}')
  h.dispose()
})

// Binding/refresh work is intentionally a read-once hook, not old-turn polling.
test('one abortable no-store GET per binding; ordinary re-renders have no polling or retry', async () => {
  const h = load(), r = h.renderer(p => h.d.useAdvisorDelivery(p.sessionId, p.seq))
  const props = { sessionId: 's /?#', seq: 30 }
  assert.equal(r.render(props).data, null)
  assert.equal(h.requests.length, 1)
  const request = h.requests[0]
  assert.equal(request.url, '/po06/api/advisor-delivery?session=s%20%2F%3F%23&seq=30')
  assert.equal(request.options.method, undefined, 'fetch default GET, never a POST/model call')
  assert.equal(request.options.cache, 'no-store')
  assert.equal(request.options.headers.accept, 'application/json')
  assert.equal(Object.keys(request.options.headers).length, 1)
  assert.equal(request.options.signal.aborted, false)
  h.respond(0, value(props.sessionId)); await flush()
  assert.equal(r.render(props).data.status, 'reviewed-scope')
  for (let n = 0; n < 10; n++) r.render(props)
  assert.equal(h.requests.length, 1)
  assert.equal(h.timers.size, 0)
  assert.equal(h.intervals.size, 0)
  r.unmount(); h.dispose()
})

test('Session/seq rebind masks prior data before cleanup, aborts old requests, and drops late replies', async () => {
  const h = load(), r = h.renderer(p => h.d.useAdvisorDelivery(p.sessionId, p.seq))
  const a = { sessionId: 's-1', seq: 30 }, b = { sessionId: 's-2', seq: 30 }, c = { sessionId: 's-2', seq: 31 }
  r.render(a); h.respond(0, value()); await flush()
  assert.equal(r.render(a).data.status, 'reviewed-scope')
  const beforeEffects = r.render(b, false)
  assert.equal(beforeEffects.data, null)
  assert.equal(beforeEffects.loading, true)
  r.commit()
  assert.equal(h.requests[0].options.signal.aborted, true)
  r.render(c)
  assert.equal(h.requests[1].options.signal.aborted, true)
  h.respond(1, value('s-2', 30, { status: 'known-defects' })); await flush()
  assert.equal(r.render(c).data, null)
  h.respond(2, value('s-2', 31, { status: 'not-reviewed' })); await flush()
  assert.equal(r.render(c).data.status, 'not-reviewed')
  assert.equal(h.requests.length, 3)
  r.unmount(); h.dispose()
})

test('A-B-A rebinding cannot resurrect an old response even with the same Session/seq', async () => {
  const h = load(), r = h.renderer(p => h.d.useAdvisorDelivery(p.sessionId, p.seq))
  const a = { sessionId: 's-1', seq: 30 }, b = { sessionId: 's-2', seq: 30 }
  r.render(a); r.render(b); r.render(a)
  assert.equal(h.requests.length, 3)
  h.respond(2, value('s-1', 30, { requestId: 'latest', status: 'not-reviewed' })); await flush()
  h.respond(0, value('s-1', 30, { requestId: 'earliest', status: 'known-defects' })); await flush()
  const state = r.render(a)
  assert.equal(state.data.requestId, 'latest')
  assert.equal(state.data.status, 'not-reviewed')
  r.unmount(); h.dispose()
})

test('manual refresh clears prior status immediately and is the only same-binding repeat read', async () => {
  const h = load(), r = h.mountTail(), props = ownerProps()
  let view = r.render(props)
  assert.equal(refreshButton(view).props.disabled, true)
  h.respond(0, value()); await flush()
  view = r.render(props)
  assert.equal(refreshButton(view).props.disabled, false)
  refreshButton(view).props.onClick()
  const pending = r.render(props, false)
  assert.equal(pending.props['data-po06-delivery-status'], 'loading')
  assert.equal(pending.props['data-po06-delivery-request'], undefined)
  assert.doesNotMatch(text(pending), /Reviewed scope only/)
  assert.equal(h.requests.length, 1)
  r.commit()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[0].options.signal.aborted, true)
  h.respond(1, value('s-1', 30, { status: 'verification-pending', counts: { stale: 1 } })); await flush()
  assert.equal(r.render(props).props['data-po06-delivery-status'], 'verification-pending')
  h.dispose()
})

test('late same-binding response during refresh before effect cleanup stays hidden; refresh remains single-flight', async () => {
  const h = load(), r = h.renderer(p => h.d.useAdvisorDelivery(p.sessionId, p.seq)), props = { sessionId: 's-1', seq: 30 }
  r.render(props).refresh()
  r.render(props, false)
  h.respond(0, value('s-1', 30, { requestId: 'stale-refresh', status: 'known-defects' })); await flush()
  const beforeCleanup = r.render(props, false)
  assert.equal(beforeCleanup.data, null)
  assert.equal(beforeCleanup.loading, true)
  assert.equal(h.requests.length, 1)
  r.commit()
  assert.equal(h.requests[0].options.signal.aborted, true)
  assert.equal(h.requests.length, 2)
  // Multiple same-tick manual refreshes are batched into one next effect.
  const next = r.render(props)
  next.refresh(); next.refresh()
  r.render(props)
  assert.equal(h.requests[1].options.signal.aborted, true)
  assert.equal(h.requests.length, 3)
  h.respond(1, value('s-1', 30, { requestId: 'superseded-refresh' })); await flush()
  assert.equal(r.render(props).data, null)
  h.respond(2, value('s-1', 30, { requestId: 'current-refresh', status: 'not-reviewed' })); await flush()
  assert.equal(r.render(props).data.requestId, 'current-refresh')
  r.unmount(); h.dispose()
})

test('valid-to-invalid owner rebind clears the view immediately and cancels pending work with stable hooks', async () => {
  const h = load(), r = h.mountTail(), props = ownerProps()
  r.render(props)
  assert.equal(r.render({ ...props, turn: null }, false), null)
  r.commit()
  assert.equal(h.requests[0].options.signal.aborted, true)
  h.respond(0, value()); await flush()
  assert.equal(r.render({ ...props, turn: null }), null)
  r.render(props)
  assert.equal(h.requests.length, 2)
  assert.equal(r.owner.postUnmountUpdates, 0)
  h.dispose()
})

// Fail-open neutral annotation: neither old endpoints nor network errors stop output.
test('old host, malformed protocol, HTTP error, and wrong identity all render neutral unavailable', async () => {
  const cases = [[null, 404], [value(), 503], [{ ok: false }, 200], [value('wrong'), 200],
    [value('s-1', 31), 200], [value('s-1', '30'), 200], [value('s-1', 30, { status: 'pass' }), 200],
    [value('s-1', 30, { status: undefined }), 200], [value('s-1', 30, { scopeOnly: undefined }), 200],
    [value('s-1', 30, { completionClaimAllowed: undefined }), 200]]
  for (const [payload, status] of cases) {
    const h = load(), r = h.mountTail(), props = ownerProps()
    r.render(props); h.respond(0, payload, status); await flush()
    const view = r.render(props)
    assert.equal(view.props['data-po06-delivery-status'], 'unavailable')
    assert.equal(view.props['data-po06-delivery-request'], undefined)
    assert.match(text(view), /Review status unavailable/)
    assert.match(text(view), /review status cannot be established/)
    assert.equal(refreshButton(view).props.disabled, false)
    assert.equal(JSON.stringify(view).includes('--po06-ok'), false)
    assert.equal(h.requests.length, 1)
    assert.equal(h.timers.size, 0)
    assert.equal(h.intervals.size, 0)
    h.dispose()
  }
})

test('network rejection and non-JSON legacy response are unavailable without leaked raw errors or auto retry', async () => {
  for (const malformedJson of [false, true]) {
    const h = load(), r = h.mountTail(), props = ownerProps()
    r.render(props)
    if (malformedJson) h.requests[0].resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('private raw failure') } })
    else h.requests[0].reject(new Error('private raw failure'))
    await flush()
    const view = r.render(props)
    assert.equal(view.props['data-po06-delivery-status'], 'unavailable')
    assert.doesNotMatch(text(view), /private raw failure/)
    for (let n = 0; n < 3; n++) r.render(props)
    assert.equal(h.requests.length, 1)
    h.dispose()
  }
})

test('timeout is neutral even if fetch ignores abort, and dispose cancels timer/drops late state writes', async () => {
  const h = load(), r = h.mountTail(), props = ownerProps()
  r.render(props); h.timeout()
  assert.equal(h.requests[0].options.signal.aborted, true)
  assert.equal(r.render(props).props['data-po06-delivery-status'], 'unavailable')
  h.respond(0, value()); await flush()
  assert.equal(r.render(props).props['data-po06-delivery-request'], undefined)
  refreshButton(r.render(props)).props.onClick(); r.render(props)
  h.dispose()
  assert.equal(h.requests[1].options.signal.aborted, true)
  assert.equal(h.timers.size, 0)
  h.respond(1, value()); await flush()
  assert.equal(r.owner.postUnmountUpdates, 0)
})

test('missing AbortController declines to fetch and keeps the annotation neutral instead of crashing the turn', () => {
  const h = load('en', { abortSupport: false }), r = h.mountTail(), props = ownerProps()
  r.render(props)
  const view = r.render(props)
  assert.equal(view.props['data-po06-delivery-status'], 'unavailable')
  assert.equal(h.requests.length, 0)
  assert.equal(h.timers.size, 0)
  refreshButton(view).props.onClick(); r.render(props)
  assert.equal(r.render(props).props['data-po06-delivery-status'], 'unavailable')
  assert.equal(h.requests.length, 0)
  h.dispose()
})

// Visible semantics use locale/theme hooks already owned by the existing client.
test('all review states stay local, distinguish known/pending/reviewed, and never become overall green', async () => {
  const labels = { 'known-defects': /Known defects/, 'verification-pending': /Verification pending/,
    'reviewed-scope': /Reviewed scope only/, 'not-reviewed': /Not reviewed/, unavailable: /Review status unavailable/ }
  for (const [status, expected] of Object.entries(labels)) {
    const h = load(), r = h.mountTail(), props = ownerProps({ message: 'Done — everything passed' })
    const original = JSON.stringify(props)
    r.render(props); h.respond(0, value('s-1', 30, { status })); await flush()
    const view = r.render(props), copy = text(view)
    assert.equal(view.props['data-po06-delivery-status'], status)
    assert.match(copy, expected)
    assert.match(copy, /not task completion/)
    assert.match(copy, /file sharing are not intercepted/)
    assert.equal(copy.includes(props.message), false, 'assistant prose is not a status source')
    assert.equal(JSON.stringify(props), original, 'owner props and assistant text are untouched')
    assert.equal(JSON.stringify(view).includes('--po06-ok'), false, 'not even zero defects/evidence gaps means overall green')
    const expectedTone = status === 'known-defects' ? 'err' : status === 'verification-pending' ? 'warn' : 'fg3'
    assert.equal(view.props.style.borderLeft, '2px solid var(--po06-' + expectedTone + ')')
    assert.equal(descendants(view).filter(n => n.type === 'button').length, 1, 'only Refresh; no blocking/model controls')
    assert.equal(descendants(view).some(n => n.type === 'a'), false, 'no file action takeover')
    h.dispose()
  }
})

test('every contribution is optional advisory text, distinct from not-reviewed acceptance state', async () => {
  const labels = { available: /effect not verified/, 'result-changed': /baseline comparison pending/,
    'comparison-pending': /Baseline comparison pending/, keep: /not acceptance/ }
  for (const [status, expected] of Object.entries(labels)) {
    const h = load(), r = h.mountTail(), props = ownerProps()
    r.render(props); h.respond(0, value('s-1', 30, { status: 'not-reviewed', checks: [], counts: {}, contribution: { status, summary: 'Evidence only' } })); await flush()
    const view = r.render(props)
    assert.equal(view.props['data-po06-delivery-status'], 'not-reviewed')
    assert.match(text(view), /Not reviewed/)
    assert.match(text(view), expected)
    assert.equal(descendants(view).find(n => n.props['data-po06-delivery-contribution'])?.props['data-po06-delivery-contribution'], status)
    assert.equal(JSON.stringify(view).includes('--po06-ok'), false)
    h.dispose()
  }
})

test('check actions, limitations, and contribution summaries remain escaped React text, never markup or navigation', async () => {
  const h = load(), r = h.mountTail(), props = ownerProps(), markup = '<script>alert(1)</script>'
  r.render(props); h.respond(0, value('s-1', 30, { status: 'verification-pending',
    checks: [{ criterion: markup, status: 'stale', action: '<a href="file">recheck</a>' }],
    limitations: ['Current files changed; evidence is stale', markup],
    contribution: { status: 'comparison-pending', summary: markup },
  })); await flush()
  const view = r.render(props)
  assert.match(text(view), /Stale evidence/)
  assert.match(text(view), /Current files changed; evidence is stale/)
  assert.ok(text(view).includes(markup))
  assert.equal(descendants(view).some(n => ['script', 'a', 'iframe'].includes(n.type)), false)
  assert.equal(descendants(view).some(n => Object.hasOwn(n.props, 'dangerouslySetInnerHTML')), false)
  h.dispose()
})

test('English/Chinese switch live via host subscription with no extra fetch; disposal unsubscribes', async () => {
  const h = load('en'), r = h.mountTail(), props = ownerProps()
  r.render(props); h.respond(0, value('s-1', 30, { status: 'verification-pending', contribution: { status: 'keep', summary: '' } })); await flush()
  assert.match(text(r.render(props)), /Verification pending/)
  assert.equal(h.subscribers.size, 1)
  const updates = r.owner.updates
  h.setLocale('zh-CN')
  assert.ok(r.owner.updates > updates, 'locale callback schedules a render')
  assert.match(text(r.render(props)), /验证待补/)
  assert.match(text(r.render(props)), /建议保留当前版本/)
  h.setLocale('en-US')
  assert.match(text(r.render(props)), /Verification pending/)
  assert.match(text(r.render(props)), /not acceptance/)
  assert.equal(h.requests.length, 1)
  h.dispose()
  assert.equal(h.subscribers.size, 0)
  h.setLocale('zh')
  assert.equal(r.owner.postUnmountUpdates, 0)
})
