import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export const finishChunk = (kind = 'stop') => ({ type: 'finish', reason: { kind } })
export const headerEvent = (provider = 'wire-provider', model = 'wire-model') => ({
  type: 'request/header', data: { header: { config: { provider, model } } },
})
export const flushHostEvents = () => new Promise(resolve => setTimeout(resolve, 0))

/** All model calls stay inside this deterministic, network-free stream. */
export function fakeLlm(reply) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const output = typeof reply === 'function' ? reply(options, calls.length) : reply
      return (async function* () {
        const chunks = Array.isArray(output) ? output : [
          { type: 'text-delta', text: String(output) },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
          finishChunk(),
        ]
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

/** Text and usage arrive before an explicitly released final finish event. */
export function controlledLlm() {
  const calls = [], arrived = []
  const waiters = new Map()
  return {
    calls,
    waitForCall(index = 0) {
      if (arrived[index]) return Promise.resolve(arrived[index])
      if (!waiters.has(index)) waiters.set(index, deferred())
      return waiters.get(index).promise
    },
    stream(options) {
      const index = calls.length
      calls.push(options)
      const release = deferred(), textSeen = deferred()
      const call = {
        options, textSeen: textSeen.promise,
        complete(text, { usage = 15, kind = 'stop', blockOnly = false, finishGate = null } = {}) {
          release.resolve({ text, usage, kind, blockOnly, finishGate })
        },
      }
      arrived[index] = call
      waiters.get(index)?.resolve(call)
      return (async function* () {
        const output = await release.promise
        yield output.blockOnly
          ? { type: 'block-end', index: 0, block: { type: 'text', text: output.text } }
          : { type: 'text-delta', text: output.text }
        yield { type: 'usage', usage: { totalTokens: output.usage } }
        textSeen.resolve()
        if (output.finishGate) await output.finishGate
        yield finishChunk(output.kind)
      })()
    },
  }
}

export function fakeSession(id) {
  const session = {
    id, header: { agentPreset: 'wish' }, publishing: false, appended: [], events: [],
    snapshotEvents() { return this.events.slice() },
    append(type, data) {
      if (this.publishing) throw new Error('session append cannot reenter while another append is being published')
      const event = { type, data, seq: this.events.length + 1 }
      this.appended.push(event)
      if (this.ctx) emit(this.ctx, this, event)
      else this.events.push(event)
      return event
    },
  }
  return session
}

/** Dispatch to every subscriber and enforce the host's append publication boundary. */
export function emit(ctx, session, event) {
  const handlers = ctx.handlers.filter(item => item.name === 'session/event')
  if (session) {
    session.events.push(event)
    session.publishing = true
  }
  try { for (const handler of handlers) handler.fn(session, event) }
  finally { if (session) session.publishing = false }
  return handlers.length
}

/** Minimal optional services, with real control-route registration and no swallowed callback errors. */
export function createHostContext({ llm }) {
  const handlers = [], sessions = new Map(), routes = [], effects = []
  const systemPrompt = {
    contextDefs: [],
    context(definition) { this.contextDefs.push(definition); return () => {} },
    assemble: async () => ({ contexts: [], sections: [], tools: [], variables: {} }),
  }
  const projections = { register: () => () => {}, stateOf: () => null }
  const services = {
    llm, systemPrompt, sessionProjections: projections,
    agents: { get: id => sessions.get(String(id))?.agent || null, list: () => [...sessions.values()].map(s => s.agent) },
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  const ctx = {
    handlers, routes, effects, projections, ctxRefs: { systemPrompt },
    on(name, fn) { handlers.push({ name, fn }); return () => {} },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return dispose },
    get(name) { return services[name] },
    inject(dependencies, fn) {
      if (!dependencies.every(name => services[name] != null)) return
      const scope = { get: ctx.get, effect: ctx.effect }
      for (const name of dependencies) scope[name] = services[name]
      return fn(scope)
    },
    addSession(id, { cwd } = {}) {
      const session = fakeSession(String(id))
      if (cwd) session.header.cwd = cwd
      session.ctx = ctx
      session.agent = { id: 'agent-' + id, session }
      sessions.set(String(id), session)
      return session
    },
    context(session) {
      assert.equal(systemPrompt.contextDefs.length, 1, 'apply registers exactly one production context provider')
      return systemPrompt.contextDefs[0].text({ agent: session.agent })
    },
    start(method, path, body = null) {
      assert.equal(routes.length, 1, 'apply registers the real control API once')
      assert.equal(routes[0].path, '/po06/api')
      const req = new EventEmitter(), res = new EventEmitter()
      Object.assign(req, { method, url: '/po06/api' + path,
        headers: { host: '127.0.0.1:3080', 'x-po06': '1' } })
      Object.assign(res, {
        status: null, body: null, writableEnded: false,
        writeHead(status, headers) { this.status = status; this.headers = headers },
        end(value) { this.body = JSON.parse(String(value)); this.writableEnded = true },
      })
      const request = { req, res, settled: false, promise: null }
      request.promise = Promise.resolve(routes[0].handler(req, res)).then(() => {
        request.settled = true
        return res
      })
      queueMicrotask(() => {
        if (body !== null) req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'))
        req.emit('end')
      })
      return request
    },
    post(path, body) { return ctx.start('POST', path, body).promise },
    getApi(path) { return ctx.start('GET', path).promise },
  }
  return ctx
}
