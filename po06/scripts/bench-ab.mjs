// 端到端 A/B（2026-10-23）：同一工作模型、同一请求，**带注入** vs **不带注入**，
// 再由一个独立评审盲评（X/Y 顺序随机），回答一个问题：注入到底有没有让产物更好？
//
// 为什么必须 A/B：结构指标全绿只证明“提示词没坏”，证明不了“工作模型因此产出更好”。
// 判据（评审只按这三条打分，1-5）：
//   exec 可执行性：拿到后能不能直接开工，而不是还要再问一轮
//   spec 具体度：有没有可检验的对象/手段，而不是“要精致要流畅”
//   risk 风险意识：有没有指出会坏在哪、怎么验证
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const deps = process.env.SCAFFOLD_CHECK_DEPS, home = process.env.SCAFFOLD_CHECK_HOME
if (!deps || !home) throw Error('Set SCAFFOLD_CHECK_DEPS and SCAFFOLD_CHECK_HOME.')
const OUT = resolve(process.argv[2] || join('.po06-tmp', 'bench-ab'))
mkdirSync(OUT, { recursive: true })
const load = n => import(pathToFileURL(join(deps, n, 'lib', 'index.js')).href)
const [{ parseCredentialsDocument }, ds, llm] = await Promise.all([load('dsh-credentials-local'), load('dsh-llm-deepseek'), load('dsh-llm')])
const key = parseCredentialsDocument(readFileSync(join(home, '.credentials.yaml'), 'utf8'), 'local-credentials').refs.get('DEEPSEEK_API_KEY')
if (!key) throw Error('official credential unavailable')
const adapter = new ds.DeepSeekAdapter({
  options: () => ds.resolveAdapterOptions({}, { get: () => undefined }),
  resolveAuth: async () => ({ headers: { 'x-api-key': key } }),
  resolveUserId: () => 'po06-bench-ab',
  prepareExtensions: async () => ({ fields: {}, accept: () => Promise.resolve() }),
})
// 长生成在本机网络上会被中途掐断（ECONNRESET，重试三次仍失败），因此用 medium 档 + 2000 token：
// 两侧条件仍然完全一致，只是把单次生成压到不会被掐断的长度。
const route = { provider: 'deepseek-official', model: 'deepseek-flash' }
async function call(system, user, maxTokens = 1500, attempt = 1) {
  try { return await once(system, user, maxTokens) }
  catch (e) {
    if (attempt >= 3) throw e
    await new Promise(r => setTimeout(r, 1500 * attempt))
    return call(system, user, maxTokens, attempt + 1)
  }
}
async function once(system, user, maxTokens) {
  const asm = new llm.BlockAssembler()
  let text = ''
  for await (const c of adapter.stream({ ...route, system, maxOutputTokens: maxTokens, messages: [llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: user }] })] })) {
    asm.push(c)
    if (c.type === 'text-delta') text += c.text || c.delta || ''
  }
  return { text, usage: asm.usage || null }
}

// 两侧必须同长度上限：否则谁“没被截断”谁就赢，那不是质量差异。
// 800 字以内、不贴整段代码——把评审逼回到“方案与判据”上。
const WORKER_SYSTEM = '你是工作模型。按用户请求直接产出最终结果：800 字以内，不要复述要求、不要提问、不要解释你在做什么、不要贴整段完整代码（必要时只给关键片段）。'
const JUDGE_SYSTEM = [
  '你是严格评审。比较两份对同一请求的回应，只按三条打分（1-5 整数）：',
  'exec=可执行性（拿到就能开工，无需再问）；spec=具体度（有可检验的对象与手段）；risk=风险意识（指出会坏在哪、如何验证）。',
  '不要因为长度更长就给高分；不要被语气影响。只输出 JSON：{"x":{"exec":n,"spec":n,"risk":n},"y":{...},"winner":"X"|"Y"|"tie","why":"一句话"}',
].join('')

