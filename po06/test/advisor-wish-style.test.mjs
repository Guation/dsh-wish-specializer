// 顾问的"声音"（2026-10-20 重构）：两段式、512 token、禁施工图。
//
// 用户给的形态（是思想，不是死条文）：
//   [顾问的理解] 现在……，是因为……，所以你应当……
//   [具体建议]   1. …… 2. ……
// 三条硬约束：不给代码/步骤；不写祈使命令；512 token 上限（超了先砍例子、保住病因与最关键一条）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { advisorDirective } from '../lib/advisor.js'
import { renderAdvisorVoice, estimateTokens, deBuild, ADVISOR_TOKEN_LIMIT } from '../lib/advisor-voice.js'

test('两段式：先理解，再具体建议', () => {
  const d = advisorDirective({ verdict: 'gaps', summary: '整台车读起来像玩具，先把体量感立起来。', checks: [{ criterion: '轮廓比例', status: 'failed' }], findings: [] })
  assert.ok(d.includes('【顾问的理解】'), '要有理解段')
  assert.ok(d.includes('【具体建议】'), '要有建议段')
  assert.ok(d.indexOf('【顾问的理解】') < d.indexOf('【具体建议】'), '顺序固定')
})

test('去施工图：代码块与行内代码都不出现', () => {
  const d = renderAdvisorVoice({
    verdict: 'gaps',
    summary: '这版的金属反射是错的：整块表面用了同一种粗糙度。',
    contribution: '1. 让粗糙度按区域分开\n2. 参考实现：\n\`\`\`js\nmat.roughness = 0.35\n\`\`\`\n3. 别用 \`MeshStandardMaterial\` 默认值',
    checks: [],
  })
  assert.ok(!d.includes('roughness = 0.35'), '代码块整段删掉')
  assert.ok(!d.includes('MeshStandardMaterial'), '行内代码只留语义、不留符号')
  assert.ok(d.includes('让粗糙度按区域分开'), '建议本体保留')
})

test('禁祈使：旧前缀被剥掉，建议不写成要求', () => {
  const d = renderAdvisorVoice({ verdict: 'gaps', summary: 'x', contribution: '必须修：后轮穿进车体', checks: [] })
  assert.ok(!d.includes('必须修'), '不出现祈使前缀')
  assert.ok(d.includes('后轮穿进车体'), '内容仍在')
})

test('512 token 上限：超了先砍次要建议', () => {
  const many = Array.from({ length: 30 }, (_, i) => (i + 1) + '. 第' + (i + 1) + '条建议'.padEnd(40, '长')).join('\n')
  const d = renderAdvisorVoice({ verdict: 'suggestion', summary: '一句话把病因说清。', contribution: many, checks: [] })
  assert.ok(estimateTokens(d) <= ADVISOR_TOKEN_LIMIT, '必须守在 512 以内，实际 ' + estimateTokens(d))
  assert.ok(d.includes('一句话把病因说清'), '病因要保住')
  assert.match(d, /1\. /, '第一条（最关键）要保住')
  assert.ok(!d.includes('第30条'), '尾部被砍')
})

test('没话说就是空串（调用方据此整段不出现）', () => {
  assert.equal(renderAdvisorVoice(null), '')
  assert.equal(renderAdvisorVoice({}), '')
})

test('camelCase 标识符要清掉，但普通英文词不能删（删除会挖出残句）', () => {
  const d = renderAdvisorVoice({
    verdict: 'gaps',
    summary: '现在 understandingOf 只取 summary，所以理解段只能是状态复述。',
    contribution: '1. 把 summary 和 findings 合成一句因果判断',
    checks: [],
  })
  assert.ok(!d.includes('understandingOf'), 'camelCase 标识符要清掉')
  // 真机教训：把"中文里所有英文词"删掉会把句子挖成 "让 = / / / 且无 检查项" 这种残句，
  // 比留着术语更糟。所以普通英文词原样保留。
  assert.ok(d.includes('summary'), '普通英文词保留，不做整词删除')
  assert.ok(d.includes('因果判断'), '正文保留')
})

test('the ask tool name survives advisor cleanup, including inline formatting', () => {
  const tool = 'ask_user_question'
  for (const mention of [tool, String.fromCharCode(96) + tool + String.fromCharCode(96)]) {
    const text = renderAdvisorVoice({ verdict: 'suggestion', summary: '需要用户确认车型。',
      contribution: '请调用 ' + mention + '，提供车型选项并等待回答。' })
    assert.ok(text.includes(tool))
  }
  assert.equal(deBuild('mesh_scale'), '', 'other code identifiers retain the existing cleanup behavior')
})

test('英文文本不误伤正常单词', () => {
  const d = renderAdvisorVoice({ verdict: 'gaps', summary: 'The surface reads as plastic because the highlight is uniform.', checks: [] }, { english: true })
  assert.ok(d.includes('surface'), '英文单词要留着')
})
