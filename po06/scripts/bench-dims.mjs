// 五维跑分（2026-10-23）：按用户定义的五个维度，用最小用例数回答“值不值得”。
//   D1 许愿型（只有要求、没有操作指令）是否让产物更好
//   D2 修 bug / 推理 / 决策是否更强（埋了可判定的真原因）
//   D3 成本增量（**不花调用**，由真实 token 与注入长度算出）
//   D4 长/精准提示词是否被拖累（防反效果，最重要）
//   D5 复杂工程/迭代（规格 + 失败报告：能不能定位失败并给下一步）
// 每个用例固定 4 次调用：优化 1 + 工作 A/B 2 + 盲评 1；全部落盘可续跑。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildInterpreterProtocol } from '../lib/index.js'
import { buildOptimizerUserMessage, renderOptimizerPacket, OPTIMIZER_OUTPUT_BUDGET_TOKENS } from '../lib/optimizer-protocol.js'
import { parseInterpreterOutput } from '../lib/interpreter.js'

const deps = process.env.SCAFFOLD_CHECK_DEPS, home = process.env.SCAFFOLD_CHECK_HOME
if (!deps || !home) throw Error('Set SCAFFOLD_CHECK_DEPS and SCAFFOLD_CHECK_HOME.')
const OUT = resolve(process.argv[2] || join('.po06-tmp', 'dims'))
mkdirSync(OUT, { recursive: true })
const load = n => import(pathToFileURL(join(deps, n, 'lib', 'index.js')).href)
const [{ parseCredentialsDocument }, ds, llm] = await Promise.all([load('dsh-credentials-local'), load('dsh-llm-deepseek'), load('dsh-llm')])
const key = parseCredentialsDocument(readFileSync(join(home, '.credentials.yaml'), 'utf8'), 'local-credentials').refs.get('DEEPSEEK_API_KEY')
if (!key) throw Error('credential unavailable')
const adapter = new ds.DeepSeekAdapter({
  options: () => ds.resolveAdapterOptions({}, { get: () => undefined }),
  resolveAuth: async () => ({ headers: { 'x-api-key': key } }),
  resolveUserId: () => 'po06-dims',
  prepareExtensions: async () => ({ fields: {}, accept: () => Promise.resolve() }),
})
const route = { provider: 'deepseek-official', model: 'deepseek-flash' }
const read = (p, d = '') => (existsSync(p) ? readFileSync(p, 'utf8') : d)
const write = (p, t) => writeFileSync(p, t)
async function once(system, user, maxTokens, effort) {
  const asm = new llm.BlockAssembler()
  let text = ''
  for await (const c of adapter.stream({ ...route, ...(effort ? { reasoningEffort: effort } : {}), system, ...(maxTokens ? { maxOutputTokens: maxTokens } : {}), messages: [llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: user }] })] })) {
    asm.push(c)
    if (c.type === 'text-delta') text += c.text || c.delta || ''
  }
  return { text, usage: asm.usage || null }
}
async function call(system, user, maxTokens = 1200, attempt = 1, effort = null) {
  try { return await once(system, user, maxTokens, effort) }
  catch (e) {
    if (attempt >= 3) throw e
    await new Promise(r => setTimeout(r, 1200 * attempt))
    return call(system, user, maxTokens, attempt + 1, effort)
  }
}

const WORKER = '你是工作模型。直接给最终结果：2000 字以内，可以贴关键代码，但不要复述要求、不要提问、不要解释你在做什么。'
const JUDGE = '你是严格评审。两份回应都应在 2000 字以内、可直接开工。只按三条打分（1-5 整数）：exec=可执行性（拿到能开工，含必要代码/参数）；spec=具体度（可检验的对象与手段）；risk=风险与验证（会坏在哪、怎么验）。不要因长度给分，也不要把“更长的文档”当成更好。只输出 JSON：{"x":{"exec":n,"spec":n,"risk":n},"y":{...},"winner":"X"|"Y"|"tie","why":"一句话"}'

const BUGGY = [
  '下面这段每帧推进的代码在浏览器里会偶发卡顿并逐渐变慢（10 秒后掉帧明显）。请定位原因并给出修法：',
  '```js',
  'function start(el){',
  '  let t = 0',
  '  setInterval(() => {',
  '    t += 16',
  '    const list = document.querySelectorAll(".particle")',
  '    for (const p of list) { p.style.transform = "translateY(" + Math.sin(t/300) * 10 + "px)" }',
  '  }, 16)',
  '  el.addEventListener("resize", () => { start(el) })',
  '}',
  '```',
].join('\n')

const DECISION = [
  '我要给一个单页应用加持久化，二选一：(A) localStorage 全量序列化整棵状态树；(B) 只存关键字段并在启动时迁移。',
  '约束：状态里有 300 个对象、需要在两个标签页之间同步、已有老用户数据可能缺字段。请给出选择与理由，并说明什么情况下结论会反转。',
].join('\n')

