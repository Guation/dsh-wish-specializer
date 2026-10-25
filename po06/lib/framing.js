// Framing is selected explicitly by policy and rendered with the optimizer data.
export const FRAMING_VALUES = Object.freeze(['neutral', 'hard'])
export const HARD_NOTE_MAX = 1200

export function normalizeHardNote(note) {
  const text = typeof note === 'string' ? note.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim() : ''
  return text.length <= HARD_NOTE_MAX ? text : ''
}

/** The optional task-specific note belongs at the end of the complete packet. */
export function framingBlock(framing, _note, language = 'zh') {
  if (framing !== 'hard') return ''
  return (language === 'en' ? [
    '[Straight-talk mode · plugin-added, not a new user requirement]',
    "Alright lads, we're a muscle crew, not a paperwork department. Bring the big, goofy energy: make the result hit hard, then hold up when someone looks twice.",
    "These are directions worth weighing, not marching orders. Pick the means that fit the job; keep the user's words, open choices and authorization intact.",
    "Small low-risk details are your call. Big decisions the user has not made are still theirs — keep the attitude, keep the line.",
  ] : [
    '【协作基调 · 硬邦邦（插件所加，不是用户的新要求）】',
    '老哥们，咱们是肌肉集团，不是文书科。带点憨劲、夸张和热血，把成品往镇得住场子的方向抬，细看也得站得住。',
    '下面是值得掂量的方向，不是军令状。具体做法你来拿捏，用户原话、没定的取舍和授权照实保留。',
    '低风险的小细节你自己拍板；用户没拍板的大事不准替他定——性情归性情，边界不能糊。',
  ]).join('\n')
}

export function framingLabels(framing, language = "zh") {
  if (String(framing) !== "hard") return null
  if (language === "en") return {
    header: "[Plugin context — not new user commands]",
    turnScope: "This turn's words (this turn only; not standing authorization)",
    requirements: "What the user said (not a complete list)",
    quality: "Quality reading (not a new command)",
    facts: "Checked facts (with sources)",
    options: "Implementation options you may adjust",
    proposals: "Suggestions on the table (not adopted; not requirements)",
    checks: "Self-check before delivery",
    unknowns: "Undecided (do not decide for me)",
  }
  return {
    header: "【插件加的说明 · 不是用户新下的命令】",
    turnScope: "这一轮的原话（只管这一轮，别当长期授权）",
    requirements: "用户原话（不是完整清单）",
    quality: "质量解读（别当新命令）",
    facts: "已查证的事实（带来源）",
    options: "可以自己调的实现选项",
    proposals: "待选建议（没采纳，别当需求）",
    checks: "交活前自检",
    unknowns: "没定的事（别替我拍板）",
  }
}

/** The same expressive voice is used in model guidance and the final renderer. */
export function framingToneHint(framing, language = 'zh') {
  if (framing !== 'hard') return ''
  return language === 'en'
    ? "Use the user's chosen goofy, expressive straight-talk style throughout: a warm, over-the-top muscle-crew pep talk, with playful imagery and enthusiasm. Keep the advice broad and directional; the style adds no steps, numeric parameters, constraints or authorization. Preserve uncertainty and the user's open choices. An optional task-specific hardNote may add a final burst of energy; optional hardOn citations refer only to IDs of suggestions in this response."
    : '整份建议用用户选定的硬邦邦风格：像肌肉集团的老哥带点憨劲地热血打气，口语、夸张、有画面感。建议仍是方向性许愿，风格不增加步骤、数值参数、限制或授权；未决取舍与用户原意照实保留。可选 hardNote 在整段末尾来一句贴题的加码，可选 hardOn 只引用本次建议的 id。'
}

export function optimizerFramingLabels(framing, language = 'zh') {
  const en = language === 'en'
  if (framing === 'hard') return en ? {
    introduction: "Alright lads, here's what could give this result some muscle. Weigh these directions against the job and choose the means; the user's requirements still lead, and this is no mandatory checklist.",
    production: '[What to build]', scaffold: '[Scaffold to rig up or reuse]',
  } : {
    introduction: '老哥们，下面这些方向能给成品长点肌肉，你按实际情况掂量、自己拿捏做法；用户明确要求照旧当家，别把建议当逐条必做的军令状。',
    production: '【要干的事】', scaffold: '【可搭或复用的临时脚手架】',
  }
  return en ? {
    introduction: 'Give these goal-focused suggestions priority consideration and judge them against the actual task. The working model chooses the means; suggestions do not override explicit user requirements or become mandatory checklist items.',
    production: '[Production suggestions]', scaffold: '[Temporary scaffold suggestions]',
  } : {
    introduction: '请优先考虑以下围绕目标提炼的重点建议，并结合实际判断取舍。具体做法由工作模型决定；建议不覆盖用户明确要求，也不自动成为逐条必做的硬性要求。',
    production: '【制作建议】', scaffold: '【临时脚手架建议】',
  }
}
