#!/usr/bin/env python3
"""Build ../drop-points.js: city / ward / town / village offices (市役所・区役所・町役場・村役場) for the terrain GeoGuessr.

Each point is [lat, lon, prefCode, officeName, elevationM]. Positions come from OpenStreetMap (amenity=townhall,
via Overpass, ODbL); the prefecture and the ward's city name come from the nearest town in town-data/; the elevation
from the AWS terrarium DEM. Usage:  python3 tools/build_office_points.py  [osm.json]
(without an argument the Overpass API is queried).
"""
import glob, io, json, math, pathlib, re, sys, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
Z = 11

if len(sys.argv) > 1:
    osm = json.load(open(sys.argv[1], encoding='utf-8'))['elements']
else:
    q = ('[out:json][timeout:240];area["ISO3166-1"="JP"][admin_level=2]->.a;'
         '(nwr["amenity"="townhall"]["name"~"(市役所|区役所|町役場|村役場)$"](area.a););out center tags;')
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(),
                                 headers={'User-Agent': 'geoguessr-japan-study/1.0'})
    osm = json.loads(urllib.request.urlopen(req, timeout=300).read())['elements']

towns = []  # (lat, lon, prefCode, city)
CITY_PREFS = {}   # municipality name -> prefectures that have one
for fn in sorted(glob.glob(str(ROOT / 'town-data' / '*.json'))):
    d = json.load(open(fn, encoding='utf-8'))
    for c in d['cities']:
        CITY_PREFS.setdefault(c['name'], set()).add(d['code'])
        for t in c['towns']:
            towns.append((t[1], t[2], d['code'], c['name']))
K = math.cos(math.radians(36))
tree = cKDTree(np.array([(t[0], t[1] * K) for t in towns]))

tile_cache = {}
def elevation(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    tx, ty = int(x), int(y)
    if (tx, ty) not in tile_cache:
        u = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png'
        for i in range(4):
            try:
                b = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'geoguessr-japan-study/1.0'}), timeout=30).read()
                im = np.array(Image.open(io.BytesIO(b)).convert('RGB'), dtype=np.float64)
                tile_cache[(tx, ty)] = im[:, :, 0] * 256 + im[:, :, 1] + im[:, :, 2] / 256 - 32768
                break
            except Exception:
                time.sleep(2 * (i + 1))
        else:
            return 0.0
    arr = tile_cache[(tx, ty)]
    return float(arr[min(255, int((y - ty) * 256)), min(255, int((x - tx) * 256))])

def tile_of(lat, lon):
    n = 2 ** Z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

from concurrent.futures import ThreadPoolExecutor
need = {tile_of(e.get('lat') or e['center']['lat'], e.get('lon') or e['center']['lon']) for e in osm}
def fetch(k):
    elevation(*tile_center(k))
def tile_center(k):
    n = 2 ** Z
    lon = (k[0] + .5) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (k[1] + .5) / n))))
    return lat, lon
with ThreadPoolExecutor(12) as ex:
    list(ex.map(fetch, need))
print('tiles', len(tile_cache), '/', len(need), flush=True)

out, seen = [], set()
for e in osm:
    name = e['tags']['name'].strip()
    lat = e.get('lat') or e['center']['lat']; lon = e.get('lon') or e['center']['lon']
    dist, idx = tree.query([lat, lon * K])
    if dist * 111 > 60:
        continue            # nothing of Japan nearby (stray / foreign mapping)
    tlat, tlon, pref, city = towns[idx]
    if name.startswith('旧'):
        continue            # former municipalities
    base = re.sub(r'(役所|役場)$', '', name)
    cands = CITY_PREFS.get(base)
    if cands and pref not in cands:
        if len(cands) == 1: pref = next(iter(cands))   # the nearest town sat across a prefecture border
    if name.endswith('区役所') and '市' not in name and city.endswith('区'):
        name = city + '役所'    # bare "北区役所" is ambiguous: take the ward's full name from the nearest town
    key = (pref, name)
    if key in seen:
        continue
    seen.add(key)
    out.append([round(lat, 5), round(lon, 5), pref, name, int(round(max(0.0, elevation(lat, lon))))])
out.sort(key=lambda p: (p[2], p[3]))
js = ('/* 地形だけのGeoGuessr: 市区町村の役所の位置 [緯度, 経度, 県コード, 役所名, 標高m]（OpenStreetMap © contributors, ODbL）*/\n'
      'window.DROP_POINTS=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
(ROOT / 'drop-points.js').write_text(js, encoding='utf-8')
print('total', len(out))
