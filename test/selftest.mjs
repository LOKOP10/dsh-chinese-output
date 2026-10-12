/**
 * 自检：用假的 ctx 驱动插件，验证配置校验、段落文本、开关联动与命令行为。
 *
 * 插件零依赖，因此本测试不需要任何模块解析映射，直接运行即可：
 *
 *   node test/selftest.mjs
 */
import assert from 'node:assert/strict'

const mod = await import('../lib/index.js')
const { Config, apply, buildInstruction, SECTION_NAME, SECTION_ORDER } = mod

/* ---------- 1. Config schema 默认值 ---------- */
const parsed = Config['~standard'].validate({})
assert.ok(!('issues' in parsed), '空配置应校验通过')
const defaults = parsed.value
assert.equal(defaults.enabled, true, 'enabled 默认应为 true')
assert.equal(defaults.thinking, true, 'thinking 默认应为 true')
assert.equal(defaults.output, true, 'output 默认应为 true')
assert.deepEqual(defaults.keepOriginal, [], 'keepOriginal 默认应为空数组')
assert.equal(defaults.extra, '', 'extra 默认应为空串')
console.log('✓ Config 默认值正确')

/* ---------- 2. 非法配置被拒绝 ---------- */
assert.ok('issues' in Config['~standard'].validate({ thinking: 'yes' }), '非布尔 thinking 应被拒绝')
assert.ok('issues' in Config['~standard'].validate({ keepOriginal: [1] }), '非字符串数组应被拒绝')
const coerced = Config['~standard'].validate({ enabled: false, extra: 'x' }).value
assert.equal(coerced.enabled, false, '显式 false 应被保留')
assert.equal(coerced.thinking, true, '未提供的字段应取默认值')
console.log('✓ 非法配置被拒绝，缺省字段回填默认值')

/* ---------- 3. 段落文本内容 ---------- */
const text = buildInstruction({ thinking: true, output: true, keepOriginal: ['DSH'], extra: '' })
assert.ok(text.includes('简体中文'), '应提到简体中文')
assert.ok(text.includes('思考过程'), '应包含思考过程小节')
assert.ok(text.includes('输出内容'), '应包含输出内容小节')
assert.ok(text.includes('保持原文'), '应包含保持原文小节')
assert.ok(text.includes('代码'), '应保留代码原文')
assert.ok(text.includes('工具名称与工具参数'), '应保留工具参数原文')
assert.ok(text.includes('DSH'), '应包含自定义术语')
assert.ok(text.includes('用户'), '应包含用户优先的例外')
console.log('✓ 段落文本包含全部关键小节')

/* ---------- 4. 开关联动 ---------- */
assert.equal(
  buildInstruction({ thinking: false, output: false, keepOriginal: [], extra: '' }),
  '',
  '两个语言开关都关闭时应返回空串',
)
assert.ok(
  buildInstruction({ thinking: true, output: false, keepOriginal: [], extra: '' }).includes('思考过程'),
  '仅思考开启时应包含思考小节',
)
assert.ok(
  !buildInstruction({ thinking: true, output: false, keepOriginal: [], extra: '' }).includes('## 输出内容'),
  '仅思考开启时不应包含输出小节',
)
console.log('✓ 开关联动正确')

/* ---------- 5. 自定义附加要求 ---------- */
assert.ok(
  buildInstruction({ thinking: true, output: true, keepOriginal: [], extra: '  始终使用「您」。  ' }).endsWith('始终使用「您」。'),
  'extra 应被裁剪并追加到末尾',
)
console.log('✓ extra 追加正确')

/* ---------- 6. apply() 注册段落 ---------- */
const sections = []
const commands = []
const effects = []

function makeCtx({ withCommands = true } = {}) {
  return {
    logger: { info: () => {} },
    effect(fn, label) {
      effects.push(label)
      return fn()
    },
    inject(deps, cb) {
      if (!withCommands && deps.includes('commands')) return
      cb({ commands: { register: (def) => commands.push(def) } })
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
  }
}

apply(makeCtx(), Config['~standard'].validate({ keepOriginal: ['DeepSeek Harness'] }).value)

assert.equal(sections.length, 1, '应注册恰好一个段落')
const section = sections[0]
assert.equal(section.name, SECTION_NAME, '段落名应为常量')
assert.equal(section.order, SECTION_ORDER, '排序位置应为常量')
assert.equal(section.interpolate, false, '必须关闭插值以免 {{...}} 抛错')
assert.equal(typeof section.text, 'function', '段落文本应为函数，以支持运行时开关')
assert.ok(section.text().includes('简体中文'), '段落求值后应包含中文要求')
assert.equal(effects.length, 1, '应通过 ctx.effect 注册以随插件卸载')
console.log('✓ apply() 注册段落正确')

/* ---------- 7. 命令注册与行为 ---------- */
assert.equal(commands.length, 1, '应注册一个命令')
const cmd = commands[0]
assert.equal(cmd.name, 'chinese', '命令名应为 chinese')

const run = (rawInput) =>
  cmd.handler({ rawInput, agent: {}, attachments: [], signal: new AbortController().signal, commandId: 'x' })

const status = run('')
assert.equal(status.kind, 'success')
assert.ok(status.text.includes('总开关：已开启'), '初始状态应为开启')

assert.equal(run('off').kind, 'success')
assert.equal(section.text(), '', '关闭后段落应为空串，从而不被注入')
assert.ok(run('').text.includes('总开关：已关闭'))

assert.equal(run('on').kind, 'success')
assert.ok(section.text().length > 0, '重新开启后段落应恢复')

assert.equal(run('thinking off').kind, 'success')
assert.ok(!section.text().includes('## 思考过程'), '关闭思考后不应有思考小节')
assert.ok(section.text().includes('## 输出内容'), '输出小节应保留')

assert.equal(run('输出 off').kind, 'success')
assert.equal(section.text(), '', '思考与输出都关闭后段落应为空串')

assert.equal(run('bogus').kind, 'error', '未知参数应报错')
assert.ok(run('bogus').text.includes('用法'), '错误信息应给出用法')

run('on')
assert.ok(section.text().includes('DeepSeek Harness'), '配置里的自定义术语应出现在段落中')
console.log('✓ /chinese 命令行为正确')

/* ---------- 8. commands 缺席时仍可工作 ---------- */
sections.length = 0
commands.length = 0
apply(makeCtx({ withCommands: false }), Config['~standard'].validate({}).value)
assert.equal(sections.length, 1, 'commands 缺席时提示词段落仍应注册')
assert.equal(commands.length, 0, 'commands 缺席时不应注册命令')
console.log('✓ commands 缺席时优雅降级')

/* ---------- 9. 无配置调用 ---------- */
sections.length = 0
apply(makeCtx(), undefined)
assert.ok(sections[0].text().includes('简体中文'), '未传配置时应使用默认值')
console.log('✓ 未传配置时使用默认值')

console.log('\n全部自检通过。')
