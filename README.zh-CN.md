# statuspane

[English](README.md) · **中文**

Claude Code 输入框上方右侧的一张小状态卡。它是一个 [mod](https://code.claude.com/docs/en/plugins/mods/overview)（由函数 hooks 组成的插件），不需要配置 `statusLine` 脚本。

```
                                   ╭────────────────────────────────────╮
                                   │ Opus 5.5 (1M) · high  [⚙][ ▾ 收起 ]│
                                   │ ctx ███░░░░░░░░░ 22% 222k/1M        │
                                   │ 5h 23% ↻2h41m · wk 61% ↻2d4h        │
                                   │ ~/proj · ⎇ main · $3.12             │
                                   │ build ██████░░░░░░ 50% 3/6          │
                                   ╰────────────────────────────────────╯
> _
```

- 显示**模型 · effort**、**上下文**占用（已用/上限）、**5 小时和每周额度**及重置倒计时、**目录 · git 分支**、**会话花费**。
- **进度条接入**：任何脚本或 mod 都能往卡片上加进度行（见[进度接口](#进度接口)）。每秒刷新一次，来源停止更新后自动消失。
- **全程鼠标操作**：点 `[ ▾ 收起 ]` 把卡片收成一个 `[ ◂ 状态 ]` 按钮，点它展开；点 `[⚙]` 原地打开设置页。
- **设置**（跨会话保存）：每一行单独开关，进度条长度 6–24，语言（English / 中文）。
- 目录太长时只保留最后几级（如 `…/web/frontend`，最多 20 列），分支名太长会截断，卡片内宽最多 50 列。
- 颜色沿用常见 statusline 的阈值：低于 60% 绿、60% 起黄、85% 起红（上下文为 50% / 80%）。

## 安装

需要支持 mod（函数 hooks）的 Claude Code 版本。

```text
/plugin marketplace add xuanji86/claude-statuspane
/plugin install statuspane@claude-statuspane
```

或在终端里：

```sh
claude plugin marketplace add xuanji86/claude-statuspane
claude plugin install statuspane@claude-statuspane
```

终端宽度至少 70 列才会显示卡片。它不替换任何东西：如果你同时配了 `statusLine`，两者都会显示；只想要卡片的话，把 `~/.claude/settings.json` 里的 `statusLine` 删掉。

## 使用

| 操作 | 效果 |
| --- | --- |
| 点 `[ ▾ 收起 ]` / `[ ◂ 状态 ]` | 收成一个按钮 / 展开 |
| 点 `[⚙]` | 设置页：点某行切换显示，`[ - ]` `[ + ]` 调进度条长度，切换语言，点 `[ ✓ 完成 ]` 返回 |
| `/statuspane` | 和收起/展开一样 |

面板右上角的 `-` 是 Claude Code 自带的"隐藏插件面板"。它会把整块区域隐藏，而且只能用它的快捷键恢复（默认 `ctrl+x ctrl+a`）。如果你的终端不支持 `ctrl+x` 开头的组合键，可以在 `~/.claude/keybindings.json` 里绑到一个单键：

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+s": "abovePrompt:toggle", "ctrl+q": "chat:stash" } }
  ]
}
```

（`ctrl+s` 默认是"暂存草稿"，示例把它挪到了 `ctrl+q`。）

## 进度接口

有两种接入方式。进度行按 id 排序，最多显示 5 行。

### 1. 写一个 JSON 文件（任何语言都能用）

写入 `~/.claude/statuspane/progress/<id>.json`（或 `$STATUSPANE_PROGRESS_DIR/<id>.json`）：

```json
{ "label": "build", "percent": 42.5, "text": "3/7 · 1.2/min", "ttl": 300 }
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `label` | 字符串 | 进度条前的名字，最多 24 个字符（不填就用 id） |
| `percent` | 数字，可选 | 0–100。不填就只显示文字 |
| `text` | 字符串，可选 | 进度条后的文字，最多 60 个字符 |
| `ttl` | 秒，可选 | 文件最后一次写入后多久自动消失（默认 300） |

`<id>` 只能用字母、数字、`.`、`_`、`-`。请先写到临时文件再改名覆盖，避免卡片读到写了一半的文件；删掉文件这一行会立刻消失。现成的工具：[`examples/report-progress.sh`](examples/report-progress.sh)、[`examples/report_progress.py`](examples/report_progress.py)。

```sh
examples/report-progress.sh build "build" 42.5 "3/7"
```

卡片只读这个目录里不超过 4 KB 的 `*.json` 文件，文字会去掉控制字符和双向控制符后原样显示，不会执行文件里的任何内容。

### 2. 在别的 mod 里调用 `$.statuspane`

在你的 mod 的 `plugin.json` 的 `dependencies` 里加上 `statuspane`（类型文件会自动放进你的 `.claude-plugin/types/statuspane/`），然后：

```ts
await $.statuspane.progress({ id: 'my-job', label: 'my job', percent: 40, text: '4/10', ttl: 120 })
await $.statuspane.clear('my-job')
```

字段和文件方式相同。通过 mod 上报的进度只存在内存里，statuspane 重新加载后需要重新上报。

### 已接入

- [ainiee-translate](https://github.com/xuanji86/ainiee-translate-skill) v1.14+：`progress --watch` / `--line` 会自动写入翻译进度。

## 隐私

所有数据都在本地。mod 只读取 Claude Code 自己的会话数据，在会话目录里运行 `git branch --show-current`，并读取进度目录。

## 开发

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .        # 或把目录加到 CLAUDE_CODE_PLUGIN_DIRS
```

从目录加载时，保存文件就会自动重新加载 mod。

## 许可证

[MIT](LICENSE)
