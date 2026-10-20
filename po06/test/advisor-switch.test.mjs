// 顾问开关（2026-10-20）：关掉时**顾问结构完全不出现**，链路退化成线性。
// 这里走真实 apply()（假 ctx），直接问 adapter.getWorkingText：注入文里不许带顾问块。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function boot(home, settings) {
  writeFileSync(join(home, 'po06.json'), JSON.stringify(settings))
  const effects = [], defs = new Map()
  const effect = (fn) => { const d = fn(); if (typeof d === 'function') effects.push(d); return d }
  const tools = { schemas: () => [...defs.values()], register: (def) => { defs.set(def.name, def); return () => defs.delete(def.name) } }
  const ctx = {
    effect,
    get: () => null,                       // apply 里会读 agents / sessionController，假 ctx 一律 null
    inject: (names, cb) => (names.every((n) => n === 'tools' || n === 'llm') ? effect(() => cb({ tools, llm: {}, effect })) : () => {}),
  }
  return { ctx, effects, defs }
}

test('顾问关掉：注入文里不出现顾问块（线性退化）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'po06-switch-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx } = boot(home, { settingsVersion: 1, enabled: true, rollout: { mode: 'all' }, bash: false, advisor: false })
    const mod = await import('../lib/index.js?switch-off')
    mod.apply(ctx, {})
    assert.ok(mod.adapter, 'apply 之后要有 adapter')
    mod.adapter.noteAdvisorDirective('s1', '【顾问的理解】\n这段在开关关掉时不该出现。')
    const text = String(mod.adapter.getWorkingText('s1') || '')
    assert.ok(!text.includes('这段在开关关掉时不该出现'), '顾问块必须整段不出现')
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  }
})

test('顾问开着：同一条指令会出现在注入文里（对照组）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'po06-switch-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx } = boot(home, { settingsVersion: 1, enabled: true, rollout: { mode: 'all' }, bash: false, advisor: true })
    const mod = await import('../lib/index.js?switch-on')
    mod.apply(ctx, {})
    mod.adapter.noteAdvisorDirective('s1', '【顾问的理解】\n开关开着时这段应当出现。')
    const text = String(mod.adapter.getWorkingText('s1') || '')
    assert.ok(text.includes('开关开着时这段应当出现'), '开着的对照组要出现（否则前一条断言就是假阳性）')
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  }
})
