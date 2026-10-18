#!/usr/bin/env python3
"""Build muni-boundaries/all.json and muni-boundaries/readings.json for the municipality quiz (nationwide / regional scopes).

Inputs (download first):
  topo.json  smartnews-smri/japan-topography  data/municipality/topojson/s0010/N03-21_210101.json  (国土数値情報 N03 を加工)
  latest.csv geolonia/japanese-addresses       data/latest.csv  (市区町村名・カナ)
Usage: python3 tools/build_muni_all.py topo.json latest.csv
Output schema:
  all.json      {viewBox, munis:[{code, name, p (prefecture code, unpadded), q (0 = never asked), d (svg path)}], borders:{p: svg path}}
  readings.json {code: [郡のよみ(ひらがな) or "", 名前のよみ(ひらがな)]}
"""
import csv, json, math, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
topo = json.load(open(sys.argv[1], encoding='utf-8'))
K = 400.0                 # svg units per degree of latitude (~280 m)
LON0, LAT1 = 122.9, 45.7
COS = math.cos(math.radians(35.5))

kana = {}
for r in csv.DictReader(open(sys.argv[2], encoding='utf-8')):
    kana[r['市区町村コード']] = (r['市区町村名'], r['市区町村名カナ'])

def hira(s):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in s)

# ---- decode arcs to lon/lat
sx, sy = topo['transform']['scale']; tx, ty = topo['transform']['translate']
arcs = []
for a in topo['arcs']:
    x = y = 0; pts = []
    for dx, dy in a:
        x += dx; y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)

def ring_pts(idxs):
    out = []
    for i in idxs:
        pts = arcs[i] if i >= 0 else arcs[~i][::-1]
        out.extend(pts if not out else pts[1:])
    return out

def proj(p):
    return (round((p[0] - LON0) * COS * K), round((LAT1 - p[1]) * K))

def path_of(rings, close):
    d = []
    for pts in rings:
        q = []
        for p in map(proj, pts):
            if not q or q[-1] != p:
                q.append(p)
        if close and len(q) > 1 and q[0] == q[-1]:
            q.pop()
        if len(q) < (3 if close else 2):
            continue
        s = 'M%d %d' % q[0]
        s += 'l' + ' '.join('%d %d' % (b[0] - a[0], b[1] - a[1]) for a, b in zip(q, q[1:]))
        d.append(s + ('z' if close else ''))
    return ''.join(d)

geoms = list(topo['objects'].values())[0]['geometries']
by_code = {}
arc_users = {}   # arc index -> list of (geometry id, pref)
for gi, g in enumerate(geoms):
    pr = g['properties']; code = pr.get('N03_007')
    if not code:
        continue
    polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
    for poly in polys:
        for ring in poly:
            for i in ring:
                arc_users.setdefault(i if i >= 0 else ~i, []).append((gi, code[:2]))
    rings = []
    for poly in polys:
        for ring in poly:
            pts = ring_pts(ring)
            if code == '13421' and sum(p[0] for p in pts) / len(pts) > 146:
                continue            # 南鳥島 etc. would stretch the map far into the Pacific
            rings.append(pts)
    e = by_code.setdefault(code, {'pr': pr, 'rings': []})
    e['rings'].extend(rings)

# a few municipalities are missing from latest.csv's readings
EXTRA = {'13362': ('利島村', 'トシマムラ'), '43506': ('球磨郡湯前町', 'クマグンユノマエマチ')}
for c, v in EXTRA.items():
    kana.setdefault(c, v)
NEVER = {'01695', '01696', '01697', '01698', '01699', '01700'}   # 北方領土 (not asked)

munis, readings = [], {}
for code in sorted(by_code):
    e = by_code[code]; pr = e['pr']
    name = kana.get(code, (None, None))[0]
    if not name:
        g3, g4 = pr.get('N03_003') or '', pr.get('N03_004') or ''
        name = g3 + g4 if (g3.endswith('郡') or g4.endswith('区') and g3.endswith('市')) else g4
    d = path_of(e['rings'], True)
    if not d:
        continue
    munis.append({'code': code, 'name': name, 'p': str(int(code[:2])), 'q': 0 if code in NEVER else 1, 'd': d})
    if code in kana and code not in NEVER:
        full, kn = kana[code]
        gun = pr.get('N03_003') or ''
        if gun.endswith('郡') and full.startswith(gun):
            # split the reading at the 郡 (グン); 北群馬郡 contains グン twice, no municipality name does
            pos = kn.rindex('グン')
            readings[code] = [hira(kn[:pos + 2]), hira(kn[pos + 2:])]
        else:
            readings[code] = ['', hira(kn)]

# prefecture borders and coastline: arcs used by one geometry, or by geometries of different prefectures
borders = {}
for ai, users in arc_users.items():
    prefs = {p for _, p in users}
    if len(users) == 1 or len(prefs) > 1:
        for p in prefs:
            borders.setdefault(str(int(p)), []).append(arcs[ai])
borders = {p: path_of(v, False) for p, v in borders.items()}

xs = ys = None
vb_w = round((154 - LON0) * COS * K); vb_h = round((LAT1 - 24.0) * K)
# viewBox fitted to the main islands (cuts the empty Pacific east of 146E)
vb_w = round((146.2 - LON0) * COS * K)
out = {'viewBox': '0 0 %d %d' % (vb_w, vb_h), 'munis': munis, 'borders': borders}
(ROOT / 'muni-boundaries' / 'all.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
(ROOT / 'muni-boundaries' / 'readings.json').write_text(json.dumps(readings, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(len(munis), 'municipalities,', sum(1 for m in munis if not m['q']), 'never asked;', len(readings), 'readings')
