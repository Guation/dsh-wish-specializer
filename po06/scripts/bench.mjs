// 跑分（2026-10-23）：用当前版本的协议跑一组固定语料，产出可复现的量化证据。
// 138 套件证明代码按约定工作；这里证明提示词真的产出了方向建议、且守住预算与结构。
// 用法：node scripts/bench.mjs [--limit N] [--out dir]
// 需要 SCAFFOLD_CHECK_DEPS / SCAFFOLD_CHECK_HOME（与本仓库既有真实调用脚本一致）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildInterpreterProtocol } from '../lib/index.js'
import { buildOptimizerUserMessage, renderOptimizerPacket, OPTIMIZER_OUTPUT_BUDGET_TOKENS } from '../lib/optimizer-protocol.js'
import { parseInterpreterOutput } from '../lib/interpreter.js'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const LIMIT = Number(opt('limit', '0')) || 0
const OUT = resolve(opt('out', join('.po06-tmp', 'bench')))
mkdirSync(OUT, { recursive: true })
const deps = process.env.SCAFFOLD_CHECK_DEPS, home = process.env.SCAFFOLD_CHECK_HOME
if (!deps || !home) throw Error('Set SCAFFOLD_CHECK_DEPS and SCAFFOLD_CHECK_HOME.')
const load = name => import(pathToFileURL(join(deps, name, 'lib', 'index.js')).href)
const [{ parseCredentialsDocument }, ds, llm] = await Promise.all([load('dsh-credentials-local'), load('dsh-llm-deepseek'), load('dsh-llm')])
const document = parseCredentialsDocument(readFileSync(join(home, '.credentials.yaml'), 'utf8'), 'local-credentials')
const key = document.refs.get('DEEPSEEK_API_KEY')
if (!key) throw Error('official credential unavailable')
const adapter = new ds.DeepSeekAdapter({
  options: () => ds.resolveAdapterOptions({}, { get: () => undefined }),
  resolveAuth: async () => ({ headers: { 'x-api-key': key } }),
  resolveUserId: () => 'po06-bench',
  prepareExtensions: async () => ({ fields: {}, accept: () => Promise.resolve() }),
})

// expect 是判别力所在：没有期望的跑分只会得到 100%。
//   add/scaffold/ask = 至少几条；empty = 不该产出建议（元指令不是任务）。
const CORPUS = [
  { id: 'short', tier: 'heavy', text: '做一个跑车', expect: { scaffold: 1 } },
  { id: 'vague', tier: 'heavy', text: '帮我弄个好看点的东西，别太丑', expect: { ask: 1 } },
  { id: 'creative', tier: 'heavy', text: '以你自己为本体，做一个极具夸张艺术色彩的动画，主题自选，意境要浪漫而宏大', expect: { add: 1, scaffold: 1 } },
  { id: 'engineering', tier: 'standard', text: '给这个单页加一个可拖拽的两段式输入，第一段上弦第二段甩出，要有力度反馈', expect: { scaffold: 1 } },
  { id: 'meta', tier: 'standard', text: '继续', expect: { empty: true } },
]

