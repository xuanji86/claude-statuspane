# python3 assets/make_previews.py — draws the README mockups of the card as SVG: every text run placed and sized by terminal column.
import html, os, unicodedata
OUT = os.path.dirname(os.path.abspath(__file__))
CW, LH, FS = 8.4, 20, 14
C = dict(bg='#1b1d23', fg='#d7dae0', dim='#7f848e', border='#4b5263', mag='#c678dd', yel='#e5c07b',
         grn='#98c379', cyan='#56b6c2', red='#e06c75', btn='#3a3f4b', accent='#61afef')

def w(s):
    return sum(2 if unicodedata.east_asian_width(ch) in 'WF' else 1 for ch in s)

def run(x, y, text, color, bold=False):
    t = html.escape(text)
    b = ' font-weight="700"' if bold else ''
    return (f'<text x="{x:.1f}" y="{y}" fill="{C[color]}"{b} textLength="{w(text) * CW:.1f}" '
            f'lengthAdjust="spacingAndGlyphs">{t}</text>')

def line(x, y, parts):
    out, col = [], 0
    for text, color, *rest in parts:
        body = text.strip()
        if body:
            lead = len(text) - len(text.lstrip())
            out.append(run(x + (col + lead) * CW, y, body, color, bool(rest)))
        col += w(text)
    return out, col

def button(x, y, label, primary=False):
    width = (w(label) + 2) * CW
    fill = C['accent'] if primary else C['btn']
    fg = '#1b1d23' if primary else C['fg']
    return [f'<rect x="{x:.1f}" y="{y - 14}" width="{width:.1f}" height="19" rx="4" fill="{fill}"/>',
            f'<text x="{x + CW:.1f}" y="{y}" fill="{fg}" textLength="{w(label) * CW:.1f}" lengthAdjust="spacingAndGlyphs">{html.escape(label)}</text>'], width

def svg(name, width, height, body):
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
           f'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="{FS}">'
           f'<rect width="{width}" height="{height}" rx="10" fill="{C["bg"]}"/>'
           f'<circle cx="20" cy="18" r="5.5" fill="#ff5f57"/><circle cx="38" cy="18" r="5.5" fill="#febc2e"/><circle cx="56" cy="18" r="5.5" fill="#28c840"/>'
           + ''.join(body) + '</svg>')
    open(os.path.join(OUT, name), 'w').write(doc)

def card(name, rows, buttons, title_parts, inner_cols, transcript, width=720):
    body = []
    y = 56
    for parts in transcript:
        b, _ = line(24, y, parts); body += b; y += LH
    top = y + 6
    card_w = (inner_cols + 2) * CW + 16
    x0 = width - 24 - card_w
    h = (len(rows) + 1) * LH + 14
    body.append(f'<rect x="{x0:.1f}" y="{top}" width="{card_w:.1f}" height="{h}" rx="8" fill="none" stroke="{C["border"]}" stroke-width="1.2"/>')
    tx = x0 + 8 + CW
    ty = top + 22
    b, _ = line(tx, ty, title_parts); body += b
    bx = x0 + card_w - 8 - CW
    for label, primary in reversed(buttons):
        bw = (w(label) + 2) * CW
        bx -= bw
        b, _ = button(bx, ty, label, primary); body += b
        bx -= 6
    for i, parts in enumerate(rows):
        b, _ = line(tx, ty + (i + 1) * LH, parts); body += b
    py = top + h + 28
    body.append(run(24, py, '>', 'accent', True))
    body.append(f'<rect x="{24 + 2 * CW:.1f}" y="{py - 13}" width="{CW:.1f}" height="17" fill="{C["fg"]}" opacity="0.75"/>')
    svg(name, width, py + 22, body)

sep = (' · ', 'dim')
transcript = [
    [('● ', 'grn'), ('Updated the parser and ran the suite: 48 passed.', 'fg')],
    [('  Ready for the next step.', 'dim')],
]
card('card.svg', [
    [('ctx ', 'dim'), ('███░░░░░░░░░ 22%', 'grn'), (' 222k/1M', 'dim')],
    [('5h ', 'dim'), ('23%', 'grn'), (' ↻2h41m', 'dim'), sep, ('wk ', 'dim'), ('61%', 'yel'), (' ↻2d4h', 'dim')],
    [('~/proj', 'cyan'), sep, ('⎇ main', 'mag'), sep, ('$3.12', 'grn')],
    [('build ', 'dim'), ('██████░░░░░░ 50%', 'grn'), (' 3/6', 'fg')],
    [('📖 novel ', 'dim'), ('████████░░░░ 64%', 'grn'), (' 768/1200', 'fg')],
], [('⚙', False), ('▾ hide', False)], [('Opus 5.5 (1M)', 'mag'), sep, ('high', 'yel')], 40, transcript)

card('settings.svg', [
    [('☑ Model · effort', 'fg')],
    [('☑ Context bar', 'fg')],
    [('☑ 5h / week limits', 'fg')],
    [('☑ Reset countdowns', 'fg')],
    [('☑ Directory · branch', 'fg')],
    [('☐ Session cost', 'dim')],
    [('☑ Progress rows', 'fg')],
    [('Bar width  ', 'fg'), ('[ - ]', 'accent'), (' 12 ', 'fg'), ('[ + ]', 'accent')],
    [('Language   ', 'fg'), ('[ English ]', 'accent'), (' ', 'fg'), ('[ 中文 ]', 'dim')],
], [('✓ Done', True)], [('Status settings', 'fg', True)], 34, [])

card('hidden.svg', [], [('◂ status', False)], [], 10, transcript)


transcript_zh = [
    [('● ', 'grn'), ('已更新解析器并跑完测试：48 个全部通过。', 'fg')],
    [('  可以继续下一步了。', 'dim')],
]
card('card-zh.svg', [
    [('ctx ', 'dim'), ('███░░░░░░░░░ 22%', 'grn'), (' 222k/1M', 'dim')],
    [('5h ', 'dim'), ('23%', 'grn'), (' ↻2h41m', 'dim'), sep, ('wk ', 'dim'), ('61%', 'yel'), (' ↻2d4h', 'dim')],
    [('~/proj', 'cyan'), sep, ('⎇ main', 'mag'), sep, ('$3.12', 'grn')],
    [('build ', 'dim'), ('██████░░░░░░ 50%', 'grn'), (' 3/6', 'fg')],
    [('📖 小说 ', 'dim'), ('████████░░░░ 64%', 'grn'), (' 768/1200', 'fg')],
], [('⚙', False), ('▾ 收起', False)], [('Opus 5.5 (1M)', 'mag'), sep, ('high', 'yel')], 40, transcript_zh)

card('settings-zh.svg', [
    [('☑ 模型 · effort', 'fg')],
    [('☑ 上下文进度条', 'fg')],
    [('☑ 5h / week 额度', 'fg')],
    [('☑ 重置倒计时', 'fg')],
    [('☑ 目录 · 分支', 'fg')],
    [('☐ 会话花费', 'dim')],
    [('☑ 进度条接入', 'fg')],
    [('进度条长度 ', 'fg'), ('[ - ]', 'accent'), (' 12 ', 'fg'), ('[ + ]', 'accent')],
    [('语言       ', 'fg'), ('[ English ]', 'dim'), (' ', 'fg'), ('[ 中文 ]', 'accent')],
], [('✓ 完成', True)], [('状态卡设置', 'fg', True)], 34, [])

card('hidden-zh.svg', [], [('◂ 状态', False)], [], 10, transcript_zh)
