# 文档索引（先读这个）

**许愿特化器**在发送前补充制作、临时脚手架与必要提问的方向建议。建议供工作模型优先考虑，不增加用户要求或授权。原话始终保留为来源；英文模式开启时，实际发送的任务可使用忠实英文译文，跳过则发送原话。

## 优化生产的主契约

先读 [OPTIMIZATION-PIPELINE.md](OPTIMIZATION-PIPELINE.md)：运行身份、规范化、渲染、终态、保存与提交的唯一主契约。**整体简化已实现并通过自动回归**；本机加载版本与接口已核对，真实用户的新会话操作仍按现场行为复测，不把接口探针当作用户验收。其他文档涉及优化生产时，以主契约为准。

| 文档 | 用途 |
| --- | --- |
| [SPEC.md](SPEC.md) | 产品目标、档位与来源边界 |
| [OPTIMIZER-PROTOCOL.md](OPTIMIZER-PROTOCOL.md) | v3 输出形状与规范化规则 |
| [DELIVERY.md](DELIVERY.md) | 审查、发送、跳过、取消与卡片 |
| [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | 故障证据、未闭环回归与验证状态 |
| [SCAFFOLD-DIRECTIONS.md](SCAFFOLD-DIRECTIONS.md) | 脚手架建议的六问与反例 |
| [DECISIONS.md](DECISIONS.md) | 关键取舍及历史理由 |
| [EVIDENCE.md](EVIDENCE.md) / [EVAL-REGISTRY.md](EVAL-REGISTRY.md) | 证据与评测登记；按所测版本解读 |
| [MIGRATION-TO-ANOTHER-MACHINE.md](MIGRATION-TO-ANOTHER-MACHINE.md) | 换机与重装 |
| [DSH-COMPAT.md](DSH-COMPAT.md) / [DSH-0.2-COMPAT.md](DSH-0.2-COMPAT.md) | 宿主兼容边界 |
| [../po06/README.md](../po06/README.md) | 用户说明与实测效果 |
| [../po06/ADVISOR.md](../po06/ADVISOR.md) | 顾问用法与边界 |
| [../po06/RELEASE-CHECKLIST.md](../po06/RELEASE-CHECKLIST.md) | 发版门 |

## 实测数据（2026-10，0.9.0-beta-1）

| 文档 | 内容 |
| --- | --- |
| [../po06/eval/BENCH-TOTAL-0.9.0-beta-1.md](../po06/eval/BENCH-TOTAL-0.9.0-beta-1.md) | 四维总账：许愿型 / 修 bug / 精准规格 / 复杂项目 |
| [../po06/eval/BENCH-D1-0.9.0-beta-1.md](../po06/eval/BENCH-D1-0.9.0-beta-1.md) | 许愿型专项 8 条（双评） |
| [../po06/eval/BENCH-AB-0.9.0-beta-1.md](../po06/eval/BENCH-AB-0.9.0-beta-1.md) | 最早的端到端 A/B |
| [../po06/eval/BENCH-0.9.0-beta-1.md](../po06/eval/BENCH-0.9.0-beta-1.md) | 结构指标（协议/预算/无编造） |

复现：`node po06/scripts/bench-dims.mjs`（带双评与缓存，可中断续跑）。

## 历史与验证

[legacy/README.md](legacy/README.md) 所列计划、验收和实验仅作历史证据；更早发布物见 [old/README.md](../old/README.md)。旧 reducer/compiler、补占位或取用时换基调的行为不再是本次生产目标。

最短路径：[根 README](../README.md) → 本索引 → 主契约 → 所需专项文档。判断当前行为时，记录实际模块版本与运行结果；历史套件通过数和 benchmark 不替代本次流程验证。

本机 Flash 耗时与接口错配的现场复查见 [测量与修复记录](evidence/flash-latency-and-api-20261025.md)。

## 调试依据

| 现象 | 应核对的证据 |
| --- | --- |
| 修改后行为没变 | 实际加载的模块版本、路由与运行行为；不能一概归因为“宿主代码必须重启”或“新分支不能热更新” |
| 客户端修改未显示 | 构建/watch 是否确实产出并加载了新 bundle；是否需要页面刷新由实际加载版本决定 |
| 只有外壳或卡片不一致 | 同一会话、同一 `runId` 的完整结果、终态与最终 packet；非零字符数不证明正文有效 |
| 切走会话后结果丢失 | 发起会话的完整结果保存与恢复，以及提交使用的 `runId`；不以当前页面会话代替来源会话 |
