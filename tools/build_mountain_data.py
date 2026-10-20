#!/usr/bin/env python3
"""Build ../mountain-data.js for the mountain-photo quiz.

Mountains: 日本百名山 / 日本二百名山 / 日本三百名山 as listed on ja.wikipedia (name, reading, coordinates, elevation,
prefectures, representative image). Photos come from Wikimedia Commons; only files under a free licence
(CC BY, CC BY-SA, CC0, public domain) are kept, together with the author / licence / page URL for attribution.
Usage: python3 tools/build_mountain_data.py      (needs network; cache dir /tmp/mt-cache)
"""
import json, pathlib, re, time, urllib.parse, urllib.request, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = pathlib.Path('/tmp/mt-cache'); CACHE.mkdir(exist_ok=True)
UA = {'User-Agent': 'geoguessr-japan-study/1.0 (private study project)'}

def api(host, params):
    key = CACHE / (re.sub(r'\W+', '_', host + json.dumps(params, sort_keys=True))[:150] + '.json')
    if key.exists():
        return json.load(open(key, encoding='utf-8'))
    url = f'https://{host}/w/api.php?' + urllib.parse.urlencode(dict(params, format='json', formatversion='2'))
    for i in range(5):
        try:
            time.sleep(0.3)
            d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
            json.dump(d, open(key, 'w', encoding='utf-8'), ensure_ascii=False)
            return d
        except Exception as e:
            time.sleep(3 * (i + 1))
    raise RuntimeError(url)

def wikitext(title):
    return api('ja.wikipedia.org', {'action': 'parse', 'page': title, 'prop': 'wikitext'})['parse']['wikitext']

items = []   # dicts
# ---- 日本百名山: table rows + map module (same order)
w = wikitext('日本百名山')
coords = re.findall(r'^\t([^,\n]+),(\d+\.\d+)/(\d+\.\d+)\s*$', w[w.index('{{Module|日本地図'):], re.M)[:100]
def norm(s):
    return s.replace('ヶ', 'ケ').replace('竜', '龍').replace('剣', '剱').replace('嶽', '岳')
cmap = {norm(n): (float(lon), float(lat)) for n, lon, lat in coords}
rows = []
for line in w.split('\n'):
    m = re.match(r'^\|\s*(\d+)\s*\|\|(.*)$', line)
    if not m:
        continue
    cells = [c.strip() for c in re.split(r'\s*\|\|\s*', m.group(2))]
    if len(cells) < 7:
        continue
    nm = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", cells[0])
    if nm:
        rows.append((int(m.group(1)), nm.group(1), nm.group(2) or nm.group(1), cells))
print('100:', len(coords), len(rows))
for no, title, disp, cells in rows:
    plain = re.sub(r"\[\[([^\]|]+\|)?|\]\]|'''", '', cells[0])
    c = cmap.get(norm(disp)) or cmap.get(norm(title.split(' (')[0])) or cmap.get(norm(plain))
    if not c:
        # not on the map module of the list page: take the article's own coordinates
        d = api('ja.wikipedia.org', {'action': 'query', 'titles': title, 'prop': 'coordinates', 'redirects': 1})
        co = (d['query']['pages'][0].get('coordinates') or [None])[0]
        if not co:
            print('no coordinates for', no, disp, title); continue
        c = (co['lon'], co['lat'])
    img = re.search(r'\[\[(?:File|ファイル|Image):([^|\]]+)', cells[-1])
    prefs = re.sub(r'\[\[|\]\]', '', cells[4]).replace('<br />', '/').replace('<br/>', '/')
    rd = re.search(r'\{\{smaller\|([^}]*)\}\}', cells[1])
    items.append(dict(list=1, no=no, name=re.sub(r' \(.*\)$', '', title), title=title, reading=(rd.group(1) if rd else '').strip(),
                      lon=c[0], lat=c[1], elev=int(re.sub(r'\D', '', cells[2]) or 0), prefs=prefs.strip(),
                      files=[img.group(1).strip()] if img else []))

if '黒姫山' in cmap and not any(i['name'] == '黒姫山' for i in items):
    items.append(dict(list=1, no=0, name='黒姫山', title='黒姫山 (長野県)', reading='くろひめやま', lon=cmap['黒姫山'][0], lat=cmap['黒姫山'][1],
                      elev=2053, prefs='長野県', files=[]))
# the table's reading belongs to its own display name; these use the article title as the name
READING_FIX = {'利尻山': 'りしりざん', '雌阿寒岳': 'めあかんだけ', '羊蹄山': 'ようていざん', '早池峰山': 'はやちねさん', '蔵王連峰': 'ざおうれんぽう',
               '越後駒ヶ岳': 'えちごこまがたけ', '日光白根山': 'にっこうしらねさん', '水晶岳': 'すいしょうだけ', '大菩薩嶺': 'だいぼさつれい', '荒川岳': 'あらかわだけ'}
for it in items:
    if it['name'] in READING_FIX:
        it['reading'] = READING_FIX[it['name']]
print('百名山:', len(items))

