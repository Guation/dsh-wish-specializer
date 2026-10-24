// 0.7.8 · 协作基调（Interaction Framing）
//
// 起因（用户 2026-09-27 实测）：同样的要求，用口语、带情绪、带关系感的说法讲出来，
// 首轮交付明显好于同等字数、同等信息量的正式说法。关键反证是：**同样字数的正式提示词
// 做不到那个效果** ⇒ 起作用的是**语域**，不是信息量。
//
// 机制：模型对提示词的语域条件化采样——正式语域命中「专业助手接正式请求」那一簇（客套、hedging、
// 求稳），口语+高唤醒语域命中「哥们帮你把活干出来」那一簇（直接开干、把成品拿出来）。
// 所以这一档**必须保留语域本身**；把它消毒成「请更积极主动」等于扔掉效果来源。
//
// 分工（B 方案，用户 2026-09-27 定）：
//   · **骨架归代码**（OPEN / MID / BOUNDARY）：标签、语域、越权反制——三条不变量，模型无权改；
//   · **加码归模型**（hardNote）：由解释层按这一轮的实际情况写，**长度自定**、要求定点爆破。
//     它插在 MID 与 BOUNDARY 之间，所以**边界行永远在最后**，不会被生成内容挤掉或改写。
//
// 三条硬边界：① 不代表用户说话（标签写明插件所加）；② 不放松决策边界（BOUNDARY 行）；
//   ③ 不改用户原话。加码部分另有一道机械防线：**必须引用包内已有条目的 id**，
//   写不出引用就不采用（见 pipeline 的引用校验）——「语气里夹带新要求」是它最大的风险。

/** 协作基调的值域（与 settings.js 的 FRAMINGS 一致）。 */
export const FRAMING_VALUES = Object.freeze(['neutral', 'hard'])

/** 骨架：开场标签 + 语域。**这两行是效果来源，不要交给模型生成。** */
const OPEN = [
  '【协作基调 · 硬邦邦（插件所加，不是用户的新要求）】',
  '老哥们，话我先撂这儿：时间不多，别磨叽。这单不整“可以考虑”“建议您”那套客套，上来就是干。',
  '咱们是肌肉集团，不是文书科——能一把梭的直接梭，干完再回头看哪儿不够硬。',
].join(String.fromCharCode(10)) + String.fromCharCode(10,10)/** 通用目标行（模型加码插在它之后）。 */
const MID = '目标是拿出去能镇住场子的效果：第一眼就得硬邦邦，细看还得站得住。做完自己先按验收点过一遍，别拿半成品糊弄。'
/** 越权反制行：**永远放最后**——强结果导向最大的副作用就是「懒得问、自己定了」。 */
const BOUNDARY = '低风险的小细节你自己拍板，别来回问；但用户没拍板的大事（联网、加功能、改交付形态）不准替他定——性情归性情，边界不能糊。'
/**
 * 加码的自保长度。**这不是风格限制**，是跑飞保护：
 * 用户明确要求长度由模型自定（不设句数/字数上限），所以这里只挡病态长度。
 * 超限即整段不采用、退回纯骨架——**绝不截断**（截断会产出半句话，比没有更糟）。
 */
export const HARD_NOTE_MAX = 1200

/** 归一化加码：去首尾空白、折叠连续空行；空或超限返回空串（＝不采用）。 */
export function normalizeHardNote(note) {
  const s = String(note == null ? '' : note).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!s) return ''
  if (s.length > HARD_NOTE_MAX) return ''
  return s
}

/**
 * 取某档基调要注入的文本。`neutral` 返回空串（＝什么都不加）。
 * @param framing 'neutral' | 'hard'
 * @param note    模型生成的加码（可选；空或超限即退回纯骨架）
 */
export function framingBlock(framing, note,language) {
  if(language==='en'){
    if(String(framing)!=='hard')return ''
    // 英文版与中文同款语域（2026-10-23）：称呼、催促、直白命令式都要落在英文里，
    // 不能退化成“be direct and task-specific”这种公文式描述——那样等于把效果来源扔掉。
    return [
      '[Straight-talk mode · plugin-added, not a new user requirement]',
      'Alright lads, clock\'s ticking, so no dawdling. Skip the "you may want to consider" and "it is recommended" nonsense — just build the thing.',
      'We\'re a muscle crew, not a paperwork department: if a call is cheap and reversible, make it and keep moving; come back later and check whether it\'s actually tough enough.',
      'The goal is something that holds up when someone looks twice: nails it on the first glance, still stands up under inspection. Run your own acceptance pass before you hand it over — no half-finished hand-offs.',
      'Small low-risk details: your call, don\'t bounce them back. Anything the user hasn\'t approved — network access, new features, changing the delivery format — is off-limits. Keep the attitude, keep the line.',
    ].join(String.fromCharCode(10))
  }
  if (String(framing) !== 'hard') return ''
  // 加码不再塞进基调块：它由 compiler 放在**整段注入文的最后**（用户 2026-10-23 指定位置），
  // 这样越权反制行仍在基调块末尾，加码也不会把它顶掉。
  return [OPEN, MID, BOUNDARY].join('\n')
}
/**
 * 硬邦邦基调下的**骨架文案**：节标题与包头整段换一种口吻，
 * 而不是只往开头塞一段话（用户 2026-10-23：要的是“真正的风格不同”）。
 * neutral 返回 null，调用方继续用默认文案。
 */
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

