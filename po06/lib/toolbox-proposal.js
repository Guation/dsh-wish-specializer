// A proposal describes missing working capabilities, never a tool implementation or a verified fact.
export const TOOLBOX_VERSION = '1'
export const TOOLBOX_ACTIONS = Object.freeze(['none', 'reuse', 'build', 'inspect'])
export const TOOLBOX_PROMPT = Object.freeze({
  zh: '同时判断本任务是否值得复用或搭建任务内的临时工具箱。依据重复操作、修改定位难度与反馈缺口判断，不按行业关键词触发，不要求每个任务先搭框架。capabilitySummary 是带范围和来源的能力事实；未知不等于没有，已注册不等于实测可用，优化器只读工具关闭不代表工作模型没有工具。已有能力足够就复用；收益不明先查环境；简单任务无需新增。确有收益时，可在 JSON 额外返回 toolbox:{recommendation:"none|reuse|build|inspect",reason:"本任务的能力缺口与收益",basis:["事实依据或未知前提"],capabilities:["所需操作能力及输入输出"],feedback:["取得什么反馈、如何指导下次修改"],firstUse:"首先服务的真实子任务",stopWhen:"何时不再扩建"}。可省略或返回 none。只提出方向与能力需求，不写代码、命令、参数或实现步骤；工作模型检查环境并自行施工。工具要被实际使用，观察结果后修正产物，并在后续修改中复用；不能只生成目录或截图脚本。保留用户技术路线和交付边界，制作工具不是新交付目标；是否换路线仍走 ask。',
  en: 'Also judge whether this task benefits from reusing or building a temporary task toolbox. Use repeated operations, difficulty locating changes and feedback gaps, not domain keywords. Do not require a framework for every task. capabilitySummary contains scoped evidence: unknown does not mean absent, registration is not proven runtime availability, and disabled optimizer read tools say nothing about the working model’s tools. Reuse adequate capabilities, inspect unknown environments, and skip simple tasks. Optionally return toolbox:{recommendation:"none|reuse|build|inspect",reason:"task-specific gap and benefit",basis:["evidence or unknown premise"],capabilities:["needed operation with inputs and outputs"],feedback:["observations and how they inform changes"],firstUse:"first real subtask",stopWhen:"when to stop extending"}. Omission or none is valid. Describe capabilities and directions only: no code, commands, parameters or implementation steps. The working model checks the environment and implements, actually uses the tools, reads feedback, corrects the artifact and reuses them. Preserve the requested stack and delivery constraints; tooling is not a new product requirement. Route real user choices through ask.'
})

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const text = x => typeof x === 'string' ? x.trim() : ''
const list = x => typeof x === 'string' ? (text(x) ? [text(x)] : [])
  : Array.isArray(x) && x.every(v => typeof v === 'string') ? x.map(text).filter(Boolean) : null

export function normalizeToolbox(value, { enabled = true } = {}) {
  if (!enabled || value === undefined || value === null) return { proposal: null, warnings: [] }
  const invalid = reason => ({ proposal: null, warnings: ['toolbox:' + reason] })
  if (!object(value)) return invalid('expected-object')
  if (value.version !== undefined && String(value.version) !== TOOLBOX_VERSION) return invalid('unsupported-version')
  if (!TOOLBOX_ACTIONS.includes(value.recommendation)) return invalid('invalid-recommendation')
  if (value.recommendation === 'none') return { proposal: { version: TOOLBOX_VERSION, recommendation: 'none' }, warnings: [] }
  if (!text(value.reason)) return invalid('reason-required')
  const proposal = { version: TOOLBOX_VERSION, recommendation: value.recommendation, reason: text(value.reason) }
  const warnings = []
  for (const key of ['basis', 'capabilities', 'feedback']) {
    const rows = value[key] === undefined ? [] : list(value[key])
    if (rows === null) { warnings.push('toolbox:' + key + '-invalid'); proposal[key] = [] }
    else proposal[key] = rows
  }
  for (const key of ['firstUse', 'stopWhen']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') warnings.push('toolbox:' + key + '-invalid')
    proposal[key] = text(value[key])
  }
  // Keep only a versioned proposal, never caller-supplied authority, task IDs or success claims.
  return { proposal, warnings }
}

export function hasToolboxContent(value) {
  const { proposal } = normalizeToolbox(value)
  return !!proposal && proposal.recommendation !== 'none'
}

export function renderToolboxProposal(value, language = 'zh') {
  const { proposal: p } = normalizeToolbox(value)
  if (!p || p.recommendation === 'none') return ''
  const en = language === 'en'
  const labels = en ? { reuse: 'Reuse existing capabilities', build: 'Build or extend task tools', inspect: 'Inspect existing capabilities first' }
    : { reuse: '复用已有能力', build: '搭建或扩展任务工具', inspect: '先查明已有能力' }
  const lines = [en ? '[Working method · task toolbox]' : '【本轮工作方法 · 按需补齐制作与反馈能力】', labels[p.recommendation] + '：' + p.reason]
  const fields = en ? { basis: 'Basis / unknown premises', capabilities: 'Capabilities needed', feedback: 'Feedback to read and use' }
    : { basis: '依据与待核前提', capabilities: '需要的操作能力', feedback: '需要读取并用于修正的反馈' }
  for (const key of ['basis', 'capabilities', 'feedback']) if (p[key].length) lines.push(fields[key] + ':\n' + p[key].map(s => '- ' + s).join('\n'))
  if (p.firstUse) lines.push((en ? 'First real use: ' : '首先服务的真实工作：') + p.firstUse)
  if (p.stopWhen) lines.push((en ? 'Stop extending when: ' : '停止扩建的条件：') + p.stopWhen)
  lines.push(en
    ? 'Working model: check existing capabilities, then reuse, extend, build or decline with evidence. Implement and invoke through available tools, read the actual feedback, correct the artifact and reuse the entry for later changes. Preserve the user’s stack and delivery requirements; a proposal is not an existing tool or a new acceptance criterion.'
    : '请工作模型核对已有能力，再据实际选择复用、扩展、搭建或有依据地不采用；自行实现并通过现有工具真实调用，读取反馈后修正产物，后续修改复用入口。保持用户技术路线和交付要求；提案不代表工具已可用，也不新增验收目标。')
  return lines.join('\n')
}
