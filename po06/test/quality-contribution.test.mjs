// Offline wiring only: no API requests or real LLM calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdvisor, registerAdvisorTool, parseAdvisorReport, acceptanceBanner } from '../lib/advisor.js'
import { scopePolicy, scopedMaterials, scopeInstructions } from '../lib/advisor-scopes.js'
import { contributionSystem } from '../lib/advisor-contribution.js'
import { composeOptimizerSystem, OPTIMIZER_CORE, OPTIMIZER_TIERS } from '../lib/optimizer-protocol.js'
import { resolvePrompt } from '../lib/control-api.js'
const human = { type: 'user/message', seq: 1, data: { id: 'q1', source: { kind: 'user' }, content: [{ type: 'text', text: '把已有说明做得更出色' }] } }
const exec = { agent: { session: { id: 'quality-s', snapshotEvents: () => [human] } } }
const report = (over = {}) => ({ verdict: 'suggestion', summary: '提升已有产物的关键部分', contribution: '用因果结构组织说明，将结论、依据与反例对应，保留已有事实。', assumptions: [], findings: [{ text: '当前只有结论，缺少组织关系', evidenceRefs: ['R0'] }], checks: [], nextStep: '落实并比较新旧产物', stopCondition: '无实质收益则保留当前', ...over })
const stream = value => (async function* () { yield { type: 'text-delta', text: JSON.stringify(value) } })()

test('registered improvement invokes the configured Flash route and never records acceptance', async () => {
 let input, definition, finished, recorded = 0
 const progress = { start: () => 'quality-run', finish: (_id, value) => { finished = value } }
 const invoke = createAdvisor({ progress, coverage: { record: () => { recorded++ } }, resolveRuntime: async () => ({ ok: true, cfg: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }, readTools: false, llm: { stream: o => { input = o; return stream(report()) } } }) })
 registerAdvisorTool({ tools: { register: d => { definition = d; return () => {} } } }, invoke)
 const args = { mode: 'improve_result', question: '给可落实的质量提升', currentResult: '当前只有结论。' }
 const out = await definition.execute(args, exec)
 assert.ok(definition.parameters.properties.mode.enum.includes('improve_result'))
 assert.equal(out.ok, true); assert.equal(out.improvementAvailable, true); assert.equal(out.retainCurrent, false)
 assert.equal(out.reviewPassed, false); assert.equal(out.completionClaimAllowed, false); assert.equal(recorded, 0)
 assert.equal(out.model, 'deepseek-official/deepseek-flash'); assert.equal(input.reasoningEffort, 'max')
 assert.equal(out.contributionRevision, 'route-a-1')
 assert.equal(finished.improvementAvailable, true); assert.equal(finished.reviewPassed, false)
 assert.equal(finished.disposition, 'quality-advice')
 const payload = JSON.parse(input.messages[0].content[0].text)
 assert.equal(payload.currentResult.id, 'R0'); assert.equal(payload.currentResult.text, args.currentResult)
 assert.match(input.system, /改进已合格产物/)
 const meta = definition.output.presentationMeta(args, out)
 assert.equal(meta.improvementAvailable, true); assert.equal(meta.contribution, out.report.contribution)
 assert.match(definition.presentCall(args).title, /产物拔高/)
 assert.match(definition.presentResult(args, { meta }).content[0].text, /不是验收结论/)
 assert.match(acceptanceBanner(out), /比较新旧产物/)
})

test('keep is a valid scoped quality decision, not acceptance or a forced revision', async () => {
 const invoke = createAdvisor({ resolveRuntime: async () => ({ ok: true, cfg: { provider: 'p', model: 'm' }, readTools: false, llm: { stream: () => stream(report({ verdict: 'keep', contribution: '' })) } }) })
 const out = await invoke({ mode: 'improve_result', question: '是否有值得改善的点', currentResult: '实际正文' }, exec)
 assert.equal(out.ok, true); assert.equal(out.retainCurrent, true); assert.equal(out.improvementAvailable, false)
 assert.equal(out.reviewPassed, false); assert.equal(out.completionClaimAllowed, false)
 assert.match(acceptanceBanner(out), /不是验收通过/)
})

