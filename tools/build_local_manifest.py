#!/usr/bin/env python3
"""Build local-photos/manifest.json for the pole quiz/notes (private, local use only).

Layout:  local-photos/<company-id>/<anything>.jpg|png|webp
         optional caption file with the same stem:  <anything>.txt
           line 1 = what to look at (shown after answering), line 2 = credit/source (optional)

company-id: hokkaido tohoku tokyo hokuriku chubu kansai chugoku shikoku kyushu okinawa
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'local-photos'
COMPANIES = 'hokkaido tohoku tokyo hokuriku chubu kansai chugoku shikoku kyushu okinawa'.split()
EXT = {'.jpg', '.jpeg', '.png', '.webp'}

items = []
for cid in COMPANIES:
    d = ROOT / cid
    if not d.is_dir():
        continue
    for f in sorted(d.iterdir()):
        if f.suffix.lower() not in EXT:
            continue
        lines = []
        txt = f.with_suffix('.txt')
        if txt.exists():
            lines = [l.strip() for l in txt.read_text(encoding='utf-8').splitlines() if l.strip()]
        items.append({
            'company': cid,
            'file': f'{cid}/{f.name}',
            'caption': lines[0] if lines else '',
            'credit': lines[1] if len(lines) > 1 else '',
        })

ROOT.mkdir(exist_ok=True)
(ROOT / 'manifest.json').write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'{len(items)} photos -> {ROOT / "manifest.json"}')
