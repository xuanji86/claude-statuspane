<div align="center">

# statuspane

**A floating status card for Claude Code.**<br>
Model, context, rate limits, cost and branch at a glance, your GitHub CI and deploys, plus progress bars any script can feed.

[![Version](https://img.shields.io/badge/version-1.3.1-61afef.svg)](https://github.com/xuanji86/claude-statuspane/releases)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-c678dd.svg)](https://code.claude.com/docs/en/plugins/mods/overview)
[![License: MIT](https://img.shields.io/badge/license-MIT-98c379.svg)](LICENSE)

**English** · [中文](README.zh-CN.md)

<img src="assets/card.svg" alt="The status card above the Claude Code prompt" width="720">

</div>

## Why

Claude Code's `statusLine` is one line of text from a shell script. **statuspane** is a
[mod](https://code.claude.com/docs/en/plugins/mods/overview): a small card that lives just above the
prompt, reads Claude Code's own session figures, and can be clicked — no script to write.

## Features

| | |
| --- | --- |
| **Model · effort** | The model in use, whether Claude is working, and its reasoning effort on a gauge (`▮▮▮▯▯ high`) |
| **Context** | A gauge with tokens used / window (`▰▰▰▱▱▱ 42% 222k/1M`), and `⟲ compact`: press, then `confirm`, to run `/compact` (after the turn, if Claude is working) |
| **Rate limits** | 5-hour and 7-day use, each on a small gauge, with reset countdowns (`↻2h41m`) |
| **Where you are** | Directory and git branch, shortened so the card stays narrow |
| **Session cost** | What this session has cost so far |
| **GitHub CI** | The branch's latest Actions run and the runs a push sets off, deploys included ([GitHub CI](#github-ci)) |
| **Progress rows** | Bars any script or mod can feed, refreshed every second ([Progress API](#progress-api)) |
| **Clickable** | Hide, show and settings are buttons; everything works with the mouse |
| **Settings** | Pick the lines you want and the bar width; saved across sessions |

It is drawn in Claude Code's own theme colors, so it follows dark, light and colorblind themes: gauges in Claude's
accent, turning to the theme's warning color from 60 % and its error color from 85 % (context: 50 % / 80 %).

## Install

Needs **Claude Code 2.1.287 or later**, the release that brought mods (function hooks); tested on 2.1.288. Mods are
early access: their API may change between releases, and a release that breaks the card gets a fix here.

```text
/plugin marketplace add xuanji86/claude-statuspane
/plugin install statuspane@claude-statuspane
```

<details>
<summary>From a terminal instead</summary>

```sh
claude plugin marketplace add xuanji86/claude-statuspane
claude plugin install statuspane@claude-statuspane
```

</details>

The card appears in terminals at least 70 columns wide; the desktop app shows none, since it has its own. It adds to your setup and replaces nothing:
a configured `statusLine` keeps showing; delete it from `~/.claude/settings.json` if you want the
card alone.

## Use

<table>
<tr>
<td width="50%" valign="top">

**Settings** — click `⚙`

<img src="assets/settings.svg" alt="The settings page" width="100%">

Click a line to switch it, `[ - ]` / `[ + ]` for the bar width (6–24), then `✓ Done`.

</td>
<td width="50%" valign="top">

**Hidden** — click `▾ hide`

<img src="assets/hidden.svg" alt="The card folded to one button" width="100%">

One button stays at the right edge; click `◂ status` to bring the card back. `/statuspane` does the
same from the prompt.

</td>
</tr>
</table>

<details>
<summary><b>Tip:</b> the <code>-</code> at the panel's corner, and a one-key shortcut</summary>

The `-` at the top right of the panel is Claude Code's own "hide plugin panel". It hides the whole
panel, and only its keybinding brings it back (default `ctrl+x ctrl+a`). If your terminal doesn't
pass `ctrl+x` chords through, bind it to one key in `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+s": "abovePrompt:toggle", "ctrl+q": "chat:stash" } }
  ]
}
```

`ctrl+s` is "stash" by default, so the example moves stash to `ctrl+q`.

</details>

## GitHub CI

Two switches on the settings page, both off until you turn them on. They need the
[GitHub CLI](https://cli.github.com) signed in (`gh auth login`).

| Switch | Shows |
| --- | --- |
| **CI · this branch** | The latest Actions run of the branch the session is on: checked every minute, every 10 seconds while it runs |
| **CI · after a push** | When Claude runs `git push` or `gh pr merge`, the runs that set off (for a merge, on the base branch) until they finish; the result stays for 10 minutes |

Each row reads `<repo> <branch>` and then:

| | |
| --- | --- |
| `⟳ test · 1m20s` | accent: under way, with the jobs running now and the time so far |
| `⟳ deploying · 1m20s` | a job whose name has *deploy* in it is running |
| `✓ deployed · 3m ago` | green: done, and a *deploy* job succeeded (`✓ passed` when none ran) |
| `✗ test failed · 3m ago` | red: the job (or workflow) that failed |
| `⊘ cancelled · 3m ago` | every run was cancelled or skipped |

All of one commit's workflows make one row; scheduled runs are left out.

## Progress API

Show your own progress on the card, from any language or from another mod. Rows are sorted by id,
at most five show, and each one goes away by itself once its source stops reporting. The card reads
the 20 most recently written files, so old files left behind never crowd out a new one.

### From any script: a JSON file

Write `~/.claude/statuspane/progress/<id>.json` (the folder can be moved with
`STATUSPANE_PROGRESS_DIR`, an absolute path or one starting with `~/`):

```json
{ "label": "build", "percent": 42.5, "text": "3/7 · 1.2/min", "ttl": 300, "state": "running" }
```

| Field | Type | |
| --- | --- | --- |
| `label` | string | Shown before the bar, up to 24 characters (defaults to the id) |
| `percent` | number, optional | 0–100. Leave it out for a text-only row |
| `text` | string, optional | Shown after the bar, up to 60 characters |
| `ttl` | seconds, optional | How long the row stays after the file was last written (default 300) |
| `state` | string, optional | `running` (accent), `ok` (green) or `error` (red): colors the gauge and the text |

`<id>` uses letters, digits, `.`, `_` and `-`. Write to a temporary file and rename it over the
target so the card never reads half a file; delete the file to remove the row at once.

Ready-made helpers in [`examples/`](examples) (they check the id, cut fields to length and
write atomically; the shell one needs `python3`):

```sh
examples/report-progress.sh build "build" 42.5 "3/7"            # id label [percent] [text] [ttl] [state]
```

```python
from report_progress import report, clear
report("my-job", "my job", 40, "4/10", state="running")
clear("my-job")
```

### From another mod: `$.statuspane`

List `statuspane` under `dependencies` in your mod's `plugin.json` (its types are then laid into
your `.claude-plugin/types/statuspane/`), and call:

```ts
await $.statuspane.progress({ id: 'my-job', label: 'my job', percent: 40, text: '4/10', ttl: 120, state: 'running' })
await $.statuspane.clear('my-job')
```

Same fields as the file. Rows from a mod live in memory, so report again after statuspane reloads.

### Already reporting

- [**ainiee-translate**](https://github.com/xuanji86/ainiee-translate-skill) v1.14+ — `progress --watch` / `--line` show translation progress.

## Privacy and safety

Everything stays on your machine. statuspane reads Claude Code's own session figures, runs
`git branch --show-current` in the session's directory, and lists the progress folder. Only with a
CI switch on does it reach out: it reads the `origin` remote and runs `gh run list` / `gh run view`
(and `gh pr view` after a merge) for that repository, through `gh` and your own sign-in. From that
folder it reads only `*.json` files of at most 64 KB, strips control, bidi and zero-width characters
from their text, cuts every field to length, and never runs anything they contain.

## Develop

```sh
git clone https://github.com/xuanji86/claude-statuspane
cd claude-statuspane
claude plugin validate .
claude plugin test .
claude --plugin-dir .        # or add the folder to CLAUDE_CODE_PLUGIN_DIRS
```

A session that loaded the mod from its folder reloads it each time you save a file. Issues and pull
requests are welcome.

## License

[MIT](LICENSE) © Anji Xu
