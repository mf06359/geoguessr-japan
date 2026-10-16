/* 3D（地形）地図の共通部品。MapLibre GL JS 用スタイルを作る。
 * 標高: AWS Open Data「Terrain Tiles」(terrarium) ／ 地図: 国土地理院タイル。いずれもAPIキー不要。 */
(function (root) {
  var GSI = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
  var DEM_ATTR = '標高: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles (AWS Open Data)</a>';
  var DEM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];

  var SEA_COLOR = '#0f172a';
  // rough outline (lon, lat) of the Asian mainland / Korea west of the Sea of Japan; the eastern edge runs through open sea
  var FOREIGN_LAND = [[118, 32.8], [126.8, 32.8], [128.2, 34.3], [129.2, 35.0], [130.4, 36.5], [133.5, 41.0], [139.6, 45.7], [139.6, 48.0], [118, 48.0], [118, 32.8]];

  // "dem0://" tiles = the same terrarium DEM with everything below sea level flattened to 0 m,
  // so the sea floor disappears from the 3D terrain.
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

    var removeSea = opts.removeSea != null ? opts.removeSea : exag > 0;
    if (removeSea) ensureProtocol();
    var sources = {
      dem: { type: 'raster-dem', tiles: removeSea ? ['dem0://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] : DEM_TILES,
        tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: DEM_ATTR }
    };
    var bgColor = removeSea ? SEA_COLOR : (baseKey === 'shade' ? '#e9eef4' : '#cfd8e3');
    var layers = [{ id: 'bg', type: 'background', paint: { 'background-color': bgColor } }];
    if (b.tiles) {
      sources.base = { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attr };
      // GSI tiles only make sense inside Japan; don't paint stray patches of foreign land
      if (!b.labels) sources.base.bounds = [122.5, 20.0, 154.5, 45.6];
      layers.push({ id: 'base', type: 'raster', source: 'base', paint: { 'raster-fade-duration': 0 } });
    }
    if (hillsOn) {
      layers.push({
        id: 'hills', type: 'hillshade', source: 'dem',
        paint: {
          'hillshade-exaggeration': hills,
          'hillshade-shadow-color': '#0f172a',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#475569'
        }
      });
    }
    if (removeSea) {
      // cover the sea with a flat colour using OpenStreetMap ocean polygons (OpenFreeMap vector tiles)
      sources.ofm = { type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>（海域）' };
      layers.push({ id: 'sea', type: 'fill', source: 'ofm', 'source-layer': 'water', filter: ['==', 'class', 'ocean'],
        paint: { 'fill-color': SEA_COLOR, 'fill-opacity': 1, 'fill-antialias': false } });
    }
    if (removeSea) {
      // the GSI raster paints foreign land (Korea, Primorye) in one flat pale colour: cover it too
      sources.foreign = { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [FOREIGN_LAND] } } };
      layers.push({ id: 'foreign', type: 'fill', source: 'foreign', paint: { 'fill-color': SEA_COLOR, 'fill-opacity': 1, 'fill-antialias': false } });
    }
    var st = { version: 8, sources: sources, layers: layers };
    if (exag > 0) st.terrain = { source: 'dem', exaggeration: exag };
    return st;
  }

  function haversineKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  root.J3D = { BASES: BASES, style: style, haversineKm: haversineKm, SEA_COLOR: SEA_COLOR };
})(window);
