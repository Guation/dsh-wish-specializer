// 可视化页（doc/how-it-works.html）的**防过期**套件。
//
// 这张图的唯一价值是可信：节点里写的文件路径必须真的存在，refs 必须能解析到节点。
// 代码一改、文件一挪，这里就会红——和仓库里其他套件同一种做法。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const DOC = join(ROOT, 'doc', 'how-it-works.html')

function loadGraph() {
  const html = readFileSync(DOC, 'utf8')
  const m = /<script id="graph-data">([\s\S]*?)<\/script>/.exec(html)
  assert.ok(m, 'doc/how-it-works.html 里要有 <script id="graph-data">')
  return new Function(m[1] + '; return GRAPH;')()
}

function walk(node, visit) {
  visit(node)
  for (const c of node.children || []) walk(c, visit)
}

test('可视化页存在，且图数据与渲染脚本都能解析', () => {
  assert.ok(existsSync(DOC), '缺 doc/how-it-works.html')
  const html = readFileSync(DOC, 'utf8')
  const data = /<script id="graph-data">([\s\S]*?)<\/script>/.exec(html)
  const app = /<script>([\s\S]*?)<\/script>\s*<\/body>/.exec(html)
  assert.ok(data && app, '两段脚本都要在')
  new Function(data[1] + '; return GRAPH;')
  new Function(app[1])
})

test('节点 id 不重复，refs 全部能解析到节点', () => {
  const g = loadGraph()
  const ids = new Set()
  const dups = []
  const refs = []
  for (const v of Object.values(g.views)) {
    walk(v.root, (n) => {
      if (ids.has(n.id)) dups.push(n.id)
      ids.add(n.id)
      for (const r of n.refs || []) refs.push([n.id, r])
    })
  }
  assert.deepEqual(dups, [], '节点 id 必须唯一：' + dups.join(','))
  const dangling = refs.filter(([, r]) => !ids.has(r)).map(([from, r]) => from + ' → ' + r)
  assert.deepEqual(dangling, [], '悬空引用：' + dangling.join(' | '))
})

test('每个 code.path 都是仓库里真实存在的文件', () => {
  const g = loadGraph()
  const missing = []
  for (const v of Object.values(g.views)) {
    walk(v.root, (n) => {
      // 图里的路径是**仓库根相对**的（po06/lib/…），所以从 po06/ 往上一层再拼
      if (n.code && n.code.path && !existsSync(join(ROOT, '..', n.code.path))) missing.push(n.code.path)
    })
  }
  assert.deepEqual(missing, [], '图上引用了不存在的文件：' + missing.join(','))
})

test('流程说清了这一版的关键事实：只画注入文、写插件内存、不写会话事件', () => {
  const g = loadGraph()
  const texts = []
  for (const v of Object.values(g.views)) {
    walk(v.root, (n) => texts.push(JSON.stringify(n)))
  }
  const blob = texts.join('\n')
  for (const must of ['anchorSeq', 'noteInjection', '只显示实际注入文', 'po06/injection']) {
    assert.ok(blob.toLowerCase().includes(must.toLowerCase()) || blob.includes(must), '图上缺关键事实：' + must)
  }
})
