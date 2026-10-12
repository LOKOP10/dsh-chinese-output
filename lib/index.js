/**
 * dsh-chinese-output — 让 DeepSeek Harness 的 Agent 用中文思考、用中文作答。
 *
 * 工作原理：向 `ctx.systemPrompt` 注册一个**全局**提示词段落。该段落位于
 * 系统提示词的最前面（紧跟 harness 身份与部署人设之后），因此对每一个
 * Agent 生效 —— 主 Agent、子 Agent、workflow 子任务都包含在内。
 *
 * 段落文本是一个函数：每次组装提示词时重新求值，所以 `/chinese` 命令可以在
 * 不重新加载插件的前提下即时开关。返回空串的段落会被 `renderPrompt` 丢弃，
 * 因此「关闭」等于「该段落不存在」。
 *
 * 本文件**不导入任何外部模块**。插件以链接（junction）方式安装时，Node 的
 * 原生解析在插件目录下找不到 `node_modules`，任何裸导入都可能失败；零依赖
 * 让插件无论在哪种安装方式下都能被加载。
 *
 * @module dsh-chinese-output
 */

/** Cordis 插件名。 */
export const name = 'chinese-output'

/**
 * 依赖的系统提示词注册表。
 *
 * 声明为硬依赖：`systemPrompt` 缺席时插件保持未激活，而不是抛错 ——
 * 这正是 Cordis `inject` 的语义。
 */
export const inject = ['systemPrompt']

/** 段落名。稳定且唯一，便于其它插件在同一位置覆盖或抑制。 */
export const SECTION_NAME = 'chinese-output:language'

/**
 * 段落排序位置。
 *
 * 取值 10：排在 harness 身份（-1000）与部署人设前缀（0）之后，又远在
 * 计划策略（500）、工具说明（900+）之前 —— 语言规则应当尽早出现。
 */
export const SECTION_ORDER = 10

/**
 * 手写的 Standard Schema 校验器。
 *
 * Cordis 只要求 `plugin.Config` 满足 Standard Schema 接口
 * （`~standard.validate`），并不要求它是 schemastery 实例。自己实现一份
 * 就免掉了唯一的运行时依赖，同时保留配置校验与设置页面的字段描述。
 *
 * @param shape - 字段名到字段定义的映射。
 * @returns 可挂到 `plugin.Config` 上的 schema 对象。
 */
function createSchema(shape) {
  const coerce = (raw) => {
    const source = raw !== null && typeof raw === 'object' ? raw : {}
    const value = {}
    const issues = []

    for (const [key, field] of Object.entries(shape)) {
      const provided = source[key]

      if (provided === undefined) {
        value[key] = typeof field.default === 'function' ? field.default() : field.default
        continue
      }

      if (field.type === 'boolean') {
        if (typeof provided !== 'boolean') {
          issues.push({ message: `${key} 必须是布尔值`, path: [key] })
          continue
        }
        value[key] = provided
        continue
      }

      if (field.type === 'string') {
        if (typeof provided !== 'string') {
          issues.push({ message: `${key} 必须是字符串`, path: [key] })
          continue
        }
        value[key] = provided
        continue
      }

      if (field.type === 'string[]') {
        if (!Array.isArray(provided) || provided.some((item) => typeof item !== 'string')) {
          issues.push({ message: `${key} 必须是字符串数组`, path: [key] })
          continue
        }
        value[key] = [...provided]
        continue
      }

      issues.push({ message: `${key} 的类型未知`, path: [key] })
    }

    return issues.length > 0 ? { issues } : { value }
  }

  return {
    '~standard': {
      version: 1,
      vendor: 'dsh-chinese-output',
      validate: coerce,
    },
  }
}

