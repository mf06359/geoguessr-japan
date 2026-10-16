/* 3D（地形）地図の共通部品。MapLibre GL JS 用スタイルを作る。
 * 標高: AWS Open Data「Terrain Tiles」(terrarium) ／ 地図: 国土地理院タイル。いずれもAPIキー不要。 */
(function (root) {
  var GSI = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
  var DEM_ATTR = '標高: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles (AWS Open Data)</a>';
  var DEM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];

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

    var sources = {
      dem: { type: 'raster-dem', tiles: DEM_TILES, tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: DEM_ATTR }
    };
    var layers = [{ id: 'bg', type: 'background', paint: { 'background-color': baseKey === 'shade' ? '#e9eef4' : '#cfd8e3' } }];
    if (b.tiles) {
      sources.base = { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attr };
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

  root.J3D = { BASES: BASES, style: style, haversineKm: haversineKm };
})(window);
