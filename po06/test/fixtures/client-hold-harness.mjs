import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const sameDeps = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) return node.map((n) => find(n, predicate)).find(Boolean) || null
  return predicate(node) ? node : find(node.children, predicate)
}
function eventTarget() {
  const listeners = new Map()
  return {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn) },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) { fn(event); if (event.immediateStopped) break } return true },
  }
}
function element() {
  const attrs = new Map()
  return { style: {}, children: [], parentElement: null, textContent: '', isConnected: true,
    setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k) || null, hasAttribute: k => attrs.has(k),
    appendChild(child) { this.children.push(child); child.parentElement = this; return child },
    remove() { this.isConnected = false }, contains(child) { return child === this || this.children.includes(child) },
    closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 100, right: 900, top: 100, bottom: 700, width: 800, height: 600 }),
  }
}

// Runs the real registered ControlBar, hooks, effects, composer events, and panel callbacks.
// Network completions deliberately ignore abort so tests can deliver a truly late response.
export function loadHoldClient({ permission = 'auto', englishMode = false, sessionSettings = {}, optimizationGeneration,
  pipelineRevision = 'single-run-1', deferStatus = false } = {}) {
  const requests = [], submissions = [], order = [], timers = new Map(), mounts = []
  const armed = new Map()
  let timerId = 0, rendering = null, cursor = 0, active = null, ControlBar, revision = pipelineRevision
  const timer = (fn, ms, repeat) => { const id = ++timerId; timers.set(id, { fn, ms, repeat }); return id }
  const setTimeout = (fn, ms) => timer(fn, ms, false)
  const setInterval = (fn, ms) => timer(fn, ms, true)
  const clearTimer = id => timers.delete(id)
  const win = { ...eventTarget(), innerWidth: 1200, innerHeight: 900, setTimeout, setInterval, clearTimeout: clearTimer, clearInterval: clearTimer,
    __ModuleLoader__: { load: reg => { win.registration = reg } } }
  const document = { ...eventTarget(), body: element(), head: element(), documentElement: element(), activeElement: null,
    createElement: element, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }
  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) {
      if (rendering && props?.ref && typeof type === 'string') {
        props.ref.current = props['data-po06'] === 'bar' ? rendering.bar : rendering.button
      }
      return { type, props: props || {}, children }
    },
    useState(initial) {
      const mount = rendering, index = cursor++
      if (!mount.hooks[index]) {
        const slot = { value: typeof initial === 'function' ? initial() : initial }
        slot.set = value => {
          if (!mount.live) return
          const next = typeof value === 'function' ? value(slot.value) : value
          if (!Object.is(next, slot.value)) { slot.value = next; mount.dirty = true }
        }
        mount.hooks[index] = slot
      }
      const slot = mount.hooks[index]
      return [slot.value, slot.set]
    },
    useRef(initial) { const index = cursor++; return rendering.hooks[index] || (rendering.hooks[index] = { current: initial }) },
    useCallback(fn, deps) {
      const index = cursor++, prev = rendering.hooks[index]
      if (!prev || !sameDeps(prev.deps, deps)) rendering.hooks[index] = { value: fn, deps }
      return rendering.hooks[index].value
    },
    useMemo(fn, deps) {
      const index = cursor++, prev = rendering.hooks[index]
      if (!prev || !sameDeps(prev.deps, deps)) rendering.hooks[index] = { value: fn(), deps }
      return rendering.hooks[index].value
    },
    useEffect(fn, deps) {
      const index = cursor++, prev = rendering.hooks[index]
      if (!prev || !sameDeps(prev.deps, deps)) rendering.effects.push({ index, fn, deps })
    },
  }
  React.useLayoutEffect = React.useEffect
  const settings = { permission, englishMode, assist: 'auto', detail: 'standard', budget: 'standard',
    presetNoticeDismissed: true, skipHintDismissed: true, doubleEnterSkip: false }
  const response = (data, status = data.ok === true ? 200 : 409) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
  const statusData = sid => ({ ok: true, enabled: true, settings, described: { tier: 'standard' },
    sessionEffective: { ...settings, ...(sessionSettings[sid] || {}) }, sessionDescribed: { tier: 'standard' },
    capability: { ...(revision === undefined ? {} : { pipelineRevision: revision }), optimization: { generation: optimizationGeneration } } })
  const fetch = (url, options = {}) => {
    const parsed = new URL(url, 'http://127.0.0.1')
    const path = parsed.pathname.replace('/po06/api', '')
    const req = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, signal: options.signal }
    requests.push(req)
    if (req.method === 'POST' && (path === '/interpret' || path === '/packet' || path === '/rollback')) {
      req.signal?.addEventListener('abort', () => order.push({ type: 'abort', path, body: req.body }))
      order.push({ type: 'request', path, body: req.body })
      return new Promise(resolve => {
        req.respond = (data, status) => {
          const result = response(data, status)
          order.push({ type: 'response', path, data, status: result.status })
          if (path === '/packet' && result.ok && data.ok === true && data.runId === req.body.runId) armed.set(req.body.sessionId, { ...req.body, packet: data.packet })
          resolve(result)
        }
      })
    }
    if (path === '/status') {
      req.sessionId = parsed.searchParams.get('session')
      if (deferStatus) return new Promise(resolve => { req.respond = (data, status) => resolve(response(data, status)) })
      return Promise.resolve(response(statusData(req.sessionId)))
    }
    return Promise.resolve(response({ ok: true, active: false, models: [], efforts: [], notice: null, presetAt: null }))
  }
  runInNewContext(source, { window: win, document, fetch, AbortController, console, URL,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail } },
    setTimeout, setInterval, clearTimeout: clearTimer, clearInterval: clearTimer })
  const require = name => name === 'react' ? React : {}
  const mod = win.registration.factory(require)
  const dispose = mod.apply({ locale: 'en', slots: {
    register(def, component) { if (def.name === 'conversation.input.left') ControlBar = component; return () => {} },
    inject: (_, callback) => callback(),
  } })
  function render(mount) {
    let passes = 0
    while (mount.live && mount.dirty) {
      assert.ok(++passes < 40, 'ControlBar should settle after hook effects')
      mount.dirty = false; mount.effects = []; rendering = mount; cursor = 0
      mount.tree = ControlBar(mount.props)
      rendering = null
      for (const effect of mount.effects) {
        mount.hooks[effect.index]?.cleanup?.()
        const slot = { deps: effect.deps }
        mount.hooks[effect.index] = slot
        slot.cleanup = effect.fn()
      }
    }
  }
  function mount(sessionId, text = '用户的原话') {
    const editor = { innerText: text, textContent: text, closest: () => null }
    const card = element(), bar = element(), button = element()
    card.querySelector = () => editor
    card.querySelectorAll = () => [button]
    card.contains = node => [editor, bar, button].includes(node)
    bar.parentElement = card; button.parentElement = card
    button.closest = selector => selector === 'button' ? button : null
    const m = { id: mounts.length + 1, live: true, dirty: true, hooks: [], effects: [], sessionId, draft: text, editor, card, bar, button }
    m.props = { sessionId, inputActions: {
      setDraft(text) { m.draft = text; editor.innerText = text; order.push({ type: 'draft', sessionId, text }) },
      submit() { const submission = { sessionId, mountId: m.id, text: m.draft, commit: armed.get(sessionId) }; submissions.push(submission); order.push({ type: 'submit', ...submission }) },
    } }
    m.find = predicate => { render(m); return find(m.tree, predicate) }
    m.panel = () => { const node = m.find(node => node.type === mod.__debug.InterceptPanel); assert.ok(node, 'Expected the interception panel'); return node.props }
    m.clickSend = () => {
      const event = { type: 'click', target: button,
        preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, stopImmediatePropagation() { this.immediateStopped = true } }
      win.dispatchEvent(event); render(m)
      return event
    }
    m.enter = () => {
      document.activeElement = editor
      const event = { type: 'keydown', key: 'Enter', target: editor,
        preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, stopImmediatePropagation() { this.immediateStopped = true } }
      win.dispatchEvent(event)
      render(m)
      return event
    }
    m.unmount = () => { m.live = false; for (const hook of m.hooks) hook?.cleanup?.(); if (active === m) active = null }
    active = m; mounts.push(m); render(m)
    return m
  }
  async function flush() { for (let i = 0; i < 16; i++) { await Promise.resolve(); for (const m of mounts) if (m.live && m.dirty) render(m) } }
  const pending = path => requests.filter(req => req.path === path && req.method === 'POST')
  const completeInterpret = (req = pending('/interpret').at(-1), result = {}) => {
    assert.ok(req, 'Expected an interpretation request')
    req.respond({ ok: true, runId: req.body.messageId, generation: req.body.generation, status: 'ready', packet: '最终注入文', chars: 5, outgoingText: req.body.text, englishMode, ...result })
  }
  const completePacket = (req = pending('/packet').at(-1), result = {}) => {
    assert.ok(req, 'Expected a packet commit')
    req.respond({ ok: true, runId: req.body.runId, generation: req.body.generation, packet: req.body.text, chars: req.body.text.length, ...result })
  }
  const completeRollback = (req = pending('/rollback').at(-1), result = {}) => {
    assert.ok(req, 'Expected a packet rollback')
    req.respond({ ok: true, runId: req.body.runId, generation: req.body.generation, packet: '上一版完整包', chars: 6, remaining: 2, ...result })
  }
  const completeStatus = (req = requests.filter(req => req.path === '/status').at(-1), result = {}) => {
    assert.ok(req?.respond, 'Expected a deferred status request')
    req.respond({ ...statusData(req.sessionId), ...result })
  }
  return { mod, win, requests, submissions, order, mount, flush, pending, completeInterpret, completePacket, completeRollback, completeStatus,
    setPipelineRevision(value) { revision = value },
    hold: sid => mod.__debug.holdBridgeRead(sid),
    advance(ms) { for (const [id, task] of [...timers]) if (task.ms <= ms) { if (!task.repeat) timers.delete(id); task.fn() } },
    close() { for (const m of mounts) if (m.live) m.unmount(); dispose(); timers.clear() },
  }
}