const TASKS = ['short', 'creative', 'engineering'].map(id => ({
  id,
  packetPath: join('.po06-tmp', 'bench', 'packet-' + id + '.txt'),
  request: { short: '做一个跑车', creative: '以你自己为本体，做一个极具夸张艺术色彩的动画，主题自选，意境要浪漫而宏大', engineering: '给这个单页加一个可拖拽的两段式输入，第一段上弦第二段甩出，要有力度反馈' }[id],
}))

const rows = []
for (const t of TASKS) {
  if (!existsSync(t.packetPath)) { rows.push({ id: t.id, error: 'missing-packet' }); console.log(JSON.stringify({ id: t.id, error: 'missing-packet' })); continue }
  const packet = readFileSync(t.packetPath, 'utf8').trim()
  // 续跑：已有产物直接复用（一次跑不完时不必重花模型调用）
  const bp = join(OUT, t.id + '-baseline.txt'), ip = join(OUT, t.id + '-injected.txt')
  const a = existsSync(bp) ? { text: readFileSync(bp, 'utf8'), usage: null } : await call(WORKER_SYSTEM, t.request)
  const b = existsSync(ip) ? { text: readFileSync(ip, 'utf8'), usage: null } : await call(WORKER_SYSTEM, packet + '\n\n' + t.request)
  // 盲评：X/Y 随机，记录映射
  const flip = Math.random() < 0.5
  const xText = flip ? b.text : a.text, yText = flip ? a.text : b.text
  const judgeUser = ['请求：', t.request, '', '===== X =====', xText.slice(0, 6000), '', '===== Y =====', yText.slice(0, 6000)].join('\n')
  const j = await call(JUDGE_SYSTEM, judgeUser, 400)
  let parsed = null
  try { parsed = JSON.parse(String(j.text).replace(/^[^{]*/, '').replace(/[^}]*$/, '')) } catch { parsed = null }
  const winner = parsed && parsed.winner ? parsed.winner : null
  const bIsX = flip
  const winB = winner === 'tie' ? 0 : winner === null ? null : ((winner === 'X') === bIsX ? 1 : -1)
  const row = {
    id: t.id, request: t.request, packetChars: packet.length, bSide: flip ? 'x' : 'y',
    baselineChars: a.text.length, injectedChars: b.text.length,
    judge: parsed, winner, winB,
    aTokens: a.usage && a.usage.outputTokens, bTokens: b.usage && b.usage.outputTokens,
  }
  rows.push(row)
  writeFileSync(join(OUT, t.id + '-baseline.txt'), a.text + '\n')
  writeFileSync(join(OUT, t.id + '-injected.txt'), b.text + '\n')
  console.log(JSON.stringify({ id: t.id, winner, winB, judge: parsed }))
}
const done = rows.filter(r => r.judge)
// 盲评的 X/Y 是随机分配的，所以必须按 bSide 还原“哪一侧是注入”，否则均值是错的。
const pick = (r, injected) => { const side = injected ? r.bSide : (r.bSide === 'x' ? 'y' : 'x'); return (r.judge && r.judge[side]) || null }
const score = (k, injected) => { const v = done.map(r => (pick(r, injected) || {})[k]).filter(Boolean); return v.length ? +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(2) : null }
const summary = {
  tasks: rows.length,
  wins: done.filter(r => r.winB === 1).length,
  losses: done.filter(r => r.winB === -1).length,
  ties: done.filter(r => r.winB === 0).length,
  baseline: { exec: score('exec', false), spec: score('spec', false), risk: score('risk', false) },
  injected: { exec: score('exec', true), spec: score('spec', true), risk: score('risk', true) },
}
// 盲评里 X/Y 是随机的，均值口径按“哪一侧是注入”还原
writeFileSync(join(OUT, 'bench-ab.json'), JSON.stringify({ summary, rows }, null, 2) + '\n')
console.log('SUMMARY ' + JSON.stringify(summary))