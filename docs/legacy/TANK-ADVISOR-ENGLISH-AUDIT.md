# 英文顾问链路与坦克会话核验

当前开发修订：**advisor-english-1**。核验对象为html工作区会话“Three.js detailed tank HTML demo”（session-e07fe1cf-faa8-4977-8d3f-e0d8647ead69）。本轮修复已证实的英文内部链路问题，核对建议落实和疑似退步；没有把单个样本当版本退化定论，也未修改用户产物。

## 确定的语言问题

该会话实际运行english-multiturn-1，英文模式开启，校准后的英文协作指引已注入。提交给工作模型的是英文原任务，没有明确要求中文最终答复。两次实际顾问报告却是中文，最终答复也转为中文。

入口仍有中文锚点：consult_task/advisor_stage的SDK说明与参数注释是中文；review_result/diagnose_failure把中文系统模板交给翻译器，但JSON例值按字面量保护而留下中文；请求中的evidencePolicy/warning、非贡献专项说明、材料标签、验收横幅及若干宿主提示也为中文。没有发现“提问必须用中文”的硬规则，但这些锚点与中文提问/回包现象相符。不能据此断言其中任何一个是最终语言或产物质量变化的唯一原因。

用户明确了产品语义：保持英文协作链路，产物要中文就由用户原提示词要求，插件不自行添加答复语言政策。本次据此修复内部语言，不强制最终答复语言、不翻译模型最终答复。

## 已修复

- [英文工具解释与参数](../po06/lib/advisor-tool-language.js)：agent创建与系统提示组装前，按会话使用局部同名英文定义。只改解释词，API、执行、中文UI与中文会话保持原行为。执行时移除自身语言覆盖并按实际调用agent重查可见性，不能借语言覆盖扩大权限；模式切换和卸载清理覆盖。
- [原生英文顾问协议与正文边界](../po06/lib/advisor-language.js)：验收/诊断不再翻译中文模板，四种模式均明确使用英文机器正文；正常英文不增加翻译调用。
- 报告若仍返回非英文机器正文，仅对已知正文槽位作一次保真修复。已声明/既有criterion、checkId、status、verdict、evidenceRefs及代码/路径/数值不改。修复失败保留旧失败记录，不回传未经校验的中文指导或原始回包。
- [实际顾问链路](../po06/lib/advisor.js)、[专项说明](../po06/lib/advisor-scopes.js)及材料/来源标签补全英文宿主控制文字和横幅；原始用户引文与材料仍逐字保留，可合法含中文。
- requiredScopes/requiredReviews枚举排除运行时不接受的general/delivery，消除实际第一次调用的invalid-required-scopes。
- [现有短反馈](../po06/lib/advisor-context.js)增加失败、未验证、遗漏总数及scope/focus，明确参数修改或局部自测不会自动关闭失败项。不新增强制采纳表、自动循环或新的验收目标。
- 顾问按视觉观察提出建议时，区分可见现象与未读源码的因果/参数推测，不将猜测设置当已证实缺陷；中英文都保留该通用边界。

## 顾问反馈实际有没有被参考

从时序和实际修改看，顾问结果在工作模型修改前已送达，不属于投递晚于提交。最后一次appearance复核返回gaps，含6项failed、1项unverified。随后14次edit尝试中12次成功，改动对应炮管、迷彩、轮毂、焊缝、阴影和板片；还有重渲与read_image。因此“完全没参考”不成立，部分采纳有直接证据。

但问题仍在：没有后续独立复核确认六项失败闭合，也缺少对重要未采用意见的证据说明。最终称“已完成”“评审发现的4处真实缺陷已全部修掉”，并不能代表原报告全部失败项已解决。这里应核验的是重要发现是否改善实际成果、错误建议是否有据反驳，以及剩余缺口是否诚实保留；不是要求顾问全对、必须逐条采纳，或用采纳率/处置表数量评分。

