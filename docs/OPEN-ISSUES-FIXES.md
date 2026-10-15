# 开放 issue 分析与修复（2026-10-13）

对象：WestFox-AwA/dsh-prompt-optimizer 的 4 个开放 issue。本轮在本地开发树修复其中 3 个可复现的代码缺陷；第 4 个经核对不是本仓库的打包缺陷，记录了实际成因与用户侧处置建议。

**重要：本轮改动仍在本地，未提交、未推送、未发布。** issue 里报的位置都是 0.8.3-stable（Release 附件），修复要到用户手里必须走提交 + 发布；是否发布由你决定。

## #32 顾问无法接受文件输入 —— 已修

**报告的现象**：readTools 为 false 时只要 consult_task 带 files/artifacts，整次调用必失败 advisor-invalid-citation；顾问其实写了一份**正确**的报告，如实说「F0 读不到」，却因为没有合法引用编号被宿主拒收。

**根因**（与报告一致）：po06/lib/advisor-materials.js 里 fail() 路径只 evidence.push(...)，从不 evidenceIds.add(row.id)。于是「材料读不到」这个事实无法被引用，引用校验把整份报告判为伪引用。

**修复**：fail() 现在同时登记 evidenceIds，**但不登记 resultIds**。这条分界线是关键：

- evidenceIds = 这次调用提到了这条材料，顾问可以引用它的状态
- resultIds = 真的读到了内容，可以支持 satisfied

所以顾问现在能如实写「F0 状态 unavailable」，而**不能**用未读取的材料支撑「成果已通过」。回归钉住了两种情况：引用不可用材料 + verdict 为 unverified 通过；引用不可用材料 + check 为 satisfied 仍拒收 advisor-invalid-check。

**顺带修的第二处**（报告未提，实测发现）：只读工具开着但首次工具回复**空文本**时，旧逻辑直接返回 advisor-empty-output，顾问连一次不带工具的回答都拿不到。现在在**同一路由、同一预算、同一信号**下补一次无工具补全，且仅限「未执行任何证据工具 + 无流错误 + 未取消」；已经跑过工具则不重试（那是真没结论，不该再烧一次调用）。用量把两次调用相加记账。

**还修了诊断口径**：/po06/api/advisor-stage-status 以前用 readEnabled:false 探针，会让界面把「已配置只读」显示成关闭；现在区分 readToolsConfigured（配置真值）与 verification 为 recorded-only-no-file-reread（本次只读记录、未重读文件校验版本），既不假装权限关闭，也不假装已经重新校验过文件。

## #31 解析被拒时兜底不生效 —— 已修

**报告的现象**：BAD_JSON / BAD_OPTIMIZER_SHAPE 让整轮变成 parse-rejected → 空包 → 界面 no-packet；12 次实测的 trace 里 retryEmpty / fallbackEmpty 一次都没出现。报告指出根因在 emptyResultReason：只有 NO_JSON 返回非空，「吐坏了」返回 null，两级兜底被整体跳过。

**根因确认**，并按报告口径修复：NO_JSON、BAD_JSON、BAD_OPTIMIZER_SHAPE、BAD_SHAPE 现在都进入同一套「一次有界重试 + 机器通知兜底」。重试会带上失败原因（新增 parse-rejected:<code> | <reason>），兜底条目仍然只是**关于这轮原话本身**的待确认项（unknown、不 blocksAction），不替用户发明要求。

**同时补了三个边界**，否则「有兜底」会变成新的问题源：

- **用户已改口 / 已取消**：重试前和兜底前都重新检查输入版本与 abort 信号，晚到的恢复结果不能覆盖新输入，也不再产生包。
- **英文模式**：兜底通知以前只有中文模板，会污染英文链路。现在按语言给英文纯宿主文本，且**不**添加任何答复语言政策（用户要中文就由原提示词说）。
- **合法零增量仍不重试**：模型正确返回空 add 且无 ops 时走 understood，不进重试、不假装缺内容。

**关于 extractJson 取错范围**（issue #31 评论）：本机开发树在早前的英文修复里**已经**加了配对括号扫描（extractBalancedObject），「多吐一个右花括号」的形态能取回第一个完整对象，不需要再补。它有个必须说清的代价：配对取回**只读第一个完整对象**，模型写在多余右花括号之后的内容（评论那两例是 add/ask 两段）不会进这一轮的包。以前这件事没有任何痕迹，现在解析成功时会带一条警告进台账：

    json recovered by balanced scan: only the first complete object was read; later text was not parsed

这样「看着成了、其实少了一条」能被查出来，而不是靠人去猜。回归同时钉住：干净 JSON 不产生该警告、各段齐全。

**台账可搜性**（报告里「grep no-packet 恒为 0」的反馈）：记账以前写死 ok 为 true，最终 reason 在记账之后才拼出来、只进 HTTP 响应体。现在收尾时补一条 intercept-result 记录，带 ok / reason / outcome / packetChars，并让优化器那次记账用真实判据（合法零增量与用户取消不算失败）。

## #30 落账 invalid-stage-material + 失败卡片丢弃产出 —— 已修

