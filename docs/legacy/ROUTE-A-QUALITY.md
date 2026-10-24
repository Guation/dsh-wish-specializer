# 路线 A：单轮能力增强（开发版）

> 当前本地候选 **advisor-loop-1**：在第305轮历史基底上实现引用关联证据、已观察前版比较与逐轮交付状态，修复当前SDK原生回灌。实际试验含原始格式失败及后验探索，不能声称通用收益。见 [实施结果](ADVISOR-LOOP-RESULTS.md) 和 [计划](PLAN-ADVISOR-LOOP.md)；原运行实例仍为round305-baseline-1。

目标是同一弱模型的产物能力放大，而不只是提示词变长。当前实现已接通，**尚未实测证明弱模型超过强模型**；版本号不变，不发布 0.8.4。

## 本次实现

- 优化器保持 v3 的 intent/clarify/add/ask，提示词修订标记为 route-a-2。轻度仍重澄清，标准/重度更主动贡献关键规律、构造、方法与可采用内容，不规定条数、字数或通用章节。
- develop_approach：方案锁定前独立提供具体解法，检查关键前提与反例；不先顺着执行者自评背书。
- improve_result：面对实际产物贡献质量提升，不只找必须修复的错误；有实质改进时 suggestion，没有值得变动的增益时 keep。缺材料则无法形成当前产物判断。
- 两种贡献允许结合相关文本、源码与图像；授权与图像能力限制不变。review_result 的材料隔离、证据规则和阶段通过判据不变。
- 质量建议不写验收覆盖、不登记阶段通过、不关闭旧缺陷。suggestion 表示有具体建议，不表示质量已经提高；keep 只适用于已看范围，不表示全局最优。
- 中英文贡献协议均为内置原生文本，不额外调用翻译模型。模型路由沿用优化 AI 配置，没有强模型兜底。

## 第二轮：通用提升与低开销协作

- 优化器将具体贡献整合成互相支持的可执行路径：优先关系、必要依赖、前提与换路条件。标准/重度更注重整合，轻度仍以澄清表达为主；不加入行业模板、配额或固定循环。
- 同一次优化可选输出 consult:{mode,focus,reason}，只标识未解决瓶颈的独立推导机会。缺省就是不推荐咨询；错误的可选字段只丢掉该机会，不丢正常辅助。它是建议，宿主不自动派生模型调用、不开新调度模型，也不新增授权。
- develop_approach 和 improve_result 先从原任务与事实独立形成办法，再比较执行者候选，尽量直接给能采用的局部内容。重复的任务理解不再随 taskContext 再注入一次；候选假设与原任务分开。
- improve_result 可选 previousResult（前版正文R1）与 currentResult（当前正文R0）作比较；每项接收上限48000字符，两版共同复用16000字符的发送预算，截断透明。可以发现退化、保留更好的旧内容或撤回无增益改动；仅看过前版不能对当前产物作质量判断。
- 贡献用途默认历史预算由48000降为14000字符，优先按显式证据编号/材料路径选取，未指定时仅保留实际工具结果；验收用途的范围与预算不变。
- 已形成的顾问贡献只留一份简短本轮状态，提醒先落实、再用已有证据作最小比较。它不重复注入整份顾问报告，不代表已经采纳或变好；新输入会清掉，迟到结果不进入下一轮，未持久化成用户要求。不阻止有新证据的再次咨询。
- 中英文同步采用这些机制；改善质量的目标不是修平语言差距。模型路由、思考档位、工具权限与个人设置不被本次实现覆盖。

~~~js
const r = await tools.consult_task({
  mode: "improve_result",
  scope: "general",
  focus: "同一目标下当前产物的关键提升与可能退化",
  question: "贡献可直接采用的局部内容，对照实际新旧版本说明收益与代价；无实质收益就保留更好的版本。",
  currentResult: "实际当前正文",
  previousResult: "实际前版正文（可选）"
});
console.log(r);
~~~

咨询仍由工作模型依据具体对象和预期增益决定，并非每轮必须调用。代码接线验证不证明实际调用率、质量收益或成本下降。需要连续的同模型、同材料实测来判断。

## 稳定骨架更新：临时盲区与有效材料

当前实现复用现有优化与顾问调用，不开启实验性多候选、循环推理或自动自评。

- 原目标、最新纠正与实际材料独立传递；长来源/正文保留头尾与截断说明，减少最新限制被截掉的风险。
- 工具历史按显式证据、结构化路径及原调用/结果关联选择，未知旧日志不默认代表当前版本。预算不增大，必要材料缺口如实标记。
- 顾问按当前任务临时寻找focus之外、与原目标直接相关的关键遗漏/增益，区分观察、待核假设和建议；输出可采用局部内容，不套固定领域评分表。
- 文件/图像可标role=current/previous/context；只有实际当前材料可以支持当前产物判断。当前与前版正文仍共享16000字符发送预算。
- 建议带contributionBasis说明对应材料/范围。相关材料或用户输入在调用过程中变化时，旧观察保留，stale或basisState会提示需重看；improvementAvailable/solutionAvailable/retainCurrent均不再冒充当前可用。
- 已形成建议后的当前轮提醒也会随相关write/edit结果更新适用性。新输入重置它，迟到报告不影响下一轮；没有新事实不自动咨询。

文件/图像调用示例（路径相对任务工作区，读取须在授权范围内）：

~~~js
const r = await tools.consult_task({
  mode: "improve_result",
  scope: "general",
  focus: "当前产物与原目标的关键差距和提升空间",
  question: "先独立分析实际产物，找决定结果的遗漏关系或正向机会，给能直接采用的局部内容与收益依据。未证实的前提标待核，没有增益保留当前。",
  files: [
    { path: "result.txt", role: "current", purpose: "实际当前成果" },
    { path: "result-before.txt", role: "previous", purpose: "前一版（可选）" },
    { path: "context.txt", role: "context", purpose: "相关原始材料（可选）" }
  ]
});
console.log(r);
~~~

