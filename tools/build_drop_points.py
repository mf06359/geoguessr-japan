#!/usr/bin/env python3
"""Build ../drop-points.js: places to "drop" the person in the terrain-only GeoGuessr.

Each point is [lat, lon, prefCode, label, elevationM]; it is verified to be on land (>= MIN_ELEV m) from the
same AWS terrarium DEM the page renders. Run from the project root:  python3 tools/build_drop_points.py
"""
import glob, io, json, math, pathlib, random, time, urllib.request
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIN_ELEV = 8.0          # metres: clearly land, not the shoreline
Z = 11                  # DEM tile zoom used for the elevation check (~75 m pixels)
random.seed(20261017)

# towns (on land) with their prefecture
towns = []  # (lat, lon, pref, label)
for fn in sorted(glob.glob(str(ROOT / 'town-data' / '*.json'))):
    d = json.load(open(fn, encoding='utf-8'))
    for c in d['cities']:
        for t in c['towns']:
            towns.append((t[1], t[2], d['code'], f"{d['name']} {c['name']} {t[0]}付近"))
K = math.cos(math.radians(36))
tree = cKDTree(np.array([(t[0], t[1] * K) for t in towns]))

tile_cache = {}
def elevation(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    tx, ty = int(x), int(y)
    key = (tx, ty)
    if key not in tile_cache:
        u = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png'
        for i in range(4):
            try:
                time.sleep(0.05)
                b = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'geoguessr-japan-study/1.0'}), timeout=30).read()
                im = np.array(Image.open(io.BytesIO(b)).convert('RGB'), dtype=np.float64)
                tile_cache[key] = im[:, :, 0] * 256 + im[:, :, 1] + im[:, :, 2] / 256 - 32768
                break
            except Exception:
                time.sleep(2 * (i + 1))
        else:
            return None
    arr = tile_cache[key]
    px = min(255, int((x - tx) * 256)); py = min(255, int((y - ty) * 256))
    return float(arr[py, px])

PER_PREF = {13: 4, 27: 4, 23: 8, 14: 8, 11: 8, 12: 8, 1: 22, 20: 18, 15: 14, 7: 14}
DEFAULT = 12
by_pref = {}
for t in towns:
    by_pref.setdefault(t[2], []).append(t)

out = []
for pc in sorted(by_pref):
    want = PER_PREF.get(int(pc), DEFAULT)
    pool = by_pref[pc]
    chosen = []
    tries = 0
    while len(chosen) < want and tries < want * 60:
        tries += 1
        lat0, lon0, _, _ = random.choice(pool)
        # half the points sit in towns' surroundings, half further out (hills, valleys, mountains)
        rad_km = random.uniform(0, 2) if random.random() < 0.4 else random.uniform(3, 22)
        ang = random.uniform(0, 2 * math.pi)
        lat = lat0 + rad_km * math.cos(ang) / 110.57
        lon = lon0 + rad_km * math.sin(ang) / (111.32 * math.cos(math.radians(lat0)))
        dist, idx = tree.query([lat, lon * K])
        if dist * 111 > 25:          # too far from any settlement (open sea / foreign land)
            continue
        nt = towns[idx]
        if nt[2] != pc:              # crossed into another prefecture
            continue
        e = elevation(lat, lon)
        if e is None or e < MIN_ELEV:
            continue
        if any(math.hypot((lat - c[0]) * 111, (lon - c[1]) * 91) < 6 for c in chosen):
            continue
        chosen.append((lat, lon, nt[3], e))
    for lat, lon, label, e in chosen:
        out.append([round(lat, 4), round(lon, 4), pc, label, int(round(e))])
    print(pc, len(chosen), '/', want, flush=True)

# extra points on mountains / volcanoes / plateaus / basins from the landform list (towns rarely sit in the high country)
import sys
sys.path.insert(0, str(ROOT / 'tools'))
from landforms import L as LANDFORMS
extra = 0
for pc_i, name, typ, la, lo in LANDFORMS:
    if typ not in ('mountain', 'volcano', 'plateau', 'basin'):
        continue
    for _ in range(40):
        rad_km = random.uniform(0, 5)
        ang = random.uniform(0, 2 * math.pi)
        lat = la + rad_km * math.cos(ang) / 110.57
        lon = lo + rad_km * math.sin(ang) / (111.32 * math.cos(math.radians(la)))
        e = elevation(lat, lon)
        if e is None or e < MIN_ELEV:
            continue
        pc = f'{pc_i:02d}'
        if any(math.hypot((lat - c[0]) * 111, (lon - c[1]) * 91) < 6 for c in out if c[2] == pc):
            continue
        out.append([round(lat, 4), round(lon, 4), pc, f'{name}付近', int(round(e))])
        extra += 1
        break
print('extra landform points', extra)

js = ('/* 地形だけのGeoGuessr: 人を落とす地点 [緯度, 経度, 県コード, 近くの地名, 標高m]（標高データで陸地を確認済み）*/\n'
      'window.DROP_POINTS=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
(ROOT / 'drop-points.js').write_text(js, encoding='utf-8')
print('total', len(out))