# ---- 二百 / 三百: data module rows  name/readings[/title],lon/lat,file,elev,prefs
for lst, page in ((2, '日本二百名山'), (3, '日本三百名山')):
    w = wikitext(page)
    for m in re.finditer(r'^\t([^,\n]+),(\d+\.\d+)/(\d+\.\d+),([^,\n]*),(\d+),?([^\n]*)$', w, re.M):
        parts = m.group(1).split('/')
        name = parts[0]; reading = re.sub(r'[:0-9]', '', parts[1]) if len(parts) > 1 else ''
        title = parts[2].replace('_', ' ') if len(parts) > 2 else name
        items.append(dict(list=lst, no=0, name=name, title=title, reading=reading, lon=float(m.group(2)), lat=float(m.group(3)),
                          elev=int(m.group(5)), prefs=m.group(6).strip(), files=[m.group(4).strip().replace('_', ' ')] if m.group(4).strip() else []))
print('items', len(items))

ALLOWED = re.compile(r'^(CC BY(-SA)? \d|CC0|Public domain|PD|パブリックドメイン)', re.I)
BAD_NAME = re.compile(r'map|地図|logo|icon|標識|看板|sign|flag|\.svg|\.png|\.gif|\.tif|panorama_annot|annotat|ルート|route|trail', re.I)

def strip_html(s):
    s = html.unescape(re.sub(r'<[^>]+>', '\n', s or '')).replace('\xa0', ' ')
    s = re.sub(r'^No machine-readable author provided\.\s*', '', s.strip())
    s = re.sub(r'\s+assumed.*$', '', s.split('\n')[0].strip())
    s = s.strip()
    return '' if s.endswith(':') or len(s) < 2 else s

def fileinfo(names):
    out = {}
    names = list(dict.fromkeys(names))
    for i in range(0, len(names), 40):
        chunk = names[i:i + 40]
        d = api('commons.wikimedia.org', {'action': 'query', 'titles': '|'.join('File:' + n for n in chunk), 'prop': 'imageinfo',
                                           'iiprop': 'url|size|mime|extmetadata', 'iiurlwidth': 1000})
        norm = {n['to']: n['from'] for n in d['query'].get('normalized', [])}
        for p in d['query']['pages']:
            if 'imageinfo' not in p:
                continue
            ii = p['imageinfo'][0]; md = ii.get('extmetadata', {})
            lic = md.get('LicenseShortName', {}).get('value', '')
            fname = p['title'][5:]
            src = next((f for f in chunk if f.replace('_', ' ') == fname), fname)
            out[src] = dict(ok=bool(ALLOWED.match(lic)) and 'NC' not in lic and 'ND' not in lic and ii.get('width', 0) >= 800 and ii.get('mime') == 'image/jpeg',
                           thumb=(ii.get('thumburl') or '').split('?')[0], page=ii.get('descriptionurl'), w=ii.get('width'), h=ii.get('height'),
                           author=strip_html(md.get('Artist', {}).get('value', ''))[:80], license=lic,
                           licurl=md.get('LicenseUrl', {}).get('value', ''), file=fname)
    return out

# first pass: the file named in the list
info = fileinfo([f.replace('_', ' ') for it in items for f in it['files']])
need = []
for it in items:
    it['photo'] = None
    for f in it['files']:
        i = info.get(f.replace('_', ' ')) or info.get(f)
        if i and i['ok'] and not BAD_NAME.search(i['file']):
            it['photo'] = i; break
    if not it['photo']:
        need.append(it)
print('without a usable listed photo:', len(need))

# second pass: other images of the article
for it in need:
    try:
        d = api('ja.wikipedia.org', {'action': 'query', 'titles': it['title'], 'prop': 'images', 'imlimit': 60, 'redirects': 1})
        cands = [im['title'][5:] if im['title'].startswith('File:') else im['title'].split(':', 1)[1] for p in d['query']['pages'] for im in p.get('images', [])]
        cands = [c for c in cands if re.search(r'\.jpe?g$', c, re.I) and not BAD_NAME.search(c)][:12]
        got = fileinfo(cands)
        for c in cands:
            i = got.get(c) or got.get(c.replace('_', ' '))
            if i and i['ok']:
                it['photo'] = i; break
    except Exception as e:
        print('fail', it['name'], e)
usable = [it for it in items if it['photo']]
print('with photo:', len(usable), '/', len(items))
for it in items:
    if not it['photo']:
        print('  no photo:', it['list'], it['name'], it['title'])

# readings for 百名山 come from the table; compact output
out = []
for k, it in enumerate(usable):
    p = it['photo']
    out.append([k, it['name'], re.sub(r'[0-9]', '', it['reading']), round(it['lat'], 4), round(it['lon'], 4), it['elev'], it['prefs'], it['list'],
                p['thumb'], p['page'], p['author'], p['license'], p['licurl'], it['title']])
js = ('/* 山の写真クイズ: [id, 山名, よみ, 緯度, 経度, 標高m, 都道府県, 百/二百/三百(1/2/3), 写真URL, 写真ページ, 作者, ライセンス, ライセンスURL, Wikipediaの記事名]\n'
      '   山の一覧: ja.wikipedia（日本百名山・二百名山・三百名山）／写真: Wikimedia Commons（各ファイルのライセンスに従い作者・ライセンスを表示） */\n'
      'window.MOUNTAINS=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
(ROOT / 'mountain-data.js').write_text(js, encoding='utf-8')
print('written', len(out))
