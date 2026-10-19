// 子代理默认不跑「解释 + 注入」（2026-10-19 用户提出）。
//
// 子代理是父代理派出去干活的会话；再叠一层优化通常只是白花 token，也把父代理的意图改写一遍。
// 默认关；要开在「详情」里把「子代理：不解释、不注入」改成「同样应用」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, SETTINGS_KEYS, normalizeSettings } from '../lib/settings.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const INDEX_SRC = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const CLIENT_SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

test('设置：默认不应用到子代理，且在白名单里', () => {
  assert.equal(DEFAULT_SETTINGS.applyToSubagents, false, '默认必须是不应用')
  assert.ok(SETTINGS_KEYS.includes('applyToSubagents'))
  assert.equal(normalizeSettings({ applyToSubagents: true }).settings.applyToSubagents, true)
  assert.equal(normalizeSettings({ applyToSubagents: 'yes' }).settings.applyToSubagents, false, '非布尔值回落默认')
})

test('判据取会话头里的宿主字段，不靠猜', () => {
  assert.ok(/function isSubagentSession\(session\)/.test(INDEX_SRC), '要有统一的判据函数')
  const at = INDEX_SRC.indexOf('function isSubagentSession(session)')
  const body = INDEX_SRC.slice(at, at + 600)
  assert.ok(body.includes("origin === 'subagent'"), '认 origin=subagent')
  assert.ok(body.includes('delegationDepth'), '认 delegationDepth > 0')
  assert.ok(body.includes('parentSession'), '认 parentSession')
})

test('三道闸都按这个设置短路：注入 / 解释 / 顾问', () => {
  // 注入：systemPrompt.context 里
  assert.ok(/isSubagentSession\(session\)[\s\S]{0,80}applyToSubagents !== true\) return ''/.test(INDEX_SRC), '注入钩子要短路')
  // 解释：session/event 的生产触发里
  // 插件里有两条 session/event 订阅；生产触发是**后一条**（那条里会调 inferenceContext.observe）。
  const trig = INDEX_SRC.lastIndexOf("ctx.on('session/event', (session, event) => {")
  assert.ok(trig > 0)
  const tail = INDEX_SRC.slice(trig, trig + 900)
  assert.ok(/isSubagentSession\(session\)/.test(tail) && /applyToSubagents !== true\) return/.test(tail), '生产触发要短路')
  // 顾问：resolveRuntime 里
  assert.ok(/isSubagentSession\(session\) && pol\.applyToSubagents !== true\) return \{ ok: false, reason: 'subagent-skip' \}/.test(INDEX_SRC), '顾问要拒')
})

test('界面上有这一项（详情表单），默认显示为「不解释、不注入」', () => {
  assert.ok(CLIENT_SRC.includes("L('子代理','Subagents')"), '要有一行「子代理」')
  assert.ok(CLIENT_SRC.includes("L('不解释、不注入','skip')"), '默认那一档的文案')
  assert.ok(CLIENT_SRC.includes('applyToSubagents: v === '), '选择要能保存')
})
