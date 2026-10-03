# statuspane

**English** · [中文](README.zh-CN.md)

A small floating status card at the right edge, just above the Claude Code prompt — a
[mod](https://code.claude.com/docs/en/plugins/mods/overview) (a plugin of function hooks), so it
needs no `statusLine` script.

```
                                   ╭────────────────────────────────────╮
                                   │ Opus 5.5 (1M) · high  [⚙][ ▾ hide ]│
                                   │ ctx ███░░░░░░░░░ 22% 222k/1M        │
                                   │ 5h 23% ↻2h41m · wk 61% ↻2d4h        │
                                   │ ~/proj · ⎇ main · $3.12             │
                                   │ build ██████░░░░░░ 50% 3/6          │
                                   ╰────────────────────────────────────╯
> _
```

- **Model · effort**, **context** fill with tokens used / window, **5-hour and weekly limits** with
  reset countdowns, **directory · git branch**, **session cost**.
- **Progress rows** that any script or mod can feed (see [Progress API](#progress-api)), updated
  every second and gone on their own when their source stops reporting.
- **Clickable**: `[ ▾ hide ]` folds the card to a `[ ◂ status ]` button that brings it back;
  `[⚙]` opens the settings page in place.
- **Settings** (saved across sessions): show or hide each line, bar width (6–24), language
  (English / 中文).
- Long directories keep their last segments (`…/web/frontend`, 20 columns) and long branches are
  cut, so the card stays narrow (at most 50 columns inside).
- Colors follow the usual statusline thresholds: green below 60 %, yellow from 60 %, red from 85 %
  (context: 50 % / 80 %).

## Install

Needs a Claude Code build with mods (function hooks).

```text
/plugin marketplace add xuanji86/claude-statuspane
/plugin install statuspane@claude-statuspane
```

Or from a terminal:

```sh
claude plugin marketplace add xuanji86/claude-statuspane
claude plugin install statuspane@claude-statuspane
```

The card draws when the terminal is at least 70 columns wide. It replaces nothing: if you also
have a `statusLine` configured, both show; remove the `statusLine` entry from
`~/.claude/settings.json` if you want the card only.

## Use

| Do | What happens |
| --- | --- |
| Click `[ ▾ hide ]` / `[ ◂ status ]` | Fold the card to one button / bring it back |
| Click `[⚙]` | Settings page: click a line to switch it, `[ - ]` `[ + ]` bar width, language, `[ ✓ Done ]` |
| `/statuspane` | Same as hide / show |

The `-` at the band's top right is Claude Code's own "hide plugin panel". It hides the whole band,
and only its keybinding brings it back (default `ctrl+x ctrl+a`). If your terminal does not pass
`ctrl+x` chords through, bind it to one key in `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+s": "abovePrompt:toggle", "ctrl+q": "chat:stash" } }
  ]
}
```

(`ctrl+s` is stash by default; the example moves stash to `ctrl+q`.)

## Progress API

Two ways in. Rows are sorted by id; at most 5 show.

### 1. A JSON file — from any language

Write `~/.claude/statuspane/progress/<id>.json` (or `$STATUSPANE_PROGRESS_DIR/<id>.json`):

```json
{ "label": "build", "percent": 42.5, "text": "3/7 · 1.2/min", "ttl": 300 }
```

| Field | | |
| --- | --- | --- |
| `label` | string | Shown before the bar, up to 24 characters (defaults to the id) |
| `percent` | number, optional | 0–100. Leave it out for a text-only row |
| `text` | string, optional | Shown after the bar, up to 60 characters |
| `ttl` | seconds, optional | The row disappears this long after the file was last written (default 300) |

`<id>` is letters, digits, `.`, `_`, `-`. Write to a temporary file and rename it over the target so
the card never reads half a file. Delete the file to remove the row at once. Ready-made helpers:
[`examples/report-progress.sh`](examples/report-progress.sh) and
[`examples/report_progress.py`](examples/report_progress.py).

```sh
examples/report-progress.sh build "build" 42.5 "3/7"
```

The card reads only `*.json` files of at most 4 KB in that folder, takes text verbatim minus control
and bidi characters, and never runs anything from them.

### 2. `$.statuspane` — from another mod

List the plugin under `dependencies` in your mod's `plugin.json` (its types are then laid into your
`.claude-plugin/types/statuspane/`), and call:

```ts
await $.statuspane.progress({ id: 'my-job', label: 'my job', percent: 40, text: '4/10', ttl: 120 })
await $.statuspane.clear('my-job')
```

Same fields as the file. A row from a mod lives in memory: report again after a reload of
statuspane.

### Already reporting

- [ainiee-translate](https://github.com/xuanji86/ainiee-translate-skill) v1.14+: `progress --watch` / `--line` write its translation progress.

## Privacy

Everything stays local. The mod reads Claude Code's own session figures, runs
`git branch --show-current` in the session's directory, and lists the progress folder.

## Develop

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .        # or add the folder to CLAUDE_CODE_PLUGIN_DIRS
```

Saving a file reloads the mod in a session that loaded it from the folder.

## License

[MIT](LICENSE)
