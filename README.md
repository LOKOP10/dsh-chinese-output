# DSH 中文思考与输出


[English](./README.en.md) | 中文


让 DeepSeek Harness 的 Agent **全程使用中文**：思考过程（reasoning）与面向用户的输出都用中文，
同时保留代码、路径、命令、工具参数等机器可读内容的原文。

## 它解决什么问题

DSH 默认不限制 Agent 的思考语言。当系统提示词、工具说明、报错信息大量是英文时，
模型往往会用英文思考、甚至用英文作答。本插件在系统提示词的最前面插入一段
**最高优先级的语言要求**，把思考和输出都固定到简体中文。

因为段落注册在**全局作用域**，它对每个 Agent 都生效：

- 主 Agent
- `subagent` / `subagent_fork` 派生的子 Agent
- `workflow` 脚本里的子任务
- 压缩、生成标题等辅助调用

## 安装

### 从 GitHub 安装（推荐）

在插件管理页面（侧边栏 **Plugins**）填入本仓库地址，或让 Agent 调用 `plugin_manager` 工具：

```text
install_bundle  target = github:LOKOP01/dsh-chinese-output
```

也可以先克隆到本地，再按绝对路径安装：

```text
git clone https://github.com/LOKOP01/dsh-chinese-output.git
install_bundle  target = <克隆下来的绝对路径>
```

插件通过自身的 `cordis.patch.yml` 把自己插入 profile，无需手写配置。

## 配置

在 profile 的 `cordis.patch.yml` 里用同一个 `id`（`chinese-output`）覆盖 config：

```yaml
- id: chinese-output
  name: dsh-chinese-output
  config:
    enabled: true
    thinking: true
    output: true
    keepOriginal:
      - 你们的内部项目代号
    extra: 回复尽量控制在 200 字以内。
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。关闭后不注入任何语言要求段落 |
| `thinking` | `true` | 要求思考过程使用中文 |
| `output` | `true` | 要求面向用户的输出使用中文 |
| `keepOriginal` | `[]` | 额外要求保持原文、不要翻译的术语 |
| `extra` | `''` | 附加在段落末尾的自定义要求 |

## 运行时开关：`/chinese`

不想改配置、只想临时切换时，在对话框输入：

```text
/chinese              查看当前状态
/chinese off          关闭中文要求
/chinese on           恢复中文要求（思考与输出都恢复）
/chinese thinking off 只放开思考语言
/chinese output off   只放开输出语言
```

命令只影响**当前进程**，不写盘；持久化的默认值仍然由 `cordis.patch.yml` 决定。

## 保持原文的内容

下面这些内容无论开关如何都**不会被翻译**，翻译它们会破坏机器可读性：

- 代码、代码块、标识符、函数名、变量名、类名、宏与配置键
- 文件路径、目录名、URL、命令行及其参数
- 工具名称与工具参数（含 JSON 键名与枚举值）
- 报错信息、日志原文、堆栈跟踪与第三方库的专有名称

## 例外规则

用户在某次请求中明确要求使用其他语言时，以用户当次的要求为准。
用户明确要求保留原文的引用、术语或片段，一律照办。

## 实现说明

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 插件入口：段落组装、Config schema、`/chinese` 命令 |
| `cordis.patch.yml` | bundle 层：把插件插入 profile |
| `test/selftest.mjs` | 离线自检：配置校验、段落文本、开关联动、命令行为 |
| `package.json` | 包元数据与 `dsh.bundle.patch` 声明 |

插件只依赖 `ctx.systemPrompt`（硬依赖）与 `ctx.commands`（可选）。
`commands` 缺席时提示词功能照常工作，只是没有 `/chinese` 命令。

段落文本是一个**函数**，每次组装提示词时重新求值，因此 `/chinese` 可以即时生效；
关闭时函数返回空串，`renderPrompt` 会把空段落丢弃 —— 「关闭」等价于「该段落不存在」。

段落的 `interpolate: false` 是刻意设置：`extra` 里如果出现 `{{...}}`，
在开启插值时会被当成提示词变量而在组装阶段抛错。

### 为什么零依赖

插件以**链接（junction）**方式安装到 profile 时，插件目录下没有 `node_modules`，
Node 的原生解析从该目录向上找不到任何祖先 `node_modules`。实测中，带
`import z from '@deepseek-ai/schemastery'` 的版本会以模块解析失败告终，
条目停在 `inactive`（Loader 报 `failed to import`）。

因此本插件**不导入任何外部模块**，`Config` 改为手写的 Standard Schema 校验器 ——
Cordis 只要求 `plugin.Config['~standard'].validate(config)` 存在，
并不要求它是 schemastery 实例（见 `resolveConfig` 的实现）。
这样插件在链接安装、拷贝安装、发布安装下都能加载。

**代价**：DSH 的设置页面通过 schemastery 元数据生成表单，手写 schema 无法被投影，
因此 Settings 里本插件显示为 `unsupported`、没有自动生成的配置表单。
这不影响插件运行 —— 配置仍然可以通过 profile 的 `cordis.patch.yml` 修改，
运行时也可以用 `/chinese` 命令切换。插件在 Host 中的状态为 `enabled: true`、
`fiberPhase: "active"`。

## 测试

```bash
node test/selftest.mjs
```

覆盖：Config 默认值与非法输入、段落文本小节、思考/输出开关联动、
`extra` 追加、`apply()` 的段落注册契约、`/chinese` 全部参数、
`commands` 缺席时的降级、未传配置时的默认值。

## 版本兼容

面向 DSH `0.2.0-rc.2` 编写。插件不声明任何 `peerDependencies`，
因此不会被 DSH 的 peer 版本检查拦下，也不会因链接安装而解析失败。

## 许可

MIT