/** 交给优化器的口吻要求：让**生成的条目本身**也用这种风格写，而不是只改外壳。 */
export function framingToneHint(framing, language = "zh") {
  if (String(framing) !== "hard") return ""
  return language === "en"
    ? "Write every suggestion in a direct, imperative register: no 'you may consider', no hedging, no polite padding. Say what to do and how to verify it."
    : "每条建议都用直接、命令式的中文写：不要“建议/可以考虑/或许/不妨”，少客套，直接说要做什么、怎么验。"
}

/**
 * 把基调应用到**真实注入路径**（0.9 的优化器包，不是 0.6 的编译器包）。
 *
 * 2026-10-23 实测：用户开着硬邦邦，注入文却还是中性——因为 0.9 的注入文由
 * `renderOptimizerPacket` 生成，**根本不经过 compiler**，framing 只作用在遗留路径上。
 * 这里做一次纯文本换装：前言、两个小节标题换成硬邦邦口吻，并在最前加基调块。
 * 只改“壳”，不改建议内容与顺序；neutral 原样返回。
 */
export function applyFramingToPacket(text, framing, language = "zh") {
  const src = String(text == null ? "" : text)
  if (!src.trim()) return src
  if (String(framing) !== "hard") return src
  const en = language === "en"
  let out = src
  if (en) {
    out = out.replace("Give these goal-focused suggestions priority consideration and judge them against the actual task.", "Alright — here is what actually moves the needle this round. Judge it against the task and pick your own means.")
    out = out.split("[Production suggestions]").join("[What to build]")
    out = out.split("[Temporary scaffold suggestions]").join("[Scaffold to rig up yourself]")
  } else {
    out = out.replace("请优先考虑以下围绕目标提炼的重点建议，并结合实际判断取舍。", "老规矩：下面是这一轮真正能拉开差距的方向，你自己拿主意、按实际情况取舍。")
    out = out.split("【制作建议】").join("【要干的事】")
    out = out.split("【临时脚手架建议】").join("【自己搭的临时脚手架】")
  }
  const block = framingBlock("hard", null, language)
  // 去重：编译器那条遗留路径自己也会加基调块，这里再加就会**重复两遍**（真机截图可见）。
  // 判据用块的首行（中英各一），命中就不再前置。
  const marker = String(block).split(String.fromCharCode(10))[0]
  if (marker && out.includes(marker)) return out
  // 基调块自身已以换行结尾时只补一个换行，避免出现两行空行（真机截图可见）。
  const nl = String.fromCharCode(10)
  const glue = block.endsWith(nl) ? nl : nl + nl
  return block ? block + glue + out : out
}

/**
 * 这段文本里有没有**真正的条目**（以 “- ” 或 “1. ” 开头的行）。
 *
 * 2026-10-25 真机：优化跑了很久，最后注入的只有 250 字的壳（包头 + 基调块），
 * 说明“包非空”并不等于“有内容”——空条目也会让长度非零。判据要落到条目行上。
 */
export function hasPayloadLines(text) {
  const s = String(text == null ? "" : text)
  if (!s.trim()) return false
  return /^\s*(?:[-*]\s+\S|\d+[.、]\s+\S)/m.test(s)
}

/**
 * 编译器在“什么都没提取到”时会写一条占位说明：
 *   【没定的事（别替我拍板）】
 *   - 这一轮没有从中提取到可执行内容（…）
 * 它**长得像条目**（以 “- ” 开头），会把“有没有内容”的判据骗过去（2026-10-25 真机）。
 * 这里整段剥掉；该节若还有真实未决项，不会被误删。
 */
export function stripPlaceholderNotice(text) {
  return String(text == null ? "" : text)
    .replace(/【[^】]*没定的事[^】]*】[ \t]*\n-\s*这一轮没有从中提取到可执行内容[^\n]*\n?/g, "")
    .trim()
}