以上只是可替换的调用示例，不要求任务创建这些文件，也不要求固定调用次数。旧接口省略role时文件默认current，reference图片默认context；前版/背景不能替代当前成果。

本轮必要定向回归：18份文件，node --test汇总 **163通过、0失败**，稳定质量集20项；没有真实模型调用。它证明接线与版本边界，不证明产物变强。独立专项顾问返回assist-off，未取得独立通过结论。

## 生效与设置

1. 重启正在运行的 DSH，并刷新原 Web GUI，让后端工具枚举及客户端同步更新。本机未安装热重载注入器。
2. 主模型和优化模型都选择同一个弱模型，例如 DeepSeek Flash；思考档位和工具权限在对照组间保持一致。插件不会替你覆盖个人配置。
3. 启用提示词辅助，优先对照标准与重度档；为隔离本次改动，第一轮可保持原有实验性推理增强关闭。
4. 详情/API 的 prompt.effective.revision 应是 contribution-selection-2；实际发起优化后，lastRequest.promptRevision 也应是 contribution-selection-2。只看预览不能证明实际请求已使用。
5. consult_task 的 mode 枚举应包含 improve_result。新用途是工作模型按任务调用的工具，不是保证每轮自动调用两遍的新流水线。

已知旧内置核心通过精确哈希读取为新默认，旧文件原样保留；真正修改过的自定义核心不被覆盖。若你使用自定义核心，希望采用新版，可在详情恢复内置。

## 调用示例（PTC）

以下供重启后、已更新工具枚举的工作模型使用。问题和材料必须对应实际任务，示例不要求你使用固定调用次数。

### 在关键选择前取得解题贡献

~~~js
const r = await tools.consult_task({
  mode: "develop_approach",
  scope: "general",
  focus: "当前任务最影响最终产物的结构性选择",
  question: "从原始目标和现有事实独立推导，贡献可直接采用的方法或内容。说明为何有增益以及关键前提，不只给通用提醒。"
});
console.log(r);
~~~

### 用实际正文取得质量提升

~~~js
const r = await tools.consult_task({
  mode: "improve_result",
  scope: "general",
  focus: "当前产物最限制质量的部分",
  question: "基于实际产物，给出可落实且有实质收益的改善，尽可能贡献替换内容或具体做法；没有真实增益则保留当前。",
  currentResult: "这里替换为当前实际产物正文，不是‘已经很好’的自评。"
});
console.log(r);
~~~

文件/画面产物改用 files/images，路径相对任务工作目录，注明用途。需启用授权只读；只有模型声明支持图像且图像实际发送，顾问才可观察。源码不能证明渲染质量，截图不能证明完整交互或性能。

返回的 improvementAvailable 表示完整的具体建议已形成，不是已验证变好；retainCurrent 表示完整且材料范围足够的 keep。超时、被取消或材料截断不能冒充完整结论。两种贡献都不会获得 reviewPassed 或 completionClaimAllowed。

## 最小工程回归（无真实模型调用）

从仓库根运行；所有模型流均为本地测试替身：

~~~powershell
$env:TEMP = "$env:USERPROFILE\.dsh\tmp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
node --test po06/test/advisor-language.test.mjs po06/test/advisor-tool-language.test.mjs po06/test/english-multiturn.test.mjs po06/test/advisor-invocation.test.mjs po06/test/stable-quality.test.mjs po06/test/advisor-materials.test.mjs po06/test/read-tools.test.mjs po06/test/capability.test.mjs po06/test/route-a-efficiency.test.mjs po06/test/english-interpretation.test.mjs po06/test/english-mode.test.mjs po06/test/intercept-output-stream.test.mjs po06/test/quality-contribution.test.mjs po06/test/optimizer-protocol.test.mjs po06/test/adaptive-collaboration.test.mjs po06/test/advisor-scopes.test.mjs po06/test/advisor-workflow.test.mjs po06/test/advisor-stage-card.test.mjs po06/test/advisor-host-registration.test.mjs po06/test/advisor.test.mjs po06/test/advisor-result-contract.test.mjs po06/test/client-advisor-stream.test.mjs
~~~

当前上述 22 份定向测试文件，在提供宿主库解析基准时node --test汇总 **203通过、0失败、0跳过**，没有真实模型调用。它验证接线与回归，不是产物效果基准。

覆盖：新模式注册/执行/投影、同路由、正文和混合图文材料、假引用拒绝、keep、超时/截断、旧验收隔离、客户端组件渲染、短协议和默认/自定义核心兼容。不是全量回归，也不是质量跑分或真实 UI 操作验收。

## 你自行做的效果对照

同一原始任务、材料与权限，分别看弱模型裸跑、弱模型加本次插件、强模型裸跑；如要定位收益，再拆开仅优化器与加顾问。强模型不参与增强链路，评审优先人工盲评与客观运行结果。

建议少量跨类型真实任务，另留未参与调试的迁移题；重要结果重复运行，避免一次幸运输出被当稳定优势。记录最终产物、顾问贡献是否实际采用、收益/退化、耗时和真实用量。评分看产物，而不是字数、顾问自评或测试数量。

## 验证边界

本轮不处理 CI，不跑长时变异门，不作效果提升结论。独立 review_result 尝试返回 assist-off，因此没有独立顾问通过记录；没有调用真实模型。当前实现需重启 DSH 才会进入运行中的工具与提示词。
