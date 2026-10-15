# 实验推理低延迟候选

状态：本地分支 `experiment/reasoning-latency-1`，未合并、未发布。发布版 `v0.8.4-stable` 的 main/tag 不改。

## 为什么要改

用户反馈择优与循环推理严重拖慢开发。实际 DeepSeek Flash trace 也支持这个判断：

- `hybrid / candidates=3 / rounds=3`：8 次运行、81 次调用、约 563 万 tokens；运行中位数 442.6 秒，P90 737 秒，最大 1052.7 秒。候选阶段并发宽度中位数只有 1.09，平均 1.33，不能假设候选真正并行。
- `hybrid / candidates=2 / rounds=2 / fast`：77 次运行、362 次调用；运行中位数 24.5 秒，P90 111.2 秒，最大 252.8 秒。
- `loop / candidates=2 / rounds=3 / balanced`：26 次运行、79 次调用；运行中位数 37.1 秒，P90 192.6 秒，最大 488.3 秒；并发宽度为 1。

所以主要杠杆是串行轮数与调用形状，不是继续加长提示或换更强模型。

## 当前候选的计划

`reasoningPlan` 把请求设置转换成可观察的 effective plan：

| 档位 | parallel | loop | hybrid |
|---|---|---|---|
| `fast` | 候选 + 一次择优 | 1 候选，最多 1 轮 | 候选 + 一次择优 |
| `balanced` | 候选 + 一次择优 | 最多 1 轮 | 最多 1 轮修订 |
| `inherit` | 按请求执行 | 按请求执行 | 按请求执行 |

计划还计算 `maxCalls`、`capReason`。运行时 guard 计数每一次实验调用；超过计划不会继续静默发模型调用，而是进入既有 fallback。trace 记录 `callsUsed` 与 `status`，客户端显示 requested/effective 计划。

这使默认开启体验保持短：`fast hybrid + 2 candidates` 的上限是 3 次实验调用；显式高成本仍可用 `inherit`，但用户能看到它是真正的高成本选择。实验关闭时路径完全绕过 boost。

## 质量边界

- 原始候选仍使用用户选定的工作模型与模型档位；没有引入更强模型。
- `fast`/`balanced` 的裁剪只减少后续反馈/修订调用，不能伪称完整多轮已执行；`capReason` 和 effective plan 对用户可见。
- 取消、失败与普通生成 fallback 保留；普通 fallback 不计入实验 maxCalls。
- 目前没有证据证明 fast 方案在所有任务上质量等价于完整循环。独立顾问建议过“fast hybrid 用少一个候选换一次修订”，但它没有拿到本地源码材料，且没有实测质量证据，本候选没有采用这个未经验证的交换。

## 验证

- `po06/test/inference-boost.test.mjs`：16/16；覆盖 profile 上限、fast hybrid 三调用、balanced hybrid 五调用、实际 `callsUsed/status`、取消、fallback、候选选择与循环兼容。
- 非浏览器套件：103/103 通过。`verifier-html.test.mjs` 在当前环境 30 秒没有输出并阻塞，属于既有浏览器环境限制，未把它当通过。
- 真实 trace 只用于建立调用/延迟模型；还没有对同一批真实开发任务做 fast/balanced/inherit 的质量 A/B。下一步只用 DeepSeek Flash 做小规模对照，比较产物质量、实际调用数和墙钟时间。

## 回退

回到发布分支或关闭 `reasoningBoost` 即可回退；本候选没有修改 `v0.8.4-stable` 的 tag、Release 或用户模型/权限。
