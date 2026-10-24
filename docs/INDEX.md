# 文档索引（先读这个）

> 目标：让任何人（尤其是 AI 助手）在**十分钟内**建立对这个插件的正确认识，且不会被历史文档误导。

## 一句话

**许愿特化器**：用户说愿望，插件在发送前用另一个模型补上三段方向建议（制作 / 临时脚手架 / Ask），
原话一字不改地发出去；建议是“值得优先考虑”，不是硬性要求。

## 现行契约（当作事实读）

| 文档 | 说明 |
| --- | --- |
| [OVERVIEW.md](OVERVIEW.md) | 当前状态总入口：能力、边界、已知问题 |
| [SPEC.md](SPEC.md) | 行为规格（协议、拦截、注入、预算） |
| [OPTIMIZER-PROTOCOL.md](OPTIMIZER-PROTOCOL.md) | 三段输出的协议与解析规则 |
| [SCAFFOLD-DIRECTIONS.md](SCAFFOLD-DIRECTIONS.md) | 脚手架建议的判据（六问）与反例 |
| [DECISIONS.md](DECISIONS.md) | 关键取舍与理由（含被否决的方案） |
| [EVIDENCE.md](EVIDENCE.md) | 证据清单（EV 编号）与验证方式 |
| [EVAL-REGISTRY.md](EVAL-REGISTRY.md) | 评测登记：跑过什么、结论是什么 |
| [DELIVERY.md](DELIVERY.md) | 交付面（注入、卡片、审查面板）的现行行为 |
| [MIGRATION-TO-ANOTHER-MACHINE.md](MIGRATION-TO-ANOTHER-MACHINE.md) | 换机/重装时的迁移步骤 |
| [DSH-COMPAT.md](DSH-COMPAT.md) / [DSH-0.2-COMPAT.md](DSH-0.2-COMPAT.md) | 与宿主版本的兼容边界 |
| [../po06/README.md](../po06/README.md) | 面向用户的能力说明 + **实测效果**（跑分结论与局限） |
| [../po06/ADVISOR.md](../po06/ADVISOR.md) | 顾问（consult_task）的用法与边界 |
| [../po06/RELEASE-CHECKLIST.md](../po06/RELEASE-CHECKLIST.md) | 发版门 |

## 实测数据（2026-10，0.9.0-beta-1）

| 文档 | 内容 |
| --- | --- |
| [../po06/eval/BENCH-TOTAL-0.9.0-beta-1.md](../po06/eval/BENCH-TOTAL-0.9.0-beta-1.md) | 四维总账：许愿型 / 修 bug / 精准规格 / 复杂项目 |
| [../po06/eval/BENCH-D1-0.9.0-beta-1.md](../po06/eval/BENCH-D1-0.9.0-beta-1.md) | 许愿型专项 8 条（双评） |
| [../po06/eval/BENCH-AB-0.9.0-beta-1.md](../po06/eval/BENCH-AB-0.9.0-beta-1.md) | 最早的端到端 A/B |
| [../po06/eval/BENCH-0.9.0-beta-1.md](../po06/eval/BENCH-0.9.0-beta-1.md) | 结构指标（协议/预算/无编造） |

复现：`node po06/scripts/bench-dims.mjs`（带双评与缓存，可中断续跑）。

## 历史文档（**不要当契约读**）

`docs/legacy/` 里是 0.5–0.8 的计划、验收与实验记录；更早的 0.1–0.6 发布物在仓库根的 [`old/`](../old/README.md)。它们在当时成立，现在可能完全相反
（例如工具箱计划已被撤掉、注入协议已经换到第三版）。规则见 [legacy/README.md](legacy/README.md)。

## AI 读者的最短路径

1. 读 root `README.md` 了解产品形态 → 2. 读本索引 → 3. 只打开「现行契约」表里的文件 →
4. 需要判断“现在到底行不行”时，跑 `po06/scripts/run-suites.mjs` 与 `bench-dims.mjs`，不要引用历史结论。