const SPEC = [
  '按下面的规格实现，不要改动规格：单文件 HTML + Canvas 2D；画布 960×540；背景 #0b0d12；',
  '每帧先用 rgba(11,13,18,0.18) 覆盖全屏做拖尾；粒子 240 个，速度 0.4–1.2 px/帧，生命周期 180 帧；',
  '颜色只用 #5ad1ff 与 #ff7ab6 两种，按速度插值；点击时在指针位置生成 60 个粒子；',
  '性能目标：桌面 60fps，帧时间超过 20ms 时把粒子数减半。请给出实现要点与如何验证达到 60fps。',
].join('\n')

const COMPLEX = [
  '项目：单文件 HTML 的陀螺对战，物理自研（无引擎）。规格：瓶盖直径 28mm、陀尖半径 1.2mm、',
  '初始 RPS 上限 40、摩擦系数 0.02、盘面半径 120mm；需求：两只陀螺对撞后速度按动量守恒衰减，',
  '接触 3 帧内不得穿插；胜负按先停/先出盘判定。',
  '当前失败报告：偏心放置（距中心 80mm）时陀螺高频抖动，居中则正常；日志显示接触冲量在 3 帧内反复反向。',
  '请诊断最可能的根因，并给出下一步最小验证动作。',
].join('\n')

const LONG_SPEC = [
  '实现一个可拖拽的两段式发射控件，按下面既定做法实现，不要另起方案：第一段按下后随水平位移累加上弦量（0–1，线性）；',
  '第二段在松手前的竖直位移决定甩出角度（-35°–35°）；上弦量映射到初速度 8–24 m/s；',
  '指针离开元素或窗口失焦必须硬停并归零；触控多指时只认第一指；需要用 requestAnimationFrame 更新预览而不触发重排；',
  '验收：连续 10 次拖拽的最大误差 < 2%，失焦后不得残留惯性。请给出实现要点与验证方式。',
].join('\n')

const CASES = [
  { id: 'd1-car', dim: 'D1', tier: 'heavy', request: '做个能开的三维跑车，要帅', check: 'inventions' },
  { id: 'd1-film', dim: 'D1', tier: 'heavy', request: '做一个 30 秒短片，要浪漫、宏大，能让人起鸡皮疙瘩' },
  { id: 'd2-bug', dim: 'D2', tier: 'standard', request: BUGGY, expect: ['setInterval', '重入', '重复', 'clearInterval'] },
  { id: 'd2-decide', dim: 'D2', tier: 'standard', request: DECISION, expect: ['迁移', '标签页', '冲突', '缺少字段'] },
  { id: 'd4-spec', dim: 'D4', tier: 'standard', request: SPEC, conflict: ['#0b0d12', '960', '240', '180', '60fps'] },
  { id: 'd4-launch', dim: 'D4', tier: 'standard', request: LONG_SPEC, conflict: ['8', '24', '35', '2%'] },
  { id: 'd5-top', dim: 'D5', tier: 'heavy', request: COMPLEX, expect: ['穿透', '接触', '冲量', '积分', '子步'] },
  { id: 'd1-game', dim: 'D1', tier: 'standard', request: '做个能玩的小游戏，要上瘾' },
  { id: 'd1-tool', dim: 'D1', tier: 'standard', request: '做个能批量重命名文件的工具，要好用' },
  { id: 'd1-site', dim: 'D1', tier: 'heavy', request: '做个个人主页，要高级、有设计感' },
  { id: 'd1-diagram', dim: 'D1', tier: 'standard', request: '画一张系统架构图，要能讲清数据怎么流动' },
  { id: 'd1-write', dim: 'D1', tier: 'standard', request: '写一篇产品发布稿，要有感染力' },
  { id: 'd1-platform', dim: 'D1', tier: 'heavy', request: '做个多关卡平台跳跃游戏，带存档与关卡编辑，要耐玩' },
]

