// 顾问的"愿望式"口径（2026-10-19 用户要求）。
//
// 用户原话：顾问答复"过于详细、过于精准"，应当是许愿式的、一条一条的、点到为止；
// 只有 bug 修复可以稍详细；要的是足够大、直击质变的答复，不是在原方案上小修小补。
// 这里钉住三件事：提示词口径、指令的渲染形态、以及"这不是验收通过"的边界。
import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionSystem } from '../lib/advisor-contribution.js'
import { advisorDirective } from '../lib/advisor.js'

test('贡献提示词：往上抬、点到为止、不写代码、只有缺陷可稍具体', () => {
  for (const mode of ['develop_approach', 'improve_result']) {
    for (const en of [false, true]) {
      const sys = contributionSystem(mode, en)
      assert.ok(sys.includes(en ? 'Raise the ceiling' : '往上抬'), '要写明"往上抬"')
      assert.ok(sys.includes(en ? 'One line per demand' : '点到为止'), '要写明点到为止')
      assert.ok(sys.includes(en ? 'no code' : '不写代码'), '禁止代码')
      assert.ok(sys.includes(en ? 'Defect:' : '缺陷：'), '缺陷行是唯一的例外')
      assert.ok(sys.includes('checks'), 'checks 仍要显式声明为空')
      assert.ok(sys.length > 200, '不是空壳')
    }
  }
})

test('指令形态：编号方向逐条列出，缺陷行变成必须修', () => {
  const report = {
    verdict: 'suggestion',
    summary: '整台车读起来像玩具，先把体量感立起来。',
    contribution: '1. 让轮廓像四十吨的机器\n2. 光源改成阴天的厂区\n3. 表面加上真实的脏污分布\n缺陷：后轮穿进车体 3cm',
    findings: [], checks: [],
  }
  const d = advisorDirective(report, 'develop_approach')
  assert.ok(d.includes('方向（往上抬，不是在现有方案上打补丁）：'), '方向块要有明确标题')
  assert.match(d, /1\) 让轮廓像四十吨的机器/)
  assert.match(d, /3\) 表面加上真实的脏污分布/)
  assert.match(d, /必须修：后轮穿进车体 3cm/, '缺陷行要提出来当必须修')
  assert.ok(!d.includes('可采用的做法'), '旧口径已退出')
  assert.ok(d.includes('不等于验收通过'), '方向不是验收')
  assert.ok(d.includes('不是“仅供参考”'), '但仍然是有约束力的')
})

test('方向最多五条（点到为止），summary 会被截短', () => {
  const many = Array.from({ length: 9 }, (_, i) => (i + 1) + '. 方向' + (i + 1)).join('\n')
  const d = advisorDirective({ verdict: 'suggestion', summary: 'x'.repeat(500), contribution: many }, 'improve_result')
  assert.equal((d.match(/^\s+\d\) /gm) || []).length, 5, '最多五条')
  assert.ok(d.length <= 1200, '总长有上限')
  assert.ok(!d.includes('方向9'), '第九条不渲染')
})

test('复核模式不需要方向块：保留结论/下一步/停止条件', () => {
  const d = advisorDirective({
    verdict: 'gaps',
    summary: '验收项里有一条没过。',
    findings: [{ text: '导出按钮在窄屏被裁掉' }],
    checks: [{ criterion: '窄屏可用', status: 'failed' }],
    nextStep: '修好后重跑这一条',
    stopCondition: '两次同样的失败就停下来问我',
  }, 'review_result')
  assert.ok(d.includes('必须修：窄屏可用'))
  assert.ok(d.includes('注意：导出按钮在窄屏被裁掉'))
  assert.ok(d.includes('下一步：修好后重跑这一条'))
  assert.ok(d.includes('停止条件：两次同样的失败就停下来问我'))
  assert.ok(!d.includes('方向（往上抬'), '复核不是给方向')
})
