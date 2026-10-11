// P9 · **换机器搬迁打包**：把「不在 git 里、但新机器上要用」的文件收拢到一个目录 + 清单。
//
// 为什么需要它：真正的开发依赖分散在三处——
//   ① 仓库本身（git 带得走）；② 仓库外的发布工具与配置（~/.dsh 下，**git 带不走**）；
//   ③ profile 装配接线（含**本机绝对路径**，复制过去必须改）。
//   靠"记得拷哪些"一定会漏；漏了的表现是"新机器上能跑但发版/热重载/注入都不对"。
//
// 用法：node po06/scripts/pack-migration.mjs [--out <目录>] [--zip]
//   默认输出到 <DSH_HOME>/migration-<日期>/
// 只做**复制**：不删任何东西，缺失的条目跳过并记进清单。
import { existsSync, mkdirSync, copyFileSync, cpSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = join(HERE, '..', '..')                 // 仓库根
const DSH = process.env.DSH_HOME || join(homedir(), '.dsh')
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const stamp = new Date().toISOString().slice(0, 10)
const OUT = opt('out', join(DSH, 'migration-' + stamp))

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/**
 * 要搬的仓库外条目。每项写清**为什么**，因为"为什么"决定它能不能被跳过。
 * kind: file（单文件）/ dir（整目录）/ glob（按前缀匹配的文件）
 */
const ITEMS = [
  { from: join(DSH, 'po06-beta', 'make-release.mjs'), why: '一键发版脚本（建 tag→核对落点→打包→发 Release）', must: true },
  { from: join(DSH, 'po06-beta'), glob: /^notes-.*\.md$/, into: 'po06-beta', why: '各版 Release 说明正文（重发/改说明要用）', must: false },
  { from: join(DSH, 'po06.json'), why: '插件设置（白名单档位/权限/模型等；不含本机路径）', must: true },
  { from: join(DSH, 'po06-prompt.md'), why: '解释层核心提示词覆盖（当前是协议 v3 的 323 字核心）', must: true },
  { from: join(DSH, 'po06-prompt.before-protocol-v3-c0374fa4.md'), why: '迁移前的旧默认提示词备份（回退用）', must: false },
  { from: join(DSH, 'prompt-optimizer.json'), why: '0.5 旧插件配置（只为验证 DOUBLE_INTERCEPT 双重拦截）', must: false },
  // ⚠ profile 的 package.json 在**子目录**里（profiles/<name>/package.json），所以要按子目录逐个取。
  { from: join(DSH, 'profiles'), perSubdir: /^package\.json$/, into: 'profiles/<name>', why: 'profile 依赖与 bundles 接线（**含本机绝对路径，必须改**）', must: true },
  { from: join(DSH, 'profiles', 'desktop', 'cordis.patch.yml'), why: '桌面版 profile 的装配补丁（含注入器条目）', must: false },
  { from: join(DSH, 'tmp-test'), glob: /\.(cjs|sh|mjs)$/, into: 'tmp-test', why: '开发期助手脚本（CI 日志读取、变异抽查、套件运行等）', must: false },
  { from: join(DSH, 'tmp-pack', 'dsh020-src'), why: 'DSH 0.2.0 源码快照（0.2 兼容核对用）', must: false },
  // 插件自己的运行期数据：新机器上"接着用"会需要，但不带也能从零开始
  { from: join(DSH, 'po06-state'), dir: true, why: '意图状态（跨会话累积约束；带过去可续用旧会话）', must: false },
  { from: join(DSH, 'po06-english'), dir: true, why: '英文模式翻译缓存', must: false },
  { from: join(DSH, 'po06-capability'), dir: true, why: '任务理解与建议的持久化', must: false },
  { from: join(DSH, 'po06-inference'), dir: true, why: '推理增强的调用轨迹', must: false },
]

mkdirSync(OUT, { recursive: true })
const manifest = { at: new Date().toISOString(), dsh: DSH, repo: REPO, out: OUT, copied: [], skipped: [], note: '只复制，不删除；缺失项列在 skipped。' }

function destFor(item, name) {
  if (item.into) return join(OUT, item.into.replace('<name>', name), name === 'package.json' && item.into.includes('/') ? 'package.json' : basename(name))
  return join(OUT, basename(item.from))
}

for (const item of ITEMS) {
  // 子目录里的同名文件（profiles/<name>/package.json）：逐个 profile 取，别指望一层匹配。
  if (item.perSubdir) {
    if (!existsSync(item.from)) { manifest.skipped.push({ item: item.from, why: item.why, reason: 'not-found' }); continue }
    let got = 0
    for (const name of readdirSync(item.from)) {
      const sub = join(item.from, name)
      if (!statSync(sub).isDirectory()) continue
      for (const n of readdirSync(sub).filter((x) => item.perSubdir.test(x))) {
        const src = join(sub, n)
        if (!statSync(src).isFile()) continue
        const dst = join(OUT, item.into.replace('<name>', name), n)
        mkdirSync(dirname(dst), { recursive: true })
        copyFileSync(src, dst)
        manifest.copied.push({ to: relative(OUT, dst), from: src, bytes: statSync(src).size, sha256: sha(src), why: item.why, must: item.must === true })
        got += 1
      }
    }
    if (got === 0) manifest.skipped.push({ item: item.from, why: item.why, reason: 'no-match' })
    continue
  }
  if (item.glob) {
    const dir = item.from
    if (!existsSync(dir)) { manifest.skipped.push({ item: dir, why: item.why, reason: 'not-found' }); continue }
    const hits = readdirSync(dir).filter((n) => item.glob.test(n))
    if (hits.length === 0) { manifest.skipped.push({ item: dir, why: item.why, reason: 'no-match' }); continue }
    for (const n of hits) {
      const src = join(dir, n)
      if (!statSync(src).isFile()) continue
      const rel = item.into.replace('<name>', basename(dir))
      const dst = join(OUT, rel, n)
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst)
      manifest.copied.push({ to: relative(OUT, dst), from: src, bytes: statSync(src).size, sha256: sha(src), why: item.why, must: item.must === true })
    }
    continue
  }
  if (!existsSync(item.from)) { manifest.skipped.push({ item: item.from, why: item.why, reason: 'not-found' }); continue }
  const st = statSync(item.from)
  try {
    if (st.isDirectory()) {
      const dst = join(OUT, basename(item.from))
      cpSync(item.from, dst, { recursive: true })
      manifest.copied.push({ to: relative(OUT, dst), from: item.from, dir: true, why: item.why, must: item.must === true })
    } else {
      const dst = destFor(item, basename(item.from))
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(item.from, dst)
      manifest.copied.push({ to: relative(OUT, dst), from: item.from, bytes: st.size, sha256: sha(item.from), why: item.why, must: item.must === true })
    }
  } catch (e) { manifest.skipped.push({ item: item.from, why: item.why, reason: 'copy-failed:' + String(e.message).slice(0, 80) }) }
}

writeFileSync(join(OUT, 'MIGRATION-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log('输出目录：' + OUT)
console.log('已复制 ' + manifest.copied.length + ' 项，跳过 ' + manifest.skipped.length + ' 项（缺失）')
for (const c of manifest.copied) console.log('  ' + (c.must ? '[必须] ' : '[可选] ') + c.to + (c.bytes ? '  ' + c.bytes + ' B' : ''))
for (const s of manifest.skipped) console.log('  [跳过] ' + s.item + '  (' + s.reason + ')')
console.log('')
console.log('⚠ 复制过去之后必须改的两类东西见 docs/MIGRATION-TO-ANOTHER-MACHINE.md')