const NUM = /[0-9]+(?:\.[0-9]+)?/g
const txt = x => (typeof x === 'string' ? x : (x && (x.text || x.q || x.question)) || '')
const rows = []
for (const item of CORPUS.slice(0, LIMIT || CORPUS.length)) {
  const protocol = await buildInterpreterProtocol({ home, toolsEnabled: false, strategy: { tier: item.tier }, englishMode: false })
  const prompt = buildOptimizerUserMessage({ userText: item.text, styleHint: '' })
  const route = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }
  const started = Date.now()
  const assembler = new llm.BlockAssembler()
  let raw = ''
  const row = { id: item.id, tier: item.tier, inputChars: item.text.length, route, revision: protocol.revision }
  try {
    for await (const chunk of adapter.stream({ ...route, system: protocol.text, messages: [llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })] })) {
      assembler.push(chunk)
      if (chunk.type === 'text-delta') raw += chunk.text || chunk.delta || ''
    }
    row.usage = assembler.usage || null
    row.finish = assembler.finish && assembler.finish.kind
    const parsed = parseInterpreterOutput(raw, { userText: item.text, sessionId: 'bench', messageId: 'm-' + item.id, baseRevision: 1, baseInputRevision: 1, causeId: 'bench' })
    row.protocol = parsed.ok === true
    row.warnings = parsed.warnings || []
    if (!parsed.ok) { row.error = parsed.code + ': ' + parsed.reason; row.raw = raw.slice(0, 800) }
    else {
      const o = parsed.optimizer
      const add = (o.add || []).map(txt).join('\n')
      const scaf = (o.scaffold || []).map(txt).join('\n')
      const asks = (o.ask || []).map(txt)
      const packet = renderOptimizerPacket(o, 'zh', { userText: item.text })
      row.counts = { add: (o.add || []).length, scaffold: (o.scaffold || []).length, ask: asks.length }
      row.packetChars = packet.length
      row.sections = row.counts.add > 0 && row.counts.scaffold > 0
      const outTokens = (row.usage && (row.usage.outputTokens || row.usage.completionTokens)) || 0
      row.budget = outTokens === 0 ? null : outTokens <= OPTIMIZER_OUTPUT_BUDGET_TOKENS
      row.askPure = asks.every(a => !/选项|A\/B|建议你|可以选/.test(a))
      const inputNums = new Set(item.text.match(NUM) || [])
      const invented = ((add + '\n' + scaf).match(NUM) || []).filter(n => !inputNums.has(n))
      row.inventedNumbers = [...new Set(invented)].slice(0, 6)
      row.noNumber = row.inventedNumbers.length === 0
      row.lang = /[\u4e00-\u9fff]/.test(add + scaf)
      const ex = item.expect || {}
      const fails = []
      if (ex.add && row.counts.add < ex.add) fails.push('add-lt-' + ex.add)
      if (ex.scaffold && row.counts.scaffold < ex.scaffold) fails.push('scaffold-lt-' + ex.scaffold)
      if (ex.ask && row.counts.ask < ex.ask) fails.push('ask-lt-' + ex.ask)
      if (ex.empty && (row.counts.add > 0 || row.counts.scaffold > 0)) fails.push('should-be-empty')
      row.behaviorFails = fails
      row.behavior = fails.length === 0
      writeFileSync(join(OUT, 'packet-' + item.id + '.txt'), packet + '\n')
      row.sample = (add || scaf).slice(0, 160)
    }
  } catch (e) { row.error = String((e && e.message) || e).split(key).join('[redacted]') }
  finally { row.ms = Date.now() - started }
  rows.push(row)
  console.log(JSON.stringify({ id: row.id, ok: row.protocol, behavior: row.behavior, fails: row.behaviorFails, counts: row.counts, ms: row.ms, tokens: row.usage && row.usage.outputTokens, budget: row.budget, error: row.error || null }))
}

const okRows = rows.filter(r => r.protocol)
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)
const summary = {
  version: 'bench-1',
  budgetTokens: OPTIMIZER_OUTPUT_BUDGET_TOKENS,
  cases: rows.length,
  protocolPass: okRows.length,
  // 只对期望有产出的用例计结构分：'继续' 这类空期望本来就不该有 add/scaffold
  sectionsPass: okRows.filter(r => r.sections || (r.behavior && !r.counts?.add)).length,
  budgetPass: okRows.filter(r => r.budget === true).length,
  budgetUnknown: okRows.filter(r => r.budget === null).length,
  askPurePass: okRows.filter(r => r.askPure).length,
  noInventedNumber: okRows.filter(r => r.noNumber).length,
  langPass: okRows.filter(r => r.lang).length,
  behaviorPass: okRows.filter(r => r.behavior).length,
  msP50: (() => { const a = rows.map(r => r.ms).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null })(),
  outTokensMean: (() => { const a = okRows.map(r => (r.usage && r.usage.outputTokens) || 0).filter(Boolean); return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null })(),
}
summary.rates = {
  protocol: pct(summary.protocolPass, summary.cases),
  sections: pct(summary.sectionsPass, summary.cases),
  budget: pct(summary.budgetPass, summary.cases),
  askPure: pct(summary.askPurePass, summary.cases),
  noInventedNumber: pct(summary.noInventedNumber, summary.cases),
  lang: pct(summary.langPass, summary.cases),
  behavior: pct(summary.behaviorPass, summary.cases),
}
writeFileSync(join(OUT, 'bench.json'), JSON.stringify({ summary, rows }, null, 2) + '\n')
const md = ['# 跑分报告 ' + new Date().toISOString(), '', '| 指标 | 数值 |', '| --- | --- |',
  ...Object.entries(summary.rates).map(([k, v]) => '| ' + k + ' | ' + v + '% |'),
  '| 延迟 p50 | ' + summary.msP50 + ' ms |', '| 平均输出 token | ' + summary.outTokensMean + ' |', '',
  '| 用例 | 档位 | 结构 | 建议/脚手架/反问 | token | ms | 期望 |', '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(r => '| ' + r.id + ' | ' + r.tier + ' | ' + (r.protocol ? (r.sections ? 'OK' : 'WARN') : 'FAIL') + ' | ' + (r.counts ? r.counts.add + '/' + r.counts.scaffold + '/' + r.counts.ask : '-') + ' | ' + ((r.usage && r.usage.outputTokens) || '-') + ' | ' + r.ms + ' | ' + (r.behavior ? 'PASS' : 'FAIL ' + (r.behaviorFails || []).join(',')) + ' |'),
  ''].join('\n')
writeFileSync(join(OUT, 'bench.md'), md + '\n')
console.log('SUMMARY ' + JSON.stringify(summary))