**报告的现象**：顾问分段读同一个源文件（实测 11 行痕迹、5 段同文件），材料行数超过 8 条上限 → recordReview 拒收 invalid-stage-material → 已通过的判定丢在落账前。另一处是失败卡片只认固定 note，把 partialReasoning / activities / raw 三类真实产出丢掉，还把「已保留部分内容」这个标题给了 note。

**根因确认**：traceReadMaterials 的去重键是 path + sha256 + startLine + endLine（按区间），而阶段台账的 8 条上限只认**文件版本**。任何分段读代码的复核都必然超限。

**修复**（比报告附的 patch 更保守，逐条说明取舍）：

- 新增 po06/lib/advisor-read-materials.js，按 **path + sha256** 归并成一行，并保留 readRanges 记录实际读过哪些区间。
- **不同 sha256 不合并**：同一路径的两个版本仍是两行，避免「改过之后新材料被旧行吞掉」。
- **区间缺口如实披露**：合并多段后 selectionScope 标为 multiple-line-ranges，并删掉会误导的单段起止行；wholeFileComplete 只在所有段都完整时为真。
- **截断保留**：任一段截断，合并行保持 truncated 与 selectionComplete 为 false。
- **只读痕迹与显式材料一起归并**，避免同一版本在材料表里出现两次。
- 真正超过 8 个**版本**时仍然明确拒绝 stage-material-limit（回归钉住了这一条），而不是静默丢掉材料。
- 顺手修了校验顺序：先判条数上限、再判字段合法性，报错原因才能指向真正的限制。

失败卡片按报告口径修复，并往前多走一步：

- presentationMeta 投影 partialReasoning（字符串守卫）与 activities（字符串化 + 保留最后 8 条），加上原有的 raw。
- presentResult 失败分支把三类产出写进卡片正文；「已保留部分内容」标题**只由三类真实产出决定**，note / reason 不计入。
- 前端组件里这些内容原来是挂在「验收结果」折叠区**内部**的——没有验收项时整块不渲染，等于真实产出照样看不到。现在思考尾部 / 查证记录 / 未通过校验的原始输出是**独立折叠块**，与验收面板无关。
- 「保留部分内容」这个状态标签也改为按真实内容判定：只有 note 的空超时显示「未形成完整答复」，不再假装有部分产出。

## #29 安装失败「打包不完整」 —— 不是本仓库的打包缺陷

**报告里的核心错误**：

    [ERROR] Command failed with exit code 128: git ls-remote "https://github.com/westfox-awa/dsh-prompt-optimizer.git" HEAD "HEAD^{}"
    fatal: unable to access ...: schannel: next InitializeSecurityContext failed: SEC_E_INVALID_TOKEN (0x80090308)

失败发生在 git ls-remote，是 **Windows schannel 的 TLS 握手失败**，在拿到仓库内容、跑任何构建之前就结束了。hub 自动生成的摘要写成 prepare/build script failed，属于误归因。

**本仓库这一侧的核对**：package.json **没有 scripts / prepare 字段**（grep 结果为空），files 直接把已提交的 po06/lib、po06/runtime 等纯 JS 与文档列进去，private 为 true、只发 Release 附件。也就是说**这款插件不需要构建步骤**：git 能取到仓库就装得上，没有「prepare 失败」这条路径可走。

所以：

- **插件侧无可修**。真要改，是 hub 的失败归因（把网络错误写成打包失败）——不在本仓库。
- **用户侧处置**：那台机器的 schannel 无法完成到 GitHub 的 TLS（企业代理/证书/网关常见）。可行方向是换能通过 TLS 的网络、把 git 的 SSL 后端从 schannel 换成 openssl、或先手动 clone 再用本地路径安装。
- 错误尾部那句 pnpm 提示（allowBuilds）**只对带 prepare 脚本的包成立**，对本仓库不适用，可以忽略。

## 验证

全部为离线夹具，无真实模型调用。本轮新回归文件 po06/test/open-issues.test.mjs 共 17 项；连同 pipeline、advisor-stages、stage-card、stage-status 等既有文件，合计 **249 通过 / 0 失败**。

覆盖的关键点：不可用材料可引用但**不可**支持通过；空工具回复只补一次且已跑过工具/出错/取消时不补；坏 JSON 与坏形状各重试一次；合法零增量不重试；英文兜底不含中文、不加答复语言政策；重试期间新输入不被覆盖；配对取回留痕且后续段落不被当成已解析；同版本多区间归并、不同版本不合并、真实超 8 版本仍拒绝；失败卡片投影与前端展示都带真实产出。

日志：.po06-tmp/open-issues-regression.log。

## 剩余限制

- 三个修复都**没有**在报告者的环境（Linux web profile / Windows desktop profile、0.8.3-stable）上复跑；这里是开发树 + 离线夹具 + 本机宿主 SDK/作用域验证。
- 本轮**未**提交、未推送、未发布，也未在 GitHub issue 下回复；用户手上的 0.8.3-stable 不会因此改变。
- #29 只做了归因与文档；本机无法复现那台机器的 schannel 故障。
- #30 报告里提到的「全局 assist 关闭使无覆盖会话 40ms 被拒」保持原样：那是配置层预期行为，本次只让它更容易被看懂（状态接口区分配置真值与记录态），没有改档位语义。