const ONLY = (() => { const i = process.argv.indexOf('--dim'); return i >= 0 ? String(process.argv[i + 1] || '').toUpperCase() : '' })()
const rows = []
for (const c of CASES) {
  if (ONLY && c.dim !== ONLY) continue
  const base = join(OUT, c.id)
  const row = { id: c.id, dim: c.dim }
  // ① 优化包（缓存）
  const packetPath = base + '-packet.txt'
  let packet = read(packetPath)
  if (!packet.trim()) {
    const protocol = await buildInterpreterProtocol({ home, toolsEnabled: false, strategy: { tier: c.tier }, englishMode: false })
    const prompt = buildOptimizerUserMessage({ userText: c.request, styleHint: '' })
    const r = await call(protocol.text, prompt, OPTIMIZER_OUTPUT_BUDGET_TOKENS, 1)
    const parsed = parseInterpreterOutput(r.text, { userText: c.request, sessionId: 'dims', messageId: 'm-' + c.id, baseRevision: 1, baseInputRevision: 1, causeId: 'dims' })
    row.optimizerOk = parsed.ok === true
    row.optimizerTokens = r.usage && r.usage.outputTokens
    if (!parsed.ok) { row.error = parsed.code + ':' + parsed.reason; rows.push(row); console.log(JSON.stringify(row)); continue }
    packet = renderOptimizerPacket(parsed.optimizer, 'zh', { userText: c.request })
    write(packetPath, packet)
    write(base + '-optimizer.json', JSON.stringify({ usage: r.usage, counts: { add: (parsed.optimizer.add||[]).length, scaffold: (parsed.optimizer.scaffold||[]).length, ask: (parsed.optimizer.ask||[]).length } }))
  }
  row.packetChars = packet.length
  // ② 两侧工作产物（缓存）
  const aP = base + '-baseline.txt', bP = base + '-injected.txt'
  const a = read(aP) || (await call(WORKER, c.request, 1200)).text
  if (!read(aP)) write(aP, a)
  const b = read(bP) || (await call(WORKER, packet + '\n\n' + c.request, 1200)).text
  if (!read(bP)) write(bP, b)
  row.baselineChars = a.length; row.injectedChars = b.length
  // ③ 双评（缓存）：同一对产物评两次、X/Y 顺序互换。
  //    为什么：单评的噪声与要测的效应同量级（d1-car 同一产物两次判定从“负”变“平”），
  //    所以只有两次一致的结果才算数，不一致记为 disputed。
  async function judgeOnce(tag, flip) {
    const p = base + '-' + tag + '.json'
    let j = null
    try { j = JSON.parse(read(p) || 'null') } catch { j = null }
    if (j) return j
    const xText = flip ? b : a, yText = flip ? a : b
    const jr = await call(JUDGE, ['请求：', c.request, '', '===== X =====', xText.slice(0, 5000), '', '===== Y =====', yText.slice(0, 5000)].join('\n'), 400)
    let parsed = null
    try { parsed = JSON.parse(String(jr.text).replace(/^[^{]*/, '').replace(/[^}]*$/, '')) } catch { parsed = null }
    j = { flip, side: flip ? 'x' : 'y', ...(parsed || {}) }
    write(p, JSON.stringify(j, null, 2))
    return j
  }
  function verdictOf(j) {
    const bSide = j.side, aSide = bSide === 'x' ? 'y' : 'x'
    const w = j.winner == null ? null : String(j.winner).toLowerCase()
    return {
      winB: w === null ? null : (w === 'tie' ? 0 : (w === bSide ? 1 : -1)),
      injected: j[bSide] || null,
      baseline: j[aSide] || null,
      why: j.why || null,
    }
  }
  const flip1 = Math.random() < 0.5
  const j1 = await judgeOnce('judge1', flip1)
  const j2 = await judgeOnce('judge2', !flip1)
  const v1 = verdictOf(j1), v2 = verdictOf(j2)
  const agree = v1.winB !== null && v1.winB === v2.winB
  row.judge = { first: v1, second: v2, agree }
  row.winB = agree ? v1.winB : null
  row.disputed = !agree
  // ④ 机械判据：命中了多少预期要点 / 是否与既有规格冲突
  if (Array.isArray(c.expect)) {
    const hit = c.expect.filter(k => (a + b).includes(k))
    row.expectHits = { baseline: c.expect.filter(k => a.includes(k)).length, injected: c.expect.filter(k => b.includes(k)).length, of: c.expect.length }
  }
  if (Array.isArray(c.conflict)) {
    const nums = s => (String(s).match(/[0-9]+(?:\.[0-9]+)?/g) || [])
    const keep = k => String(b).includes(k)
    row.specKept = c.conflict.filter(keep).length + '/' + c.conflict.length
    row.specDropped = c.conflict.filter(k => !keep(k))
  }
  rows.push(row)
  console.log(JSON.stringify({ id: row.id, dim: row.dim, win: row.winB, judge: row.judge && row.judge.injected, expectHits: row.expectHits || null, specKept: row.specKept || null, packetChars: row.packetChars }))
}

writeFileSync(join(OUT, 'dims.json'), JSON.stringify({ rows }, null, 2) + '\n')
const byDim = {}
let disputed = 0
for (const r of rows) { const d = byDim[r.dim] || (byDim[r.dim] = { n: 0, wins: 0, losses: 0, ties: 0, disputed: 0 }); d.n++; if (r.disputed) { d.disputed++; disputed++ } if (r.winB === 1) d.wins++; else if (r.winB === -1) d.losses++; else if (r.winB === 0) d.ties++ }
console.log('DIMS ' + JSON.stringify(byDim))
console.log('DISPUTED ' + disputed)