/** 运行时配置。 */
export const Config = createSchema({
  enabled: {
    type: 'boolean',
    default: true,
    description: '总开关：关闭后不注入任何语言要求段落',
  },
  thinking: {
    type: 'boolean',
    default: true,
    description: '要求思考过程（reasoning）使用中文',
  },
  output: {
    type: 'boolean',
    default: true,
    description: '要求面向用户的输出使用中文',
  },
  keepOriginal: {
    type: 'string[]',
    default: () => [],
    description: '额外要求保持原文、不要翻译的术语',
  },
  extra: {
    type: 'string',
    default: '',
    description: '附加在段落末尾的自定义要求',
  },
})

/**
 * 无论开关如何都始终成立的「保持原文」规则。
 *
 * 这些是机器可读内容：翻译它们会破坏代码、命令与工具调用，
 * 所以它们不属于可选项。
 */
const ALWAYS_LITERAL = [
  '代码、代码块、标识符、函数名、变量名、类名、宏与配置键',
  '文件路径、目录名、URL、命令行及其参数',
  '工具名称与工具参数（含 JSON 键名与枚举值）',
  '报错信息、日志原文、堆栈跟踪与第三方库的专有名称',
]

/**
 * 组装注入给模型的段落文本。
 *
 * @param options - 已解析的配置。
 * @param options.thinking - 是否约束思考语言。
 * @param options.output - 是否约束输出语言。
 * @param options.keepOriginal - 额外保持原文的术语。
 * @param options.extra - 附加要求。
 * @returns 段落文本；两个语言开关都关闭时返回空串，表示不注入。
 */
export function buildInstruction(options) {
  const thinking = options.thinking !== false
  const output = options.output !== false
  if (!thinking && !output) return ''

  const blocks = ['# 语言要求（最高优先级）']

  if (thinking && output) {
    blocks.push('在本会话中，你的思考过程与面向用户的输出都必须使用简体中文（zh-CN）。')
  } else if (thinking) {
    blocks.push('在本会话中，你的思考过程必须使用简体中文（zh-CN）。')
  } else {
    blocks.push('在本会话中，你面向用户的输出必须使用简体中文（zh-CN）。')
  }

  if (thinking) {
    blocks.push(
      [
        '## 思考过程',
        '- 全部内部推理、分析、规划、自查与试错都用中文书写，不要用英文成句思考。',
        '- 即使用户用英文提问，或参考资料是英文，思考过程仍然使用中文。',
        '- 通用技术名词（如 API、token、cache、prompt）可保留原文，但周围的推理必须是中文。',
      ].join('\n'),
    )
  }

  if (output) {
    blocks.push(
      [
        '## 输出内容',
        '- 正文、说明、总结、计划、澄清提问与报错解释全部使用简体中文。',
        '- 标题、列表、表格、图注中的文字同样使用中文。',
        '- 使用准确、简洁、专业的中文表达；不要用中英对照重复同一句话。',
        '- 若必须引用英文原文，请给出中文说明，不要只贴英文。',
      ].join('\n'),
    )
  }

  const literal = [...ALWAYS_LITERAL, ...(options.keepOriginal ?? []).filter(Boolean)]
  blocks.push(
    [
      '## 保持原文，不要翻译',
      '以下内容必须原样保留：',
      ...literal.map((item) => `- ${item}`),
    ].join('\n'),
  )

  blocks.push(
    [
      '## 例外',
      '- 用户在某次请求中明确要求使用其他语言时，以用户当次的要求为准。',
      '- 用户明确要求保留原文的引用、术语或片段，一律照办。',
    ].join('\n'),
  )

  const extra = (options.extra ?? '').trim()
  if (extra.length > 0) blocks.push(extra)

  return blocks.join('\n\n')
}

/**
 * 把中文要求注册进系统提示词，并提供 `/chinese` 运行时开关。
 *
 * @param ctx - 挂载上下文。
 * @param rawConfig - Loader 传入的配置；缺省字段按 schema 默认值处理。
 */