test('unseen results and invalid mode/stage usage do not start the quality model', async () => {
 let calls = 0
 const invoke = createAdvisor({ resolveRuntime: async () => ({ ok: true, cfg: { provider: 'p', model: 'm' }, readTools: false, llm: { stream: () => { calls++; throw new Error('must not call') } } }) })
 const missing = await invoke({ mode: 'improve_result', question: '自称已经很好' }, exec)
 assert.equal(missing.reason, 'improvement-material-required'); assert.equal(missing.improvementAvailable, false)
 assert.equal((await invoke({ mode: 'improve_result', question: 'q', currentResult: {} }, exec)).reason, 'invalid-current-result')
 assert.equal((await invoke({ mode: 'improve_result', scope: 'delivery', focus: 'q', question: 'q' }, exec)).reason, 'improvement-is-not-delivery-review')
 assert.equal((await invoke({ mode: 'improve_result', taskId: 'task', stageId: 'stage', question: 'q' }, exec)).reason, 'invalid-stage-reference')
 assert.equal(calls, 0)
})

test('quality parser rejects unsupported verdicts, fake evidence and keep-with-changes', () => {
 const check = over => parseAdvisorReport(JSON.stringify(report(over)), new Set(['R0']), 'improve_result')
 assert.equal(check({}).ok, true); assert.equal(check({ verdict: 'pass' }).ok, false)
 assert.equal(check({ checks: [{ criterion: '新验收', status: 'failed', evidenceRefs: ['R0'] }] }).ok, false)
 assert.equal(check({ contribution: '' }).ok, false)
 assert.equal(check({ findings: [] }).reason, 'advisor-improvement-without-material-evidence')
 assert.equal(check({ findings: [{ text: '伪证据', evidenceRefs: ['Rfake'] }] }).reason, 'advisor-invalid-citation')
 assert.equal(check({ verdict: 'keep' }).reason, 'advisor-keep-with-changes')
 assert.equal(check({ verdict: 'unverified', contribution: '', findings: [] }).ok, true)
})

test('clipped or interrupted evidence cannot promote keep or ready-to-adopt improvement', async () => {
 let cut = false
 const invoke = createAdvisor({ resolveRuntime: async () => ({ ok: true, cwd: process.cwd(), readTools: true, cfg: { provider: 'p', model: 'm' }, llm: {} }), runLoop: async () => ({ text: JSON.stringify(report({ verdict: cut ? 'suggestion' : 'keep', contribution: cut ? '实际改法' : '' })), trace: [], ...(cut ? { error: 'stream-cut' } : {}) }) })
 const clipped = await invoke({ mode: 'improve_result', question: 'q', currentResult: 'x'.repeat(16001) }, exec)
 assert.equal(clipped.ok, true); assert.equal(clipped.report.verdict, 'unverified'); assert.equal(clipped.retainCurrent, false)
 cut = true
 const partial = await invoke({ mode: 'improve_result', question: 'q', currentResult: '已有正文' }, exec)
 assert.equal(partial.ok, true); assert.equal(partial.partial, true); assert.equal(partial.improvementAvailable, false)
})

test('contribution material mixing and targeted reads do not weaken acceptance isolation', () => {
 const args = { files: [{ path: 'source.js', purpose: '实现限制' }], images: [{ path: 'view.png', purpose: '实际画面' }] }
 for (const mode of ['develop_approach', 'improve_result']) for (const scope of ['geometry', 'code']) {
  const policy = scopePolicy({ mode, scope, focus: '提升結果' })
  assert.equal(policy.allowTools, true); assert.equal(policy.imagesOnly, false); assert.equal(policy.omitImages, false)
  assert.deepEqual(scopedMaterials(args, policy).prepared, args)
  assert.match(scopeInstructions(policy), /可选拔高不是验收失败/)
 }
 assert.equal(scopePolicy({ mode: 'review_result', scope: 'geometry' }).imagesOnly, false) // independently image-first, then authorized source support
 assert.equal(scopePolicy({ mode: 'review_result', scope: 'code' }).omitImages, true)
})

