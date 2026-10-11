# 换机器开发：搬迁清单

> 结论先行：**仓库靠 git 走，仓库外的工具/配置靠打包脚本走，会话记忆你自己打包走。**
> 到了新机器，有**两类绝对路径必须改**——不改的表现是"装上了却什么都不生效"，不会报错。

## 一、仓库（git 带得走）

| 项 | 值 |
|---|---|
| 路径 | `~/.dsh/plugins/dsh-prompt-optimizer` |
| 当前 HEAD | `89f0cc4`（`main` 与远端一致，工作树干净） |
| 体积 | 约 45 MB，其中 `po06/runtime`（自带 MSYS2 运行时）**已在 git 里** |
| 推荐搬法 | 在新机器上 `git clone https://github.com/WestFox-AwA/dsh-prompt-optimizer.git` |

克隆比拷目录更干净：仓库里所有改动都已提交并推送。克隆后直接可用（运行时随仓库走，不需要额外下载）。

## 二、仓库外的东西（git 带不走，必须单独搬）

用本仓库的脚本收拢，不用手记：

```bash
node po06/scripts/pack-migration.mjs          # 输出到 <DSH_HOME>/migration-<日期>/
```

它会复制下面这些，并生成 `MIGRATION-MANIFEST.json`（含每项 sha256，到新机器可核对）：

| 文件 | 作用 | 必须 |
|---|---|---|
| `po06-beta/make-release.mjs` | 一键发版脚本（建 tag → 核对落点 → 打包 → 发 Release） | ✅ |
| `po06.json` | 插件设置：档位/权限/模型/英文模式/推理增强等（**已确认不含绝对路径**） | ✅ |
| `po06-prompt.md` | 解释层核心提示词（当前是协议 v3 的 323 字核心） | ✅ |
| `profiles/<name>/package.json` | profile 依赖与 `bundles` 接线（**含本机绝对路径**） | ✅ |
| `po06-prompt.before-protocol-v3-c0374fa4.md` | 迁移前的旧默认提示词备份（要回退时用） | 可选 |
| `po06-beta/notes-*.md` | 各版 Release 说明正文 | 可选 |
| `profiles/desktop/cordis.patch.yml` | 桌面版 profile 的装配补丁 | 可选 |
| `tmp-test/*.cjs` | 开发期助手（CI 日志读取、变异抽查、套件运行等） | 可选 |
| `prompt-optimizer.json` | 0.5 旧插件配置（只为验证 `DOUBLE_INTERCEPT` 双重拦截） | 可选 |
| `po06-state/`、`po06-english/`、`po06-capability/`、`po06-inference/` | 插件运行期数据（意图状态、翻译缓存、任务理解、推理轨迹） | 可选 |
| `tmp-pack/dsh020-src` | DSH 0.2.0 源码快照（0.2 兼容核对用；本次打包因权限失败，需要就单独拷） | 可选 |

**不要带**（带了反而出问题）：

- `profiles/*/node_modules/` —— 里面是 **junction/软链**，复制会变成真目录或坏链；到新机器用 `dev_heal_links` 重建。
- `po06.json.bak-*` —— 几百个历史备份，没有价值。
- `*.tgz` —— Release 页随时可重下。

## 三、会话与记忆（你自己打包，我不动）

- `~/.dsh/sessions/`（当前 32 个条目）—— 会话记录
- `~/.dsh/storages/`（当前 4 个）—— 存储
- `~/.dsh/po06-state/` —— **意图状态**：不带它，旧会话里累积的约束会丢

> 提醒：这三处是"我恢复记忆"的关键。`po06-state` 属于插件数据，我在打包脚本里已列为可选；如果你希望旧任务能续，建议连它一起带走。

## 四、到新机器必须改的两类路径

| 文件 | 要改什么 | 不改的后果 |
|---|---|---|
| `po06-beta/make-release.mjs` | 顶部 `ROOT` 与 `DIR` 两行（现在写死 `C:/Users/WestFox/.dsh/...`） | 发版会去旧路径找仓库/产物，打包直接失败 |
| `profiles/<name>/package.json` 里的 `link:` | 指向本机插件目录的路径；**其他插件**（pixel-canvas / vmake / super-injector）的链接也要按新机器实际位置改 | 装配指向不存在的路径 ⇒ **装上了却什么都不生效，而且不报错** |

`po06.json` **不需要改**（已核对：不含任何绝对路径）。

## 五、新机器上的恢复顺序（照抄即可）

1. 装 DSH。兼容性：`0.1.7-rc.2` 本机实测运行；`0.2.0-rc.2` 逐成员静态契约核对通过、实机待验。
2. `git clone` 本仓库到 `~/.dsh/plugins/dsh-prompt-optimizer`。
3. 解开迁移包，按 `MIGRATION-MANIFEST.json` 把文件放回 `~/.dsh` 对应位置（可用其中的 sha256 逐个核对）。
4. 改第四节的**两类路径**。
5. 重建装配链接：用注入器的 `dev_heal_links`（或删掉 `node_modules` 后按 profile 重装）。
6. 解开会话/记忆包到 `~/.dsh/{sessions,storages,po06-state}`。
7. 启动：`dsh --profile web`。
8. 自检：
   - `GET /po06/api/status` → `version` 应为 `0.8.3-stable`、`prompt.protocolVersion` 为 `3`；
   - `node po06/scripts/check-install.mjs --profile <name> --expect-version 0.8.3-stable`；
   - `node po06/scripts/run-suites.mjs`（应 93 套全绿）。

## 六、搬走时的状态快照（用来核对"搬的是不是同一份"）

| 项 | 值 |
|---|---|
| 版本 | `0.8.3-stable`；解释协议 `v3` |
| HEAD | `89f0cc4` |
| 0.8.3 Release | 已发布，tgz sha256 `65e3976e7dfac309db844377835f60c945a466ae6bdc67f007d7c82683bc11cc` |
| 套件 | 93 套 / 1,003 项断言（发布前实测 0 失败） |
| 本机设置 | 解释模型 `deepseek-official/deepseek-flash`，思考档位 `max`；英文模式与推理增强**均未开启** |

### 上次留下的未完成项（新机器上接着做）

1. **CI 仍有 1 条失败**：`check-install` 的「装了但不在 `bundles` 里 ⇒ 阻断」在 Linux CI 上得到 `exit 0`，而本机复现为 `exit 1`；日志显示它已打出「❌ 装配树里没有这一层」，结论却是「✅ 可以开始试了」——判定与输出矛盾，**原因未查明**。
2. **变异门没跑完**（首次中断的原因已修：`read-session.test.mjs` 多打了一行成功日志破坏了"只输出一份 JSON 汇总"的约定）。
3. **`verify-artifact` 无结论**（脚本内报错 + 单独重跑超时）；附件哈希是用 API 独立核对一致的，但那不是同一项检查。
