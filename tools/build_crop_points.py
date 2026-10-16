#!/usr/bin/env python3
"""Write ../crop-points.js from landforms.py: [lat, lon, prefCode, name, type]"""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from landforms import L, READINGS

pts = [[la, lo, f'{pc:02d}', n, t, READINGS[n]] for pc, n, t, la, lo in L]
js = ('/* 切り抜きクイズの出題地点（各都道府県の主要な平野・盆地・山地・高原・半島・島など）: [緯度, 経度, 県コード, 地形名, 種類, 読み] */\n'
      'window.CROP_POINTS=' + json.dumps(pts, ensure_ascii=False, separators=(',', ':')) + ';\n')
out = pathlib.Path(__file__).resolve().parent.parent / 'crop-points.js'
out.write_text(js, encoding='utf-8')
print(len(pts), 'points ->', out)