test('native English contribution uses no translation call or stronger route', async () => {
 let translations = 0, input
 const invoke = createAdvisor({ resolveRuntime: async () => ({ ok: true, readTools: false, englishMode: true, cfg: { provider: 'deepseek-official', model: 'deepseek-flash' }, translateInstruction: async () => { translations++; throw new Error('must not translate') }, llm: { stream: o => { input = o; return stream(report()) } } }) })
 const out = await invoke({ mode: 'improve_result', question: 'Improve this result', currentResult: 'Actual result' }, exec)
 assert.equal(out.ok, true); assert.equal(translations, 0); assert.equal(input.provider, 'deepseek-official')
 assert.match(input.system, /Improving an already acceptable result/); assert.doesNotMatch(input.system, /你是/)
 assert.match(contributionSystem('develop_approach', true), /Before a key approach is locked/)
})

test('optimizer has one compact contract, preserves tier purposes and never forces item quotas', () => {
 for (const language of ['zh', 'en']) for (const tier of ['light', 'standard', 'heavy']) {
  const r = composeOptimizerSystem({ language, tier })
  assert.equal(r.revision, 'advisor-loop-1'); assert.equal(r.parts.filter(p => p.key === 'format').length, 1)
  assert.equal(r.parts.filter(p => p.key === 'tier').length, 1)
  assert.ok(r.text.includes(OPTIMIZER_TIERS[language][tier]))
  assert.doesNotMatch(r.text, /MAX_ITEMS|sourceRefs|最多.*条|At most.*items/)
 }
 assert.match(OPTIMIZER_CORE.zh, /可直接采用/); assert.match(OPTIMIZER_TIERS.zh.light, /表达/)
 const previous = ['你是提示词优化助手。结合用户原话与相关上下文，帮助工作 AI 更准确、更完整地满足用户期待，给出本轮真正有价值的澄清、补充与建议。','“不扭曲用户原意”是权威。保留用户的目标、否定、强调、偏好和已明确决定；你的解释与建议不能冒充用户要求。可以推断、补充与发挥，但要说明与原意的关系，把未确定前提和实质取舍显露出来。','按所选档位主动寻找增益，补充力度随任务调整。只把会改变结果、且需要用户回答的分歧列为反问；能从上下文解决、查明或合理决定的，不转嫁给用户。未查明的项目情况保持待核。','交付有用的结论和必要理由，篇幅与任务相称。理解本轮追问和纠正，更新当前意图；未被用户采纳的旧建议不成为要求。重复已有信息通常不增加价值，没有值得补充的内容时可以为空。'].join('\n')
 assert.equal(resolvePrompt({ home: '/unused', readFile: () => previous }).text, OPTIMIZER_CORE.zh)
 assert.equal(resolvePrompt({ home: '/unused', readFile: () => previous + '\n我自己的改动' }).source, 'file')
})

test('actual contribution dispatch sends both source and image materials, with no stage/coverage changes', async () => {
 const root = mkdtempSync(join(tmpdir(), 'quality-mixed-'))
 let input, recorded = 0
 try {
  writeFileSync(join(root, 'source.js'), 'const radius = 2')
  writeFileSync(join(root, 'view.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64'))
  const invoke = createAdvisor({ coverage: { record: () => { recorded++ } }, resolveRuntime: async () => ({
   ok: true, cwd: root, readTools: true, imageSupport: true, cfg: { provider: 'deepseek-official', model: 'deepseek-flash' }, llm: {},
   attachments: { saveImage: async () => ({ attachmentId: 'fake-local', mediaType: 'image/png', bytes: 60, width: 1, height: 1 }) }
  }), runLoop: async o => { input = o; return { text: JSON.stringify(report({ findings: [{ text: '已附实现和画面', evidenceRefs: ['F0', 'I0'] }] })), trace: [] } } })
  const out = await invoke({ mode: 'improve_result', scope: 'geometry', focus: '提升整体比例', question: '贡献可落实的改进',
   files: [{ path: 'source.js', purpose: '当前实现', evidenceType: 'source' }], images: [{ path: 'view.png', purpose: '实际画面', evidenceType: 'runtime-capture' }] }, exec)
  assert.equal(out.ok, true); assert.equal(out.improvementAvailable, true); assert.equal(recorded, 0)
  assert.match(input.messages[0].content[0].text, /const radius = 2/)
  assert.equal(input.messages[0].content.filter(b => b.type === 'image').length, 1)
  assert.deepEqual(out.materials.map(m => m.status), ['ready', 'ready'])
  assert.equal(out.model, 'deepseek-official/deepseek-flash')
 } finally { rmSync(root, { recursive: true, force: true }) }
})

