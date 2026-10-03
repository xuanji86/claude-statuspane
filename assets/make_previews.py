# python3 assets/make_previews.py — draws the README previews of the card, matched to a real
# terminal (dark theme): every run placed and sized by terminal column.
import html, os, unicodedata

OUT = os.path.dirname(os.path.abspath(__file__))
CW, LH, FS, PAD = 8.4, 19, 14, 18
C = dict(bg='#1c1c27', fg='#c8d0f0', dim='#8e8e8e', border='#686b80', accent='#a9b1fa',
         # Claude Code's dark theme, by the keys the card uses
         claude='#d77757', success='#4eba65', warning='#ffc107', error='#ff6b80', subtle='#505050')


def w(s):
    return sum(2 if unicodedata.east_asian_width(ch) in 'WF' else 1 for ch in s)


def runs(col0, row, parts):
    """parts: (text, color[, bold]) laid left to right from column col0 on text row `row`."""
    out, col = [], col0
    for text, color, *bold in parts:
        body = text.strip()
        if body:
            lead = len(text) - len(text.lstrip())
            x, y = PAD + (col + lead) * CW, PAD + 14 + row * LH
            b = ' font-weight="700"' if bold else ''
            out.append(f'<text x="{x:.1f}" y="{y}" fill="{C[color]}"{b} textLength="{w(body) * CW:.1f}" '
                       f'lengthAdjust="spacingAndGlyphs">{html.escape(body)}</text>')
        col += w(text)
    return out, col


def frame(col, row, cols, rows):
    """A rounded border, in Claude's accent, around `rows` text rows of `cols` columns (one column of padding inside)."""
    x, y = PAD + (col - 1.5) * CW, PAD + row * LH - 4
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{(cols + 3) * CW:.1f}" height="{(rows + 1) * LH + 2}" '
            f'rx="7" fill="none" stroke="{C["claude"]}" stroke-width="1.2"/>')


def draw(name, total_cols, total_rows, items):
    width, height = PAD * 2 + total_cols * CW, PAD * 2 + total_rows * LH
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" '
           f'viewBox="0 0 {width:.0f} {height:.0f}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" '
           f'font-size="{FS}"><rect width="100%" height="100%" rx="10" fill="{C["bg"]}"/>' + ''.join(items) + '</svg>')
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        f.write(doc)


def gauge(pct, width, color='claude'):
    on = int(pct * width / 100 + 0.5)
    return [('▰' * on, color), ('▱' * (width - on), 'subtle')]


def scene(name, lines, inner, framed=True, buttons_row0=()):
    """lines: rows of parts; the card sits at the right of a 64-column terminal, the prompt below."""
    total = 64
    col0 = total - inner - 3
    items = []
    items += runs(total - 3, 0, [('[-]', 'dim')])[0]                       # Claude Code's own panel toggle
    top = 1 if framed else 0                                               # a folded card shares the toggle's row
    if not framed:
        col0 = total - inner - 5
    if framed:
        items.append(frame(col0, top, inner, len(lines)))
    for i, parts in enumerate(lines):
        r, used = runs(col0, top + i, parts)
        items += r
        if i == 0 and buttons_row0:
            bw = sum(w(t) for t, *_ in buttons_row0)
            items += runs(col0 + inner - bw, top, buttons_row0)[0]
    prompt = top + len(lines) + 1
    items.append(f'<line x1="{PAD}" y1="{PAD + prompt * LH - 2}" x2="{PAD + total * CW:.1f}" y2="{PAD + prompt * LH - 2}" stroke="{C["border"]}" stroke-width="1"/>')
    items += runs(0, prompt, [('>', 'fg', 1)])[0]
    items.append(f'<rect x="{PAD + 2 * CW:.1f}" y="{PAD + prompt * LH + 2}" width="{CW:.1f}" height="16" fill="{C["fg"]}" opacity="0.7"/>')
    draw(name, total, prompt + 1, items)


sep = (' · ', 'dim')


def card_lines(novel):
    return [
        [('Opus 5.5 (1M)', 'claude', 1)],
        [('effort ', 'dim'), ('▮▮▮▯▯ ', 'claude'), ('high', 'claude', 1)],
        [('ctx ', 'dim'), *gauge(15, 12), (' 15%', 'fg', 1), (' 148k/1M', 'dim')],
        [('5h ', 'dim'), *gauge(9, 5), (' 9% ↻0h45m', 'dim'), ('   ', 'fg'),
         ('7d ', 'dim'), *gauge(67, 5, 'warning'), (' 67%', 'warning'), (' ↻19h25m', 'dim')],
        [('~/proj', 'fg'), sep, ('⎇ main', 'fg'), sep, ('$0.87', 'fg')],
        [(f'📖 {novel} ', 'dim'), *gauge(64, 12), (' 64%', 'fg'), (' 768/1200', 'fg')],
        [('osa-api main ', 'dim'), ('⟳ deploying · 1m20s', 'claude')],
        [('proj main ', 'dim'), ('✓ passed · 3m ago', 'success')],
    ]


def settings_lines(t):
    rows = [[(t[0], 'claude', 1)]] + [[(('☐ ' if i in (5, 7) else '☑ ') + label, 'fg')] for i, label in enumerate(t[1:10])]
    rows.append([(t[10] + ' ', 'fg'), ('[ - ]', 'fg'), (' 12 ', 'fg'), ('[ + ]', 'fg')])
    done = f'[ {t[11]} ]'
    rows.append([(' ' * (34 - w(done)), 'fg'), (done, 'accent', 1)])
    return rows


EN = ['Status settings', 'Model · effort', 'Context bar', '5h / week limits', 'Reset countdowns',
      'Directory · branch', 'Session cost', 'Progress rows', 'CI · this branch', 'CI · after a push', 'Bar width', '✓ Done']
scene('card.svg', card_lines('novel'), 41, buttons_row0=[('● working', 'claude'), ('  ⚙  ', 'dim'), ('▾ hide', 'dim')])
scene('settings.svg', settings_lines(EN), 34)
scene('hidden.svg', [[('[ ◂ status ]', 'dim')]], w('[ ◂ status ]'), framed=False)
