/* 3D（地形）地図の共通部品。MapLibre GL JS 用スタイルを作る。
 * 標高: AWS Open Data「Terrain Tiles」(terrarium) ／ 地図: 国土地理院タイル。いずれもAPIキー不要。 */
(function (root) {
  var GSI = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
  var DEM_ATTR = '標高: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles (AWS Open Data)</a>';
  var DEM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];

  var SEA_COLOR = '#0f172a';       // the void around the map (also used for "no sea")
  var FLAT_SEA = '#6aa5d6';        // flat sea surface
  var FOREIGN_FLAT = '#4b5563';    // foreign land (no relief data) when the sea is shown
  // rough outline (lon, lat) of the Asian mainland / Korea west of the Sea of Japan; the eastern edge runs through open sea
  var FOREIGN_LAND = [[118, 32.8], [126.8, 32.8], [128.2, 34.3], [129.2, 35.0], [130.4, 36.5], [133.5, 41.0], [139.6, 45.7], [139.6, 48.0], [118, 48.0], [118, 32.8]];

  // "dem0://" tiles = the same terrarium DEM with everything below sea level flattened to 0 m,
  // so the sea floor disappears from the 3D terrain.
  var FLAT_BUF = null, CLEAR_BUF = null;
  function flatTile() {
    if (!FLAT_BUF) FLAT_BUF = new Promise(function (res) {
      var c = document.createElement('canvas'); c.width = c.height = 256;
      var x = c.getContext('2d'); x.fillStyle = 'rgb(128,0,0)'; x.fillRect(0, 0, 256, 256);
      c.toBlob(res, 'image/png');
    }).then(function (b) { return b.arrayBuffer(); });
    return FLAT_BUF.then(function (b) { return { data: b.slice(0) }; });
  }
  function clearTile() {
    if (!CLEAR_BUF) {
      var bin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
      var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      CLEAR_BUF = u.buffer;
    }
    return Promise.resolve({ data: CLEAR_BUF.slice(0) });
  }
  function tileOverlaps(z, x, y, r) {
    var n = Math.pow(2, z);
    function lat(yy) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))) * 180 / Math.PI; }
    var lon0 = x / n * 360 - 180, lon1 = (x + 1) / n * 360 - 180, latTop = lat(y), latBot = lat(y + 1);
    return !(lon1 < r[0] || lon0 > r[2] || latTop < r[1] || latBot > r[3]);
  }

  var protocolReady = false;
  function ensureProtocol() {
    if (protocolReady || !root.maplibregl || !maplibregl.addProtocol) return;
    protocolReady = true;
    maplibregl.addProtocol('dem0', function (params, abort) {
      var url = params.url.replace(/^dem0:\/\//, 'https://');
      return fetch(url, { signal: abort && abort.signal })
        .then(function (r) { if (!r.ok) throw new Error('dem ' + r.status); return r.blob(); })
        .then(function (b) { return createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); })
        .then(function (bmp) {
          var c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height;
          var x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(bmp, 0, 0);
          var im = x.getImageData(0, 0, c.width, c.height), d = im.data;
          // terrarium: elevation = R*256 + G + B/256 - 32768  ->  R < 128 means below sea level
          for (var i = 0; i < d.length; i += 4) {
            if (d[i] < 128) { d[i] = 128; d[i + 1] = 0; d[i + 2] = 0; }
          }
          x.putImageData(im, 0, 0);
          return new Promise(function (res) { c.toBlob(res, 'image/png'); });
        })
        .then(function (b) { return b.arrayBuffer(); })
        .then(function (buf) { return { data: buf }; });
    });

    // "demcut://...?r=minLon,minLat,maxLon,maxLat": like dem0, but everything outside the lon/lat rectangle is flattened
    // to 0 m, so only the rectangular block of terrain stands up.
    maplibregl.addProtocol('demcut', function (params, abort) {
      var m = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png\?r=([-\d.,]+)(?:&c=([-\d.,]+))?/.exec(params.url);
      if (!m) return Promise.reject(new Error('bad demcut url'));
      var z = +m[1], x = +m[2], y = +m[3], r = m[4].split(',').map(Number), n = Math.pow(2, z);
      var circ = m[5] ? m[5].split(',').map(Number) : null; // [lon, lat, radiusKm]
      function lat(yy) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))) * 180 / Math.PI; }
      var lon0 = x / n * 360 - 180, lon1 = (x + 1) / n * 360 - 180, latTop = lat(y), latBot = lat(y + 1);
      var overlap = !(lon1 < r[0] || lon0 > r[2] || latTop < r[1] || latBot > r[3]);
      function toBuf(c) {
        return new Promise(function (res) { c.toBlob(res, 'image/png'); })
          .then(function (b) { return b.arrayBuffer(); }).then(function (buf) { return { data: buf }; });
      }
      if (!overlap) return flatTile();
      var url = 'https://' + params.url.replace(/^demcut:\/\//, '').replace(/\?r=.*$/, '');
      return fetch(url, { signal: abort && abort.signal })
        .then(function (rr) { if (!rr.ok) throw new Error('dem ' + rr.status); return rr.blob(); })
        .then(function (b) { return createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); })
        .then(function (bmp) {
          var w = bmp.width, h = bmp.height;
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          var cx = c.getContext('2d', { willReadFrequently: true });
          cx.drawImage(bmp, 0, 0);
          var im = cx.getImageData(0, 0, w, h), d = im.data;
          var inLon = [], inLat = [], dxs = [], dys = [];
          var kx = circ ? 111.32 * Math.cos(circ[1] * Math.PI / 180) : 0;
          for (var px = 0; px < w; px++) { var lo = lon0 + (px + 0.5) / w * (lon1 - lon0); inLon.push(lo >= r[0] && lo <= r[2]); if (circ) dxs.push((lo - circ[0]) * kx); }
          for (var py = 0; py < h; py++) { var la = lat(y + (py + 0.5) / h); inLat.push(la >= r[1] && la <= r[3]); if (circ) dys.push((la - circ[1]) * 110.57); }
          var rr = circ ? circ[2] * circ[2] : 0;
          for (py = 0; py < h; py++) {
            for (px = 0; px < w; px++) {
              var i = (py * w + px) * 4;
              var inside = inLat[py] && inLon[px] && (!circ || dxs[px] * dxs[px] + dys[py] * dys[py] <= rr);
              if (!inside || d[i] < 128) { d[i] = 128; d[i + 1] = 0; d[i + 2] = 0; }
            }
          }
          cx.putImageData(im, 0, 0);
          return toBuf(c);
        });
    });

    // "basecut://host/path/{z}/{x}/{y}.ext?r=...": base-map tiles are only fetched where they overlap the rectangle;
    // everything else is a transparent pixel (those tiles would be masked anyway).
    maplibregl.addProtocol('basecut', function (params, abort) {
      var m = /\/(\d+)\/(\d+)\/(\d+)\.(png|jpg)\?r=([-\d.,]+)/.exec(params.url);
      if (!m) return Promise.reject(new Error('bad basecut url'));
      var r = m[5].split(',').map(Number);
      if (!tileOverlaps(+m[1], +m[2], +m[3], r)) return clearTile();
      var url = 'https://' + params.url.replace(/^basecut:\/\//, '').replace(/\?r=.*$/, '');
      return fetch(url, { signal: abort && abort.signal })
        .then(function (rr) { if (!rr.ok) return null; return rr.arrayBuffer(); })
        .then(function (buf) { return buf ? { data: buf } : clearTile(); });
    });
  }

  // labels: true = the raster has place names printed on it (hint / navigation maps)
  var BASES = {
    relief: { label: '色別標高図＋陰影', labels: false, hills: 0.4, maxzoom: 15, attr: GSI + '（色別標高図）',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png'] },
    photo:  { label: '航空写真', labels: false, hills: 0.25, maxzoom: 18, attr: GSI + '（全国最新写真）',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'] },
    shade:  { label: '陰影のみ（白黒）', labels: false, hills: 1.0, maxzoom: 0, attr: '', tiles: null },
    std:    { label: '標準地図（地名あり）', labels: true, hills: 0.3, maxzoom: 18, attr: GSI + '（標準地図）',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'] },
    pale:   { label: '淡色地図（地名あり）', labels: true, hills: 0.3, maxzoom: 18, attr: GSI + '（淡色地図）',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'] }
  };

  // opts: { exaggeration: number (0 = flat map, no terrain), hills: 0..1 override, hillsOn: bool }
  function style(baseKey, opts) {
    opts = opts || {};
    var b = BASES[baseKey] || BASES.relief;
    var exag = opts.exaggeration == null ? 1.5 : opts.exaggeration;
    var hills = opts.hills == null ? b.hills : opts.hills;
    var hillsOn = opts.hillsOn !== false;

    var cutRect = opts.cutRect || null;
    // sea: 'flat' = flat blue sea surface (default for 3D), 'none' = sea removed, 'floor' = real sea-floor relief
    var seaMode = opts.sea || (exag > 0 ? 'flat' : 'floor');
    var removeSea = !!cutRect || seaMode !== 'floor';
    if (removeSea) ensureProtocol();
    var sources = {
      dem: { type: 'raster-dem', tiles: cutRect ? cutTiles(cutRect, opts.cutCircle) : (removeSea ? ['dem0://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] : DEM_TILES),
        tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: DEM_ATTR }
    };
    var bgColor = baseKey === 'shade' ? '#e6ebf1' : (removeSea ? SEA_COLOR : '#cfd8e3');
    var layers = [{ id: 'bg', type: 'background', paint: { 'background-color': bgColor } }];
    if (b.tiles) {
      sources.base = { type: 'raster', tiles: cutRect ? baseTiles(baseKey, cutRect) : b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attr };
      // GSI tiles only make sense inside Japan; don't paint stray patches of foreign land
      if (!b.labels) sources.base.bounds = [122.5, 20.0, 154.5, 45.6];
      layers.push({ id: 'base', type: 'raster', source: 'base', paint: { 'raster-fade-duration': 0 } });
    }
    if (hillsOn) {
      layers.push({
        id: 'hills', type: 'hillshade', source: 'dem',
        paint: {
          'hillshade-exaggeration': hills,
          'hillshade-shadow-color': baseKey === 'shade' ? '#46526a' : '#0f172a',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': baseKey === 'shade' ? '#7d899c' : '#475569'
        }
      });
    }
    if (seaMode !== 'floor') {
      // cover the sea with a flat colour using OpenStreetMap ocean polygons (OpenFreeMap vector tiles)
      sources.ofm = { type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>（海域）' };
      layers.push({ id: 'sea', type: 'fill', source: 'ofm', 'source-layer': 'water', filter: ['==', 'class', 'ocean'],
        paint: { 'fill-color': seaMode === 'flat' ? FLAT_SEA : SEA_COLOR, 'fill-opacity': 1, 'fill-antialias': false } });
    }
    if (seaMode !== 'floor') {
      // the GSI raster paints foreign land (Korea, Primorye) in one flat pale colour: cover it too
      sources.foreign = { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [FOREIGN_LAND] } } };
      layers.push({ id: 'foreign', type: 'fill', source: 'foreign', paint: { 'fill-color': seaMode === 'flat' ? FOREIGN_FLAT : SEA_COLOR, 'fill-opacity': 1, 'fill-antialias': false } });
    }
    if (cutRect) {
      // hide everything outside the rectangle (the terrain there is already flattened to 0 m)
      sources.cutmask = { type: 'geojson', data: cutMask(cutRect, opts.cutCircle), maxzoom: 9, tolerance: 0, buffer: 0 };
      layers.push({ id: 'cutmask', type: 'fill', source: 'cutmask', paint: { 'fill-color': SEA_COLOR, 'fill-opacity': 1, 'fill-opacity-transition': { duration: 0 }, 'fill-antialias': false } });
      // outline of the block, only shown when the answer is revealed
      sources.cutline = { type: 'geojson', data: cutLine(cutRect, opts.cutCircle) };
      layers.push({ id: 'cutline', type: 'line', source: 'cutline', paint: { 'line-color': '#fbbf24', 'line-width': 3, 'line-opacity': 0, 'line-opacity-transition': { duration: 0 } } });
    }
    if (opts.borders) {
      // coastline + prefecture borders (OpenStreetMap via OpenFreeMap). 'hidden' = present but invisible until revealed.
      if (!sources.ofm) sources.ofm = { type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' };
      var bo = opts.borders === 'hidden' ? 0 : 0.9;
      layers.push({ id: 'coast-line', type: 'line', source: 'ofm', 'source-layer': 'water', filter: ['==', 'class', 'ocean'],
        paint: { 'line-color': '#f1f5f9', 'line-width': 1.3, 'line-opacity': bo, 'line-opacity-transition': { duration: 0 } } });
      // only Japanese prefectures: inside a box around Japan and not inside the Korea / Asian-mainland outline
      var box = { type: 'Polygon', coordinates: [[[122.5, 20], [154.5, 20], [154.5, 46], [122.5, 46], [122.5, 20]]] };
      var mainland = { type: 'Polygon', coordinates: [FOREIGN_LAND] };
      layers.push({ id: 'pref-border', type: 'line', source: 'ofm', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1], ['within', box], ['!', ['within', mainland]]],
        paint: { 'line-color': '#fde68a', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 8, 1.8], 'line-opacity': bo, 'line-opacity-transition': { duration: 0 } } });
    }
    var st = { version: 8, sources: sources, layers: layers };
    if (exag > 0) st.terrain = { source: 'dem', exaggeration: exag };
    return st;
  }

  // circle = [lon, lat, radiusKm] (optional): the cut region is the circle instead of the rectangle (rect = its bounding box)
  function cutTiles(rect, circle) {
    return ['demcut://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png?r=' + rect.join(',') + (circle ? '&c=' + circle.join(',') : '')];
  }
  function circleRing(c) {
    var ring = [], steps = 120, k = Math.cos(c[1] * Math.PI / 180);
    for (var i = 0; i <= steps; i++) {
      var a = -2 * Math.PI * i / steps; // clockwise, opposite to the outer ring
      ring.push([c[0] + c[2] * Math.cos(a) / (111.32 * k), c[1] + c[2] * Math.sin(a) / 110.57]);
    }
    return ring;
  }
  function cutMask(rect, circle) {
    var hole = circle ? circleRing(circle)
      : [[rect[0], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]], [rect[2], rect[1]], [rect[0], rect[1]]];
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
      [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], hole
    ] } };
  }
  // tile URL templates for a base map; with a rect, tiles are fetched only where they overlap it
  function baseTiles(baseKey, rect) {
    var b = BASES[baseKey];
    if (!b || !b.tiles) return null;
    if (!rect) return b.tiles;
    return b.tiles.map(function (t) { return t.replace(/^https:\/\//, 'basecut://') + '?r=' + rect.join(','); });
  }

  function cutLine(rect, circle) {
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: circle ? circleRing(circle) : [
      [rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]], [rect[0], rect[1]]] } };
  }
  // whole-Japan terrain (sea floor flattened), used when the answer is revealed
  function fullTiles() {
    return ['dem0://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
  }

  // rectangle of widthKm x heightKm centred on (lat, lon), as [minLon, minLat, maxLon, maxLat]
  function rectAround(lat, lon, widthKm, heightKm) {
    var dLat = heightKm / 2 / 111.2, dLon = widthKm / 2 / (111.2 * Math.cos(lat * Math.PI / 180));
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }

  function haversineKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  root.J3D = { BASES: BASES, style: style, haversineKm: haversineKm, SEA_COLOR: SEA_COLOR, cutTiles: cutTiles, cutMask: cutMask, cutLine: cutLine, circleRing: circleRing, fullTiles: fullTiles, baseTiles: baseTiles, rectAround: rectAround };
})(window);