该会话先把delivery当首次整体检查，第一调用被无效枚举拒绝，下一调用只有截断源码且图片被delivery范围排除，返回unverified；最后才单独appearance。未调用develop_approach或improve_result。这说明用途选择与反馈闭合仍不稳定，不应只因“顾问出现了”就认定协作有效。

后续注意事项已加入 [当前计划](PLAN-STABLE-QUALITY.md) 第10节。

## 是否更新后退步

| 可核对项 | 上一轮英文坦克会话 | 指定的新会话 |
| --- | --- | --- |
| 主模型/档位 | deepseek-account/deepseek-flash，max | 相同 |
| 从用户提交到turn/end | 约59.6分钟 | 约41.4分钟 |
| run_code调用 | 94 | 65 |
| 顾问 | 0 | 3次尝试，2次有报告，均review_result |
| 主要实现 | 约977KB，three.js内联 | 约99KB，four-CDN加载three.js |
| 最终截图 | 1600×900，远处三分之四构图 | 1474×720，近景，机位/光照不同 |

新最终画面确有明显层叠板片、前部空隙和偏平的块面观感，值得排查；旧图也有暗部细节/构图限制。两张图不能做严格质量排序：不是同一个初稿、同机位、同光照或同环境的A/B。文件体积、时长、三角形数和调用数也不等同于质量。

没有证明版本导致稳定退化，不回滚、不把该坦克的改法写进通用协议。确定的过程缺口是语言混入、顾问用途选择、反馈闭合以及交付声明比证据更强。新最终说明一边说“零外部资源”，一边列CDN依赖，也有事实表达不一致；原任务未明确要求离线，这不能自动变成新的离线验收目标。

## 验证与边界

22份相关离线文件：**203通过、0失败、0跳过**。包括新增15项顾问语言回归、9项工具语言测试；实际本机TypeScript SDK与Cordis ToolRuntime都验证了英文局部定义、原执行与动态权限拒绝。

所有真实模型验证均为deepseek-official/deepseek-flash：

- 新原生英文诊断面对中文问题及明确要求中文最终产物的原任务，仍返回英文报告/横幅；约4.8秒，无语言修复调用。
- 捕获的旧中文报告作保真修复时，有一次模型回复不能作为JSON解析；再一次只查该问题时发生transport错误、未给用量。两次都安全拒绝，未把中文报告或改变的失败状态交回。不声称这一真实旧报告已经修复成功。
- 独立源码复核未发现提供范围内的具体正确性问题，但部分端到端结论标unverified；没有正式验收通过。已确认的真实宿主权限/SDK行为由本机回归另外提供，不为形式性放行重复模型咨询。
- 本轮已报告模型用量126465 token，含最初被引用校验拒绝的develop_approach、原生语言验证和一次源码复核；transport失败未报告用量，不猜零费用。未再跑整套坦克生成或质量跑分。

完整结构化证据见 [核验数据](evidence/TANK-ADVISOR-ENGLISH-AUDIT.json)。本机原始记录在：

~~~text
.po06-tmp/tank-language-investigation-session.json
.po06-tmp/tank-language-investigation-audit.json
.po06-tmp/advisor-english-regression.log
.po06-tmp/advisor-tool-language-sdk.log
.po06-tmp/advisor-english-flash-verification.json
.po06-tmp/advisor-english-report-repair.json
.po06-tmp/advisor-english-code-review.json
~~~

运行实例加载状态另行核对。重启DSH并刷新现有GUI后应看到prompt.effective.revision=advisor-english-1；实际新会话应看到英文consult_task/advisor_stage解释、英文顾问正文和英文机器反馈。原用户引用/代码/检查身份中的中文与中文界面标签可以保留。

后续保留跨任务观察，不加固定调用数量；重点看重要建议的实际采用/有据反驳与结果，而不是又多调用几次。没有CI、Release或用户模型配置变更。
