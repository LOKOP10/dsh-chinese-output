# DSH Chinese Thinking & Output


English | [中文](./README.md)


Make a DeepSeek Harness agent **work in Chinese end to end**: its reasoning and its
user-facing output are both Chinese, while code, paths, commands, and tool arguments
keep their original form.

## What it solves

DSH does not constrain an agent's thinking language. When the system prompt, tool
descriptions, and error messages are largely English, the model tends to reason in
English and may even answer in English. This plugin injects a
**highest-priority language requirement** at the very front of the system prompt,
pinning both reasoning and output to Simplified Chinese.

Because the section registers in the **global scope**, it applies to every agent:

- The main agent
- Child agents spawned by `subagent` / `subagent_fork`
- Subagents inside `workflow` scripts
- Auxiliary calls such as compaction and title generation

## Installation

### From GitHub (recommended)

Enter this repository in the Plugins page (sidebar **Plugins**), or let an agent call
the `plugin_manager` tool:

```text
install_bundle  target = github:LOKOP01/dsh-chinese-output
```

You can also clone it first and install by absolute path:

```text
git clone https://github.com/LOKOP01/dsh-chinese-output.git
install_bundle  target = <the cloned absolute path>
```

The plugin inserts itself into the profile through its own `cordis.patch.yml`, so no
hand-written configuration is needed.

## Configuration

Override the config in the profile's `cordis.patch.yml` using the same `id`
(`chinese-output`):

```yaml
- id: chinese-output
  name: dsh-chinese-output
  config:
    enabled: true
    thinking: true
    output: true
    keepOriginal:
      - your internal project codename
    extra: Keep replies under 200 words.
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. When off, no language-requirement section is injected |
| `thinking` | `true` | Require the reasoning process to be Chinese |
| `output` | `true` | Require user-facing output to be Chinese |
| `keepOriginal` | `[]` | Extra terms that must stay in their original form and never be translated |
| `extra` | `''` | Custom requirements appended to the end of the section |

## Runtime switch: `/chinese`

To toggle without editing configuration, type in the composer:

```text
/chinese              Show current status
/chinese off          Turn the Chinese requirement off
/chinese on           Restore it (both thinking and output)
/chinese thinking off Leave only the reasoning language unconstrained
/chinese output off   Leave only the output language unconstrained
```

The command affects the **current process only** and writes nothing to disk; the
persistent default still comes from `cordis.patch.yml`.

## Content kept verbatim

The following is **never translated** regardless of the switches, because translating
it would break machine readability:

- Code, code blocks, identifiers, function names, variable names, class names, macros, and configuration keys
- File paths, directory names, URLs, command lines and their arguments
- Tool names and tool arguments (including JSON keys and enum values)
- Error messages, raw log text, stack traces, and third-party library proper names

## Exceptions

When the user explicitly asks for another language in a given request, that request's
requirement wins. When the user explicitly asks to keep a quotation, term, or fragment
in its original form, that is honored as well.

## Implementation

| File | Role |
|---|---|
| `lib/index.js` | Plugin entry: section assembly, Config schema, `/chinese` command |
| `cordis.patch.yml` | Bundle layer: inserts the plugin into the profile |
| `test/selftest.mjs` | Offline self-test: config validation, section text, switch behavior, command behavior |
| `package.json` | Package metadata and the `dsh.bundle.patch` declaration |

The plugin depends only on `ctx.systemPrompt` (hard dependency) and `ctx.commands`
(optional). When `commands` is absent, the prompt feature still works — there is simply
no `/chinese` command.

The section text is a **function**, re-evaluated on every prompt assembly, which is what
makes `/chinese` take effect immediately. When off, the function returns an empty
string and `renderPrompt` drops the empty section — "off" is equivalent to "the section
does not exist".

The section's `interpolate: false` is deliberate: if `extra` contained `{{...}}`,
interpolation would treat it as a prompt variable and throw during assembly.

### Why zero dependencies

When the plugin is installed into a profile as a **link (junction)**, its directory has
no `node_modules`, and Node's native resolution finds no ancestor `node_modules` above
it. In testing, the version carrying `import z from '@deepseek-ai/schemastery'` ended in
a module-resolution failure and the entry stayed `inactive` (the Loader reported
`failed to import`).

This plugin therefore **imports no external module at all**, and its `Config` is a
hand-written Standard Schema validator. Cordis only requires
`plugin.Config['~standard'].validate(config)` to exist; it does not require a
schemastery instance (see the `resolveConfig` implementation). The plugin thus loads
under link, copy, and published installation alike.

**The tradeoff**: the DSH settings page builds forms from schemastery metadata, and a
hand-written schema cannot be projected, so Settings shows this plugin as `unsupported`
with no auto-generated configuration form. This does not affect the plugin: the config
is still editable through the profile's `cordis.patch.yml`, and `/chinese` toggles it at
runtime. In the Host the plugin reports `enabled: true`, `fiberPhase: "active"`.

## Tests

```bash
node test/selftest.mjs
```

Covers: Config defaults and invalid input, section text, thinking/output switch
interaction, `extra` appending, the `apply()` section-registration contract, every
`/chinese` argument, graceful degradation when `commands` is absent, and defaults when
no config is passed.

## Version compatibility

Written for DSH `0.2.0-rc.2`. The plugin declares no `peerDependencies`, so it is never
blocked by DSH's peer version check and never fails to resolve because of a link
installation.

## License

MIT