export function apply(ctx, rawConfig) {
  const config = rawConfig ?? {}

  /**
   * 当前生效的开关。
   *
   * 以配置为初值，之后由 `/chinese` 命令在进程内修改。刻意不落盘：
   * 持久化的默认值属于 profile 的 `cordis.patch.yml`，命令只负责本次运行。
   */
  const state = {
    enabled: config.enabled !== false,
    thinking: config.thinking !== false,
    output: config.output !== false,
  }

  const keepOriginal = Array.isArray(config.keepOriginal) ? config.keepOriginal : []
  const extra = typeof config.extra === 'string' ? config.extra : ''

  /** 每次组装提示词时求值；关闭时返回空串，段落随即被丢弃。 */
  const sectionText = () => {
    if (!state.enabled) return ''
    return buildInstruction({
      thinking: state.thinking,
      output: state.output,
      keepOriginal,
      extra,
    })
  }

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: sectionText,
        // 段落可能包含用户自定义文本；关闭插值可避免其中的 `{{...}}`
        // 被当作提示词变量而在组装时抛错。
        interpolate: false,
      }),
    'chinese-output.section()',
  )

  // `commands` 是可选依赖：命令注册表缺席时，提示词功能照常工作。
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: 'dsh-chinese-output',
      name: 'chinese',
      description: '查看或切换「中文思考 + 中文输出」',
      input: {
        hint: '[on|off|status|thinking on|off|output on|off]',
      },
      handler: (invocation) => runCommand(state, invocation.rawInput),
    })
  })

  ctx.logger?.info?.(
    `dsh-chinese-output: 已启用（思考=${state.thinking ? '中文' : '不限制'}，输出=${state.output ? '中文' : '不限制'}）`,
  )
}

/** 一行状态摘要，供 `/chinese` 复用。 */
function statusLine(state) {
  const on = (value) => (value ? '中文' : '不限制')
  return [
    `总开关：${state.enabled ? '已开启' : '已关闭'}`,
    `思考过程：${on(state.thinking)}`,
    `输出内容：${on(state.output)}`,
  ].join('\n')
}

/**
 * 解析并执行 `/chinese`。
 *
 * @param state - 插件的可变开关，直接就地修改。
 * @param rawInput - 命令行的其余部分。
 * @returns 命令结果；无法解析的输入返回 `error`。
 */
function runCommand(state, rawInput) {
  const input = (rawInput ?? '').trim().toLowerCase()

  if (input === '' || input === 'status') {
    return { kind: 'success', text: `${statusLine(state)}\n\n用法：/chinese [on|off|thinking on|off|output on|off]` }
  }

  // `on` 恢复完整的中文要求，而不只是抬起总开关：否则在
  // `/chinese thinking off` + `/chinese output off` 之后，`/chinese on`
  // 会「显示已开启」却注入空段落 —— 一个静默失效的开关。
  if (input === 'on' || input === 'enable' || input === '开启') {
    state.enabled = true
    state.thinking = true
    state.output = true
    return { kind: 'success', text: `已开启中文要求。\n\n${statusLine(state)}` }
  }

  if (input === 'off' || input === 'disable' || input === '关闭') {
    state.enabled = false
    return { kind: 'success', text: `已关闭中文要求。\n\n${statusLine(state)}` }
  }

  const toggle = /^(thinking|output|思考|输出)\s+(on|off|enable|disable|开启|关闭)$/u.exec(input)
  if (toggle !== null) {
    const field = toggle[1] === 'thinking' || toggle[1] === '思考' ? 'thinking' : 'output'
    const value = toggle[2] === 'on' || toggle[2] === 'enable' || toggle[2] === '开启'
    state[field] = value
    state.enabled = true
    return { kind: 'success', text: `已更新设置。\n\n${statusLine(state)}` }
  }

  return {
    kind: 'error',
    text: `无法识别的参数「${(rawInput ?? '').trim()}」。\n用法：/chinese [on|off|thinking on|off|output on|off]`,
  }
}
