// Advisor state has an independent context path; it never mutates the accepted packet.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function boot(home, settings) {
  writeFileSync(join(home, 'po06.json'), JSON.stringify(settings))
  const effects = [], defs = new Map()
  let provider
  const effect = fn => { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return dispose }
  const tools = { schemas: () => [...defs.values()], register: def => { defs.set(def.name, def); return () => defs.delete(def.name) } }
  const services = { tools, llm: {}, systemPrompt: { context: definition => { provider = definition; return () => {} } } }
  const ctx = {
    effect, get: name => services[name] || null,
    inject(names, callback) {
      if (!names.every(name => services[name] != null)) return
      return callback({ ...Object.fromEntries(names.map(name => [name, services[name]])), effect, get: ctx.get })
    },
  }
  return { ctx, effects, defs, context: id => provider.text({ agent: { id } }) }
}

test('advisor off removes its context and ledger while preserving the exact packet', async () => {
  const home = mkdtempSync(join(tmpdir(), 'po06-switch-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  let host
  try {
    host = boot(home, { settingsVersion: 1, enabled: true, rollout: { mode: 'all' }, bash: false, advisor: false })
    const mod = await import('../lib/index.js?switch-off')
    mod.apply(host.ctx, {})
    mod.adapter.enableGate.set('s1', { enabled: true, code: 'test-enabled' })
    mod.adapter.setIntentText('s1', '用户接受的完整包。')
    mod.adapter.noteAdvisorDirective('s1', '【顾问的理解】\n这段在开关关掉时不该出现。')
    assert.equal(mod.adapter.getWorkingText('s1'), '用户接受的完整包。', 'packet getter is stable')
    assert.equal(mod.adapter.getAdvisorText('s1', '待补顾问证据'), '', 'advisor content is disabled as a whole')
    assert.equal(host.context('s1'), '用户接受的完整包。', 'real context provider retains only the accepted packet')
    mod.adapter.advisorLedger.add('s1', { claim: '旧结论' }, { turn: 1 })
    mod.adapter.getAdvisorText('s1')
    assert.equal(mod.adapter.advisorLedger.open('s1').length, 0, 'disabled advisor clears its ledger')
    assert.equal(mod.adapter.getWorkingText('s1'), '用户接受的完整包。', 'ledger cleanup cannot alter packet identity')
  } finally {
    for (const dispose of host?.effects.reverse() || []) dispose()
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  }
})

test('advisor on contributes through its own context path without changing the accepted packet', async () => {
  const home = mkdtempSync(join(tmpdir(), 'po06-switch-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  let host
  try {
    host = boot(home, { settingsVersion: 1, enabled: true, rollout: { mode: 'all' }, bash: false, advisor: true })
    const mod = await import('../lib/index.js?switch-on')
    mod.apply(host.ctx, {})
    mod.adapter.enableGate.set('s1', { enabled: true, code: 'test-enabled' })
    mod.adapter.setIntentText('s1', '用户接受的完整包。')
    mod.adapter.noteAdvisorDirective('s1', '【顾问的理解】\n开关开着时这段应当出现。')
    assert.ok(mod.adapter.getAdvisorText('s1').includes('开关开着时这段应当出现'), 'positive advisor control is present')
    const context = host.context('s1')
    assert.ok(context.includes('开关开着时这段应当出现'), 'actual provider composes advisor content')
    assert.ok(context.includes('用户接受的完整包。'), 'actual provider includes the accepted packet')
    assert.equal(mod.adapter.getWorkingText('s1'), '用户接受的完整包。', 'preview/card packet stays exact')
  } finally {
    for (const dispose of host?.effects.reverse() || []) dispose()
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  }
})
