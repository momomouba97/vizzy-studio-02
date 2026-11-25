/* Vizzy Studio \u2013 render engine.
 * Pure canvas-2D code: renderFrame(ctx, w, h, t, project, sample, env).
 * Used identically by the live preview and the MP4 exporter.
 */
(function (root) {
  'use strict';
  const VZ = (root.VZ = root.VZ || {});
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const frac = (x) => x - Math.floor(x);

  /* ---------- helpers ---------- */
  const colCache = {};
  function parseColor(c) {
    if (colCache[c]) return colCache[c];
    let s = String(c || '#ffffff').replace('#', '');
    if (s.length === 3) s = s.split('').map((x) => x + x).join('');
    const n = parseInt(s, 16);
    const r = isNaN(n) ? [255, 255, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    colCache[c] = r;
    return r;
  }
  function rgba(c, a) {
    const p = parseColor(c);
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
  }
  function mix(c1, c2, t) {
    const a = parseColor(c1), b = parseColor(c2);
    t = clamp(t, 0, 1);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }
  function hash(i, s) {
    const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

  VZ.makeCanvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  VZ.createEnv = function (getAsset) {
    const scratch = {};
    return {
      getAsset: getAsset || (() => null),
      waveBuf: new Float32Array(512),
      noise: null,
      scratch(i, w, h) {
        let c = scratch[i];
        if (!c || c.width !== w || c.height !== h) { c = VZ.makeCanvas(w, h); scratch[i] = c; }
        return c;
      },
    };
  };

  function reactVal(S, band) {
    switch (band) {
      case 'bass': return S.bass;
      case 'mid': return S.mid;
      case 'treble': return S.treble;
      case 'all': return (S.bass + S.mid + S.treble) / 3;
      default: return S.beat;
    }
  }

  function timeAlpha(L, t) {
    const s = L.start || 0;
    const e = L.end == null ? Infinity : L.end;
    if (t < s || t >= e) return 0;
    const f = L.fade || 0;
    if (f <= 0) return 1;
    return clamp(Math.min((t - s) / f, (e - t) / f), 0, 1);
  }

  /* ---------- schema ---------- */
  const REACT_BANDS = [['beat', 'Beat'], ['bass', 'Bass'], ['mid', 'Mids'], ['treble', 'Highs'], ['all', 'Overall']];
  const BLENDS = [['source-over', 'Normal'], ['lighter', 'Add (glow)'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['multiply', 'Multiply'], ['difference', 'Difference']];
  VZ.FONTS = ['Helvetica Neue', 'Arial', 'Arial Black', 'Impact', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Didot', 'Baskerville', 'American Typewriter', 'Rockwell', 'Courier New', 'Menlo', 'Copperplate', 'Marker Felt', 'Chalkboard SE', 'Brush Script MT', 'Papyrus', 'Geeza Pro', 'Damascus', 'Al Bayan'];
  VZ.FX_DEFAULT = { vignette: 0.6, scanlines: 0.5, grain: 0.5, rgbsplit: 0.6, glitch: 0.7, shake: 0.5, zoom: 0.5, flash: 0.5, pixelate: 0.4, grade: 1, mirror: 1 };
  const DYNAMIC_FX = (VZ.DYNAMIC_FX = ['rgbsplit', 'glitch', 'shake', 'zoom', 'flash']);
  VZ.VIZ = {}; VZ.FX = {}; VZ.PARTICLE = {}; VZ.DRAW = {}; // extension registries (see engine2.js)

  const F_TRANSFORM = [
    { key: 'x', label: 'Position X', type: 'range', min: 0, max: 1, step: 0.005, group: 'Transform' },
    { key: 'y', label: 'Position Y', type: 'range', min: 0, max: 1, step: 0.005 },
    { key: 'scale', label: 'Scale', type: 'range', min: 0.1, max: 4, step: 0.01 },
    { key: 'rotation', label: 'Rotation', type: 'range', min: -180, max: 180, step: 1 },
  ];
  const F_REACT = [
    { key: 'reactBand', label: 'React to', type: 'select', options: REACT_BANDS, group: 'Audio reaction' },
    { key: 'reactAmount', label: 'Pulse amount', type: 'range', min: 0, max: 1, step: 0.01 },
  ];
  const F_LOOK = [
    { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.01, group: 'Look' },
    { key: 'blend', label: 'Blend mode', type: 'select', options: BLENDS },
  ];
  const F_TIME = [
    { key: 'start', label: 'Start (s)', type: 'number', min: 0, step: 0.1, group: 'Timing' },
    { key: 'end', label: 'End (s)', type: 'number', min: 0, step: 0.1, nullable: true, placeholder: 'until the end' },
    { key: 'fade', label: 'Fade in / out (s)', type: 'range', min: 0, max: 3, step: 0.05 },
  ];
  const F_TEXT = (extra) => [
    { key: 'font', label: 'Font', type: 'select', options: () => VZ.FONTS.map((f) => [f, f]), group: 'Text style' },
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 40, step: 0.1 },
    { key: 'weight', label: 'Weight', type: 'select', options: [[300, 'Light'], [400, 'Regular'], [600, 'Semi-bold'], [700, 'Bold'], [900, 'Black']] },
    { key: 'italic', label: 'Italic', type: 'checkbox' },
    { key: 'upper', label: 'UPPERCASE', type: 'checkbox' },
    { key: 'color', label: 'Color', type: 'color' },
    { key: 'align', label: 'Align', type: 'select', options: [['center', 'Center'], ['left', 'Left'], ['right', 'Right']] },
    { key: 'maxWidth', label: 'Max width (%)', type: 'range', min: 10, max: 100, step: 1 },
    { key: 'spacing', label: 'Letter spacing', type: 'range', min: -2, max: 20, step: 0.1 },
    { key: 'outline', label: 'Outline', type: 'range', min: 0, max: 2, step: 0.05 },
    { key: 'outlineColor', label: 'Outline color', type: 'color' },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 10, step: 0.1 },
    { key: 'glowColor', label: 'Glow color', type: 'color' },
  ].concat(extra || []);

  const common = (o) => Object.assign({ x: 0.5, y: 0.5, scale: 1, rotation: 0, reactBand: 'beat', reactAmount: 0, opacity: 1, blend: 'source-over', start: 0, end: null, fade: 0 }, o);
  const textDefaults = (o) => Object.assign({ font: 'Helvetica Neue', size: 8, weight: 700, italic: false, upper: false, color: '#ffffff', align: 'center', maxWidth: 80, spacing: 0, outline: 0, outlineColor: '#000000', glow: 0, glowColor: '#8b5cf6' }, o);

  const isCircle = (L) => /^(circlebars|circlewave|rings)$/.test(L.style);
  const isBarLike = (L) => /^(bars|mirror|dots|circlebars)$/.test(L.style);

  VZ.TYPES = {
    background: {
      label: 'Background', icon: '\u25a6', noTransform: true,
      defaults: () => ({ mode: 'gradient', color: '#12082e', color2: '#4f2eb2', angle: 160, src: null, zoom: 1.05, blur: 0, dim: 0.15, drift: 0.3, reactBand: 'bass', reactAmount: 0.3, opacity: 1, blend: 'source-over', start: 0, end: null, fade: 0 }),
      fields: [
        { key: 'mode', label: 'Type', type: 'select', options: [['color', 'Solid color'], ['gradient', 'Gradient'], ['image', 'Image'], ['video', 'Video']], group: 'Background' },
        { key: 'color', label: 'Color', type: 'color', show: (L) => L.mode === 'color' || L.mode === 'gradient' },
        { key: 'color2', label: 'Color 2', type: 'color', show: (L) => L.mode === 'gradient' },
        { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1, show: (L) => L.mode === 'gradient' },
        { key: 'src', label: 'File', type: 'asset', kind: (L) => (L.mode === 'video' ? 'video' : 'image'), show: (L) => L.mode === 'image' || L.mode === 'video' },
        { key: 'zoom', label: 'Zoom', type: 'range', min: 1, max: 2, step: 0.01, show: (L) => L.mode === 'image' || L.mode === 'video' },
        { key: 'drift', label: 'Slow drift', type: 'range', min: 0, max: 3, step: 0.05, show: (L) => L.mode === 'image' || L.mode === 'video' },
        { key: 'blur', label: 'Blur', type: 'range', min: 0, max: 4, step: 0.05, show: (L) => L.mode === 'image' || L.mode === 'video' },
        { key: 'dim', label: 'Darken', type: 'range', min: 0, max: 1, step: 0.01, show: (L) => L.mode === 'image' || L.mode === 'video' },
      ].concat(F_REACT.map((f) => Object.assign({}, f, f.key === 'reactAmount' ? { label: 'Zoom pulse' } : {}))).concat(F_LOOK, F_TIME),
    },
    visualizer: {
      label: 'Visualizer', icon: '\u25ae\u25ae',
      defaults: () => common({ style: 'bars', count: 64, width: 70, height: 28, radius: 16, length: 14, gap: 0.35, rounded: true, symmetric: false, color: '#ffffff', color2: '#8b5cf6', glow: 0, sens: 1, lineWidth: 0.5, y: 0.72 }),
      fields: [
        { key: 'style', label: 'Style', type: 'select', group: 'Visualizer', options: [['bars', 'Bars'], ['mirror', 'Mirrored bars'], ['wave', 'Waveform line'], ['spectrum', 'Spectrum fill'], ['dots', 'LED dots'], ['circlebars', 'Circle bars'], ['circlewave', 'Circle wave'], ['rings', 'Pulse rings']] },
        { key: 'count', label: 'Count', type: 'range', min: 4, max: 160, step: 1, show: (L) => /^(bars|mirror|dots|spectrum|circlebars|rings)$/.test(L.style) },
        { key: 'width', label: 'Width (%)', type: 'range', min: 5, max: 100, step: 1, show: (L) => !isCircle(L) },
        { key: 'height', label: 'Height (%)', type: 'range', min: 2, max: 100, step: 1, show: (L) => !isCircle(L) },
        { key: 'radius', label: 'Radius', type: 'range', min: 2, max: 45, step: 0.5, show: isCircle },
        { key: 'length', label: 'Bar / wave length', type: 'range', min: 1, max: 40, step: 0.5, show: isCircle },
        { key: 'gap', label: 'Gap', type: 'range', min: 0, max: 0.9, step: 0.01, show: isBarLike },
        { key: 'rounded', label: 'Rounded', type: 'checkbox', show: isBarLike },
        { key: 'symmetric', label: 'Symmetric (bass in center)', type: 'checkbox', show: (L) => /^(bars|mirror|dots|spectrum|circlebars|circlewave)$/.test(L.style) },
        { key: 'lineWidth', label: 'Line thickness', type: 'range', min: 0.1, max: 3, step: 0.05, show: (L) => /^(wave|circlewave|rings)$/.test(L.style) },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'color2', label: 'Color 2', type: 'color' },
        { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 20, step: 0.5 },
        { key: 'sens', label: 'Sensitivity', type: 'range', min: 0.3, max: 3, step: 0.01 },
      ].concat(F_TRANSFORM, F_REACT, F_LOOK, F_TIME),
    },
    particles: {
      label: 'Particles', icon: '\u2726', noTransform: true,
      defaults: () => common({ mode: 'rise', count: 120, size: 1, speed: 1, color: '#ffffff', color2: '#a78bfa', glow: 3, reactBand: 'bass', reactAmount: 0.6 }),
      fields: [
        { key: 'mode', label: 'Motion', type: 'select', group: 'Particles', options: [['rise', 'Rising'], ['fall', 'Falling snow'], ['burst', 'Burst from center'], ['twinkle', 'Twinkling stars']] },
        { key: 'count', label: 'Count', type: 'range', min: 10, max: 500, step: 1 },
        { key: 'size', label: 'Size', type: 'range', min: 0.2, max: 6, step: 0.05 },
        { key: 'speed', label: 'Speed', type: 'range', min: 0, max: 3, step: 0.05 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'color2', label: 'Color 2', type: 'color' },
        { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 20, step: 0.5 },
      ].concat(F_REACT.map((f) => Object.assign({}, f, f.key === 'reactAmount' ? { label: 'Size pulse' } : {})), F_LOOK, F_TIME),
    },
    text: {
      label: 'Text', icon: 'T',
      defaults: () => common(textDefaults({ text: 'Song Title\nArtist Name', y: 0.45, size: 9 })),
      fields: [{ key: 'text', label: 'Text', type: 'textarea', group: 'Content' }].concat(F_TEXT(), F_TRANSFORM, F_REACT, F_LOOK, F_TIME),
    },
    lyrics: {
      label: 'Lyrics', icon: '\u266a', lyrics: true,
      defaults: () => common(textDefaults({ lines: [], mode: 'single', anim: 'pop', dim: 0.35, y: 0.5, size: 7 })),
      fields: [
        { key: 'mode', label: 'Layout', type: 'select', group: 'Lyrics', options: [['single', 'One line at a time'], ['stack', 'Previous / current / next']] },
        { key: 'anim', label: 'Animation', type: 'select', options: [['pop', 'Pop in'], ['fade', 'Fade'], ['slide', 'Slide up'], ['none', 'None']] },
        { key: 'dim', label: 'Dim other lines', type: 'range', min: 0, max: 1, step: 0.01, show: (L) => L.mode === 'stack' },
      ].concat(F_TEXT(), F_TRANSFORM, F_REACT, F_LOOK, F_TIME),
    },
    image: {
      label: 'Image / Logo', icon: '\u25a3',
      defaults: () => common({ src: null, size: 30, shape: 'none', border: 0, borderColor: '#ffffff', spin: 0, glow: 0, glowColor: '#8b5cf6' }),
      fields: [
        { key: 'src', label: 'Image', type: 'asset', kind: () => 'image', group: 'Image' },
        { key: 'size', label: 'Size', type: 'range', min: 2, max: 150, step: 0.5 },
        { key: 'shape', label: 'Shape', type: 'select', options: [['none', 'Original'], ['circle', 'Circle'], ['rounded', 'Rounded square']] },
        { key: 'border', label: 'Border', type: 'range', min: 0, max: 3, step: 0.05 },
        { key: 'borderColor', label: 'Border color', type: 'color' },
        { key: 'spin', label: 'Spin (deg/s)', type: 'range', min: -180, max: 180, step: 1 },
        { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 20, step: 0.5 },
        { key: 'glowColor', label: 'Glow color', type: 'color' },
      ].concat(F_TRANSFORM, F_REACT, F_LOOK, F_TIME),
    },
    shape: {
      label: 'Shape', icon: '\u25c6',
      defaults: () => common({ shape: 'circle', width: 20, height: 20, color: '#8b5cf6', color2: '#ec4899', gradient: true, stroke: 0.6, radius: 1, glow: 0 }),
      fields: [
        { key: 'shape', label: 'Shape', type: 'select', group: 'Shape', options: [['rect', 'Rectangle'], ['circle', 'Circle'], ['ring', 'Ring'], ['triangle', 'Triangle']] },
        { key: 'width', label: 'Width', type: 'range', min: 1, max: 200, step: 0.5 },
        { key: 'height', label: 'Height', type: 'range', min: 1, max: 200, step: 0.5 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'gradient', label: 'Gradient', type: 'checkbox', show: (L) => L.shape !== 'ring' },
        { key: 'color2', label: 'Color 2', type: 'color', show: (L) => L.shape !== 'ring' && L.gradient },
        { key: 'stroke', label: 'Ring thickness', type: 'range', min: 0.1, max: 6, step: 0.05, show: (L) => L.shape === 'ring' },
        { key: 'radius', label: 'Corner radius', type: 'range', min: 0, max: 20, step: 0.1, show: (L) => L.shape === 'rect' },
        { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 20, step: 0.5 },
      ].concat(F_TRANSFORM, F_REACT, F_LOOK, F_TIME),
    },
    effect: {
      label: 'Effect', icon: '\u2727', noTransform: true, noLook: true,
      defaults: () => ({ fx: 'vignette', amount: 0.6, color: '#ffffff', hue: 0, sat: 1.2, contrast: 1.05, bright: 1, reactBand: 'beat', reactAmount: 0.8, start: 0, end: null, fade: 0 }),
      fields: [
        { key: 'fx', label: 'Effect', type: 'select', group: 'Effect', options: [['vignette', 'Vignette'], ['scanlines', 'VHS scanlines'], ['grain', 'Film grain'], ['rgbsplit', 'RGB split'], ['glitch', 'Glitch'], ['shake', 'Camera shake'], ['zoom', 'Zoom punch'], ['flash', 'Beat flash'], ['pixelate', 'Pixelate'], ['grade', 'Color grade'], ['mirror', 'Mirror (kaleidoscope)']], onChange: (L) => { L.amount = VZ.FX_DEFAULT[L.fx] != null ? VZ.FX_DEFAULT[L.fx] : 0.5; } },
        { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, show: (L) => L.fx !== 'grade' && L.fx !== 'mirror' },
        { key: 'color', label: 'Color', type: 'color', show: (L) => L.fx === 'vignette' || L.fx === 'flash' },
        { key: 'hue', label: 'Hue shift', type: 'range', min: -180, max: 180, step: 1, show: (L) => L.fx === 'grade' },
        { key: 'sat', label: 'Saturation', type: 'range', min: 0, max: 3, step: 0.01, show: (L) => L.fx === 'grade' },
        { key: 'contrast', label: 'Contrast', type: 'range', min: 0.5, max: 2, step: 0.01, show: (L) => L.fx === 'grade' },
        { key: 'bright', label: 'Brightness', type: 'range', min: 0.5, max: 1.5, step: 0.01, show: (L) => L.fx === 'grade' },
        { key: 'reactBand', label: 'React to', type: 'select', options: REACT_BANDS, group: 'Audio reaction', show: (L) => DYNAMIC_FX.indexOf(L.fx) >= 0 },
        { key: 'reactAmount', label: 'Audio-driven', type: 'range', min: 0, max: 1, step: 0.01, show: (L) => DYNAMIC_FX.indexOf(L.fx) >= 0 },
      ].concat(F_TIME),
    },
  };

  let uidN = 0;
  VZ.uid = () => 'L' + Date.now().toString(36) + (uidN++).toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  VZ.newLayer = function (type, over) {
    const T = VZ.TYPES[type];
    return Object.assign({ id: VZ.uid(), type, name: T.label, visible: true }, T.defaults(), over || {});
  };

  /* ---------- drawing primitives ---------- */
  function rect(ctx, x, y, w, h, round) {
    if (round && ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) / 2);
      ctx.fill();
    } else ctx.fillRect(x, y, w, h);
  }
  function bandAvg(bands, p, n) {
    const pos = p * VZ.MAXB, half = (VZ.MAXB / n) * 0.75;
    const lo = Math.max(0, Math.floor(pos - half)), hi = Math.min(VZ.NB - 1, Math.ceil(pos + half));
    let s = 0;
    for (let i = lo; i <= hi; i++) s += bands[i];
    return s / (hi - lo + 1);
  }
  function barPos(i, n, sym) {
    if (n < 2) return 0;
    return sym ? Math.abs(i - (n - 1) / 2) / ((n - 1) / 2) : i / (n - 1);
  }
  function strokeGrad(ctx, x0, y0, x1, y1, c1, c2) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    return g;
  }

  /* ---------- visualizer ---------- */
  function drawVisualizer(ctx, w, h, t, L, S, env, u) {
    const W = (L.width / 100) * w, H = (L.height / 100) * h;
    const c1 = L.color, c2 = L.color2 || L.color, sens = L.sens || 1;
    const amp = (p, n) => VZ.ampOf(bandAvg(S.bands, p, n), sens);
    ctx.shadowColor = c1;
    ctx.shadowBlur = (L.glow || 0) * u;
    ctx.lineJoin = 'round';
    const n = Math.max(2, L.count | 0);
    switch (L.style) {
      case 'bars':
      case 'mirror': {
        const step = W / n, bw = Math.max(1, step * (1 - L.gap)), mid = L.style === 'mirror';
        for (let i = 0; i < n; i++) {
          const a = amp(barPos(i, n, L.symmetric), n);
          const x = -W / 2 + i * step + (step - bw) / 2;
          ctx.fillStyle = mix(c1, c2, n > 1 ? i / (n - 1) : 0);
          if (mid) { const bh = Math.max(2, (a * H) / 2); rect(ctx, x, -bh, bw, bh * 2, L.rounded); }
          else { const bh = Math.max(2, a * H); rect(ctx, x, H / 2 - bh, bw, bh, L.rounded); }
        }
        break;
      }
      case 'dots': {
        const rows = 12, cw = W / n, ch = H / rows, r = Math.max(0.5, (Math.min(cw, ch) / 2) * (1 - L.gap * 0.6));
        for (let i = 0; i < n; i++) {
          const a = amp(barPos(i, n, L.symmetric), n);
          const lit = Math.max(1, Math.ceil(a * rows));
          for (let j = 0; j < lit; j++) {
            ctx.fillStyle = mix(c2, c1, j / (rows - 1));
            ctx.beginPath();
            ctx.arc(-W / 2 + (i + 0.5) * cw, H / 2 - (j + 0.5) * ch, r, 0, TAU);
            ctx.fill();
          }
        }
        break;
      }
      case 'spectrum': {
        const pts = [];
        for (let i = 0; i < n; i++) pts.push([-W / 2 + (i / (n - 1)) * W, H / 2 - amp(barPos(i, n, L.symmetric), n) * H]);
        ctx.beginPath();
        ctx.moveTo(-W / 2, H / 2);
        ctx.lineTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < n; i++) {
          const mx = (pts[i - 1][0] + pts[i][0]) / 2, my = (pts[i - 1][1] + pts[i][1]) / 2;
          ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
        }
        ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
        ctx.lineTo(W / 2, H / 2);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, -H / 2, 0, H / 2);
        g.addColorStop(0, rgba(c1, 0.95)); g.addColorStop(1, rgba(c2, 0.15));
        ctx.fillStyle = g;
        ctx.fill();
        break;
      }
      case 'wave': {
        const N = 240, buf = env.waveBuf;
        VZ.waveOf(S, N, 0.03, buf);
        const gain = 2.2 * sens;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = -W / 2 + (i / (N - 1)) * W, y = Math.tanh(buf[i] * gain) * (H / 2);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineWidth = Math.max(1, L.lineWidth * u);
        ctx.lineCap = 'round';
        ctx.strokeStyle = strokeGrad(ctx, -W / 2, 0, W / 2, 0, c1, c2);
        ctx.stroke();
        break;
      }
      case 'circlebars': {
        const R = L.radius * u, len = L.length * u;
        ctx.lineWidth = Math.max(1, ((TAU * R) / n) * (1 - L.gap));
        ctx.lineCap = L.rounded ? 'round' : 'butt';
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU - Math.PI / 2;
          const p = L.symmetric ? (2 * Math.min(i, n - i)) / n : i / n;
          const a = amp(Math.min(1, p), n);
          const l = Math.max(len * 0.06, a * len), cs = Math.cos(ang), sn = Math.sin(ang);
          ctx.strokeStyle = mix(c1, c2, p);
          ctx.beginPath();
          ctx.moveTo(cs * R, sn * R);
          ctx.lineTo(cs * (R + l), sn * (R + l));
          ctx.stroke();
        }
        break;
      }
      case 'circlewave': {
        const R = L.radius * u, len = L.length * u, N = 180, M = N / 2 + 1, buf = env.waveBuf;
        VZ.waveOf(S, M, 0.03, buf);
        const gain = 2.2 * sens;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const j = i <= N / 2 ? i : N - i;
          const ang = (i / N) * TAU - Math.PI / 2;
          const r = R + Math.tanh(buf[j] * gain) * len;
          const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.lineWidth = Math.max(1, L.lineWidth * u);
        ctx.strokeStyle = strokeGrad(ctx, -R, -R, R, R, c1, c2);
        ctx.stroke();
        break;
      }
      case 'rings': {
        const R = L.radius * u, len = L.length * u, cnt = Math.max(1, Math.min(8, Math.round(n / 12) || 3));
        const vals = [S.bass, S.mid, S.treble, S.rms];
        for (let k = 0; k < cnt; k++) {
          const v = vals[k % 4];
          const r = R * (1 + k * 0.4) + v * len;
          ctx.lineWidth = Math.max(1, (0.4 + v * 0.9) * L.lineWidth * u * 2);
          ctx.strokeStyle = mix(c1, c2, cnt > 1 ? k / (cnt - 1) : 0);
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, TAU);
          ctx.stroke();
        }
        break;
      }
      default: {
        const f = VZ.VIZ[L.style];
        if (f) f(ctx, w, h, t, L, S, env, u, { W, H, c1, c2, sens, n, amp });
      }
    }
  }

  /* ---------- particles ---------- */
  function drawParticles(ctx, w, h, t, L, S, u) {
    const n = L.count | 0, r = reactVal(S, L.reactBand) * (L.reactAmount || 0);
    ctx.shadowColor = L.color;
    ctx.shadowBlur = (L.glow || 0) * u;
    const sp = L.speed == null ? 1 : L.speed;
    for (let i = 0; i < n; i++) {
      const h1 = hash(i, 1), h2 = hash(i, 2), h3 = hash(i, 3), h4 = hash(i, 4), h5 = hash(i, 5), h6 = hash(i, 6), h7 = hash(i, 7);
      const life = frac(h3 + S.cum * sp * (0.1 + h4 * 0.3));
      let x, y, a = 1, rad = L.size * u * (0.35 + h6 * 0.9) * (1 + r * 1.6);
      const ext = VZ.PARTICLE[L.mode];
      if (ext) {
        const o = ext({ i, n, life, h1, h2, h3, h4, h5, h6, h7, w, h, t, S, L, u, r, sp, ctx });
        x = o.x; y = o.y; a = o.a; if (o.rad != null) rad = o.rad;
      } else switch (L.mode) {
        case 'fall': x = (h1 + Math.sin(life * TAU * 2 + h5 * TAU) * 0.03) * w; y = life * h; a = Math.sin(life * Math.PI); break;
        case 'burst': {
          const ang = h1 * TAU, dist = Math.pow(life, 1.4) * 0.6 * Math.max(w, h);
          x = w / 2 + Math.cos(ang) * dist; y = h / 2 + Math.sin(ang) * dist;
          a = Math.sin(life * Math.PI); rad *= 0.4 + life; break;
        }
        case 'twinkle': x = h1 * w; y = h2 * h; a = clamp(0.5 + 0.5 * Math.sin(t * (1 + h3 * 3) + h4 * TAU), 0, 1) * (0.45 + 0.55 * clamp(r + 0.3, 0, 1)); break;
        default: x = (h1 + Math.sin(life * TAU * 2 + h5 * TAU) * 0.03) * w; y = (1 - life) * h; a = Math.sin(life * Math.PI);
      }
      if (a <= 0.01) continue;
      ctx.globalAlpha = (ctx.__baseAlpha == null ? 1 : ctx.__baseAlpha) * a;
      ctx.fillStyle = mix(L.color, L.color2 || L.color, h7);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.4, rad), 0, TAU);
      ctx.fill();
    }
  }

  /* ---------- text ---------- */
  const TOKEN_RE = /\{(title|artist)\}/g;
  function resolveText(ctx, str) { const m = ctx.__meta || {}; return String(str == null ? '' : str).replace(TOKEN_RE, (_, k) => m[k] || ''); }
  const isRTL = (s) => (VZ.isRTL ? VZ.isRTL(s) : false);
  function setFont(ctx, L, u, align) {
    ctx.font = (L.italic ? 'italic ' : '') + (L.weight || 700) + ' ' + Math.max(1, L.size * u) + 'px "' + (L.font || 'Helvetica Neue') + '", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = align || L.align || 'center';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (L.spacing || 0) * u * 0.1 + 'px';
  }
  function wrapText(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (const wd of words) {
        const test = line ? line + ' ' + wd : wd;
        if (line && ctx.measureText(test).width > maxW) { out.push(line); line = wd; } else line = test;
      }
      out.push(line);
    }
    return out;
  }
  function blockLines(ctx, text, L, u, w) {
    setFont(ctx, L, u);
    const t = resolveText(ctx, text);
    return wrapText(ctx, L.upper ? t.toUpperCase() : t, (L.maxWidth / 100) * w);
  }
  const lhOf = (L, u) => L.size * u * (L.lineHeight || 1.2);
  function textFill(ctx, L, y0, lh, n) {
    if (L.gradient) {
      const g = ctx.createLinearGradient(0, y0 - lh / 2, 0, y0 + (n - 0.5) * lh);
      g.addColorStop(0, L.color); g.addColorStop(1, L.color2 || L.color);
      return g;
    }
    return L.color;
  }
  function drawBox(ctx, L, u, left, width, top, height) {
    if (!(L.boxOpacity > 0)) return;
    const pad = (L.boxPad == null ? 1.2 : L.boxPad) * u;
    ctx.save();
    ctx.shadowBlur = 0; ctx.fillStyle = rgba(L.boxColor || '#000000', L.boxOpacity);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left - pad * 1.6, top - pad, width + pad * 3.2, height + pad * 2, Math.min(height / 2 + pad, pad * 3)); else ctx.rect(left - pad * 1.6, top - pad, width + pad * 3.2, height + pad * 2);
    ctx.fill();
    ctx.restore();
  }
  function drawLines(ctx, lines, L, u, w, cy, alpha) {
    const lh = lhOf(L, u), y0 = cy - ((lines.length - 1) * lh) / 2, maxW = (L.maxWidth / 100) * w;
    const x = L.align === 'left' ? -maxW / 2 : L.align === 'right' ? maxW / 2 : 0;
    ctx.save();
    ctx.globalAlpha *= alpha;
    setFont(ctx, L, u);
    if (L.boxOpacity > 0) {
      let tw = 0; for (const ln of lines) tw = Math.max(tw, ctx.measureText(ln).width);
      const left = L.align === 'left' ? x : L.align === 'right' ? x - tw : -tw / 2;
      drawBox(ctx, L, u, left, tw, y0 - lh / 2, lines.length * lh);
    }
    ctx.shadowColor = L.glowColor || L.color;
    ctx.shadowBlur = (L.glow || 0) * u;
    const fill = textFill(ctx, L, y0, lh, lines.length);
    for (let i = 0; i < lines.length; i++) {
      const y = y0 + i * lh;
      if ('direction' in ctx) ctx.direction = isRTL(lines[i]) ? 'rtl' : 'ltr';
      if (L.outline > 0) { ctx.lineWidth = L.outline * u; ctx.lineJoin = 'round'; ctx.strokeStyle = L.outlineColor || '#000'; ctx.strokeText(lines[i], x, y); }
      ctx.fillStyle = fill;
      ctx.fillText(lines[i], x, y);
    }
    ctx.restore();
  }
  function drawText(ctx, w, h, L, u) {
    drawLines(ctx, blockLines(ctx, L.text || '', L, u, w), L, u, w, 0, 1);
  }

  /* ---------- lyrics ---------- */
  const WORD_MODES = { karaoke: 1, wordpop: 1, typewriter: 1, bounce: 1, wave: 1 };
  function lyricAnim(L, lt, le, u) {
    const a = L.anim || 'pop';
    if (a === 'none') return { a: 1, s: 1, dy: 0, dx: 0, blur: 0 };
    const fade = clamp(lt / 0.25, 0, 1) * clamp(le / 0.25, 0, 1);
    const k = clamp(lt / 0.35, 0, 1);
    const o = { a: fade, s: 1, dy: 0, dx: 0, blur: 0 };
    if (a === 'pop') o.s = 0.8 + 0.2 * easeOutBack(k);
    else if (a === 'slide') o.dy = (1 - easeOut(k)) * u * 3;
    else if (a === 'zoom') o.s = 1 + 0.6 * (1 - easeOut(clamp(lt / 0.45, 0, 1)));
    else if (a === 'blurin') o.blur = (1 - easeOut(clamp(lt / 0.5, 0, 1))) * 14;
    else if (a === 'flicker') { if (lt < 0.55) o.a *= hash(Math.floor(lt * 28), 3) > 0.42 ? 1 : 0.18; }
    else if (a === 'glitch') { if (lt < 0.4) o.dx = (hash(Math.floor(lt * 40), 5) - 0.5) * u * 5; }
    else if (WORD_MODES[a]) { o.a = clamp(lt / 0.12, 0, 1) * clamp(le / 0.3, 0, 1); }
    return o;
  }
  function lineEnd(lines, i) { return lines[i].t1 != null && lines[i].t1 !== '' ? lines[i].t1 : i + 1 < lines.length ? lines[i + 1].t0 : lines[i].t0 + 5; }

  function drawWordLevel(ctx, line, lineEndT, t, L, u, w, cy, alpha) {
    const mode = L.anim;
    let text = resolveText(ctx, line.text); if (L.upper) text = text.toUpperCase();
    const rtl = isRTL(text);
    const toks = text.split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    const lh = lhOf(L, u), maxW = (L.maxWidth / 100) * w;
    ctx.save();
    ctx.globalAlpha *= alpha;
    setFont(ctx, L, u, 'left');
    if ('direction' in ctx) ctx.direction = rtl ? 'rtl' : 'ltr';
    const wt = line.words && line.words.length === toks.length ? line.words : VZ.distributeWords ? VZ.distributeWords(text, line.t0, Math.max(line.t0 + 0.3, lineEndT - 0.2)) : toks.map((tk, i) => ({ t0: line.t0 + i * 0.3, t1: line.t0 + i * 0.3 + 0.3 }));
    const spaceW = ctx.measureText(' ').width + (L.spacing || 0) * u * 0.1;
    // layout rows
    const rows = []; let cur = null;
    toks.forEach((tk, i) => {
      const wpx = ctx.measureText(tk).width;
      if (!cur || (cur.width + spaceW + wpx > maxW && cur.items.length)) { cur = { items: [], width: 0 }; rows.push(cur); }
      cur.items.push({ tk, i, w: wpx, cum: cur.width + (cur.items.length ? spaceW : 0) });
      cur.width += (cur.items.length > 1 ? spaceW : 0) + wpx;
    });
    const y0 = cy - ((rows.length - 1) * lh) / 2;
    if (L.boxOpacity > 0) { const bw = Math.max(...rows.map((r) => r.width)); drawBox(ctx, L, u, -bw / 2, bw, y0 - lh / 2, rows.length * lh); }
    ctx.shadowColor = L.glowColor || L.color;
    ctx.shadowBlur = (L.glow || 0) * u;
    const charMode = (mode === 'typewriter' || mode === 'bounce' || mode === 'wave') && !rtl;
    const totalChars = toks.reduce((a, x) => a + x.length, 0);
    const stepT = Math.min(0.06, ((lineEndT - line.t0) * 0.75) / Math.max(1, totalChars));
    let g = 0; // global char counter
    rows.forEach((row, ri) => {
      const left = L.align === 'left' ? -maxW / 2 : L.align === 'right' ? maxW / 2 - row.width : -row.width / 2;
      const y = y0 + ri * lh;
      for (const it of row.items) {
        const x = rtl ? left + row.width - it.cum - it.w : left + it.cum;
        const tw = wt[it.i], pw = clamp((t - tw.t0) / Math.max(0.05, tw.t1 - tw.t0), 0, 1);
        const stroke = (str, px, py) => { if (L.outline > 0) { ctx.lineWidth = L.outline * u; ctx.lineJoin = 'round'; ctx.strokeStyle = L.outlineColor || '#000'; ctx.strokeText(str, px, py); } };
        if (mode === 'karaoke') {
          ctx.fillStyle = L.color; stroke(it.tk, x, y); ctx.fillText(it.tk, x, y);
          if (pw > 0) {
            ctx.save(); ctx.beginPath();
            if (rtl) ctx.rect(x + it.w * (1 - pw), y - lh, it.w * pw + 1, lh * 2); else ctx.rect(x - 1, y - lh, it.w * pw + 2, lh * 2);
            ctx.clip(); ctx.fillStyle = L.hiColor || '#facc15'; ctx.fillText(it.tk, x, y); ctx.restore();
          }
        } else if (charMode) {
          for (let c = 0; c < it.tk.length; c++, g++) {
            const cx = x + (c ? ctx.measureText(it.tk.slice(0, c)).width : 0), ch = it.tk[c];
            if (mode === 'typewriter') { if (t < line.t0 + g * stepT) continue; ctx.fillStyle = L.color; stroke(ch, cx, y); ctx.fillText(ch, cx, y); }
            else if (mode === 'bounce') {
              const p = clamp((t - (line.t0 + g * 0.03)) / 0.4, 0, 1); if (p <= 0) continue;
              const e = easeOutBack(p), dy = -(1 - e) * lh * 1.1;
              ctx.save(); ctx.globalAlpha *= clamp(p * 3, 0, 1); ctx.fillStyle = L.color; stroke(ch, cx, y + dy); ctx.fillText(ch, cx, y + dy); ctx.restore();
            } else {
              const dy = Math.sin(t * 5 + g * 0.55) * lh * 0.14; ctx.fillStyle = mix(L.color, L.hiColor || '#facc15', 0.5 + 0.5 * Math.sin(t * 3 + g * 0.3));
              stroke(ch, cx, y + dy); ctx.fillText(ch, cx, y + dy);
            }
          }
        } else { // wordpop (also fallback for RTL char modes)
          const p = clamp((t - tw.t0 + 0.02) / 0.28, 0, 1);
          if (p <= 0) { if ((L.dim == null ? 0.2 : Math.min(L.dim, 0.3)) > 0) { ctx.save(); ctx.globalAlpha *= Math.min(L.dim == null ? 0.2 : L.dim, 0.3); ctx.fillStyle = L.color; ctx.fillText(it.tk, x, y); ctx.restore(); } continue; }
          const s2 = 0.6 + 0.4 * easeOutBack(p), cx = x + it.w / 2;
          ctx.save(); ctx.translate(cx, y); ctx.scale(s2, s2); ctx.globalAlpha *= clamp(p * 2.5, 0, 1);
          ctx.fillStyle = pw > 0 && pw < 1 && L.hiColor ? L.hiColor : L.color;
          if (L.outline > 0) { ctx.lineWidth = L.outline * u; ctx.lineJoin = 'round'; ctx.strokeStyle = L.outlineColor || '#000'; ctx.strokeText(it.tk, -it.w / 2, 0); }
          ctx.fillText(it.tk, -it.w / 2, 0); ctx.restore();
        }
      }
    });
    ctx.restore();
  }

  function drawLyricLine(ctx, lines, i, t, L, u, w, cy, lead) {
    const line = lines[i], end = lineEnd(lines, i);
    const o = lyricAnim(L, t - (line.t0 - lead), end - t, u);
    if (o.a <= 0.002) return;
    ctx.save();
    ctx.translate(o.dx, o.dy + cy); ctx.scale(o.s, o.s);
    if (o.blur > 0.3) ctx.filter = 'blur(' + o.blur * (u / 5) + 'px)';
    if (WORD_MODES[L.anim]) drawWordLevel(ctx, line, end, t, L, u, w, 0, o.a);
    else drawLines(ctx, blockLines(ctx, line.text, L, u, w), L, u, w, 0, o.a);
    ctx.restore();
  }
  function drawLyrics(ctx, w, h, t, L, u) {
    const lines = L.lines || [];
    if (!lines.length) return;
    const lead = L.lead == null ? 0.12 : L.lead;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].t0 - lead <= t) idx = i; else break;
    if (L.mode === 'stack') {
      const lh = lhOf(L, u) * 1.75;
      for (let k = -1; k <= 1; k++) {
        const i = idx + k;
        if (i < 0 || i >= lines.length) continue;
        if (k === 0) drawLyricLine(ctx, lines, i, t, L, u, w, 0, lead);
        else drawLines(ctx, blockLines(ctx, lines[i].text, L, u, w), L, u, w, k * lh, L.dim == null ? 0.35 : L.dim);
      }
    } else if (idx >= 0 && t < lineEnd(lines, idx)) drawLyricLine(ctx, lines, idx, t, L, u, w, 0, lead);
  }

  /* ---------- image / shape ---------- */
  function drawImageLayer(ctx, w, h, t, L, env, u) {
    const asset = L.src && env.getAsset(L.src.path);
    if (!asset) return;
    const iw = asset.naturalWidth || asset.videoWidth, ih = asset.naturalHeight || asset.videoHeight;
    if (!iw || !ih) return;
    const sz = L.size * u;
    if (L.spin) ctx.rotate(((L.spin * t) * Math.PI) / 180);
    ctx.shadowColor = L.glowColor || '#fff';
    ctx.shadowBlur = (L.glow || 0) * u;
    if (L.shape === 'circle' || L.shape === 'rounded') {
      const rr = L.shape === 'circle' ? sz / 2 : sz * 0.18;
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-sz / 2, -sz / 2, sz, sz, rr); else ctx.rect(-sz / 2, -sz / 2, sz, sz);
      ctx.closePath();
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.clip();
      const sc = Math.max(sz / iw, sz / ih);
      ctx.drawImage(asset, (-iw * sc) / 2, (-ih * sc) / 2, iw * sc, ih * sc);
      ctx.restore();
      if (L.border > 0) {
        ctx.shadowBlur = 0;
        ctx.lineWidth = L.border * u; ctx.strokeStyle = L.borderColor || '#fff';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-sz / 2, -sz / 2, sz, sz, rr); else ctx.rect(-sz / 2, -sz / 2, sz, sz);
        ctx.stroke();
      }
    } else {
      const dw = sz, dh = (sz * ih) / iw;
      ctx.drawImage(asset, -dw / 2, -dh / 2, dw, dh);
      if (L.border > 0) {
        ctx.shadowBlur = 0;
        ctx.lineWidth = L.border * u; ctx.strokeStyle = L.borderColor || '#fff';
        ctx.strokeRect(-dw / 2, -dh / 2, dw, dh);
      }
    }
  }
  function drawShape(ctx, w, h, L, u) {
    const W = L.width * u, H = L.height * u;
    ctx.shadowColor = L.color;
    ctx.shadowBlur = (L.glow || 0) * u;
    const fill = L.gradient && L.shape !== 'ring' ? strokeGrad(ctx, 0, -H / 2, 0, H / 2, L.color, L.color2 || L.color) : L.color;
    ctx.fillStyle = fill;
    switch (L.shape) {
      case 'rect':
        if (L.radius > 0 && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-W / 2, -H / 2, W, H, L.radius * u); ctx.fill(); }
        else ctx.fillRect(-W / 2, -H / 2, W, H);
        break;
      case 'ring': ctx.lineWidth = L.stroke * u; ctx.strokeStyle = L.color; ctx.beginPath(); ctx.ellipse(0, 0, W / 2, H / 2, 0, 0, TAU); ctx.stroke(); break;
      case 'triangle': ctx.beginPath(); ctx.moveTo(0, -H / 2); ctx.lineTo(W / 2, H / 2); ctx.lineTo(-W / 2, H / 2); ctx.closePath(); ctx.fill(); break;
      default: ctx.beginPath(); ctx.ellipse(0, 0, W / 2, H / 2, 0, 0, TAU); ctx.fill();
    }
  }

  /* ---------- background ---------- */
  VZ.videoTimeFor = function (L, t, dur) {
    const lt = Math.max(0, t - (L.start || 0));
    if (!dur || !isFinite(dur)) return 0;
    return lt % dur;
  };
  function drawBackground(ctx, w, h, t, L, S, env, u) {
    if (L.mode === 'color') { ctx.fillStyle = L.color; ctx.fillRect(0, 0, w, h); return; }
    if (L.mode === 'gradient') {
      const a = ((L.angle || 0) * Math.PI) / 180, r = Math.hypot(w, h) / 2, cx = w / 2, cy = h / 2;
      const dx = Math.sin(a) * r, dy = -Math.cos(a) * r;
      const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      g.addColorStop(0, L.color); g.addColorStop(1, L.color2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      return;
    }
    const asset = L.src && env.getAsset(L.src.path);
    if (asset) {
      const iw = asset.naturalWidth || asset.videoWidth, ih = asset.naturalHeight || asset.videoHeight;
      if (iw && ih) {
        const z = (L.zoom || 1) * (1 + reactVal(S, L.reactBand) * (L.reactAmount || 0) * 0.1);
        const sc = Math.max(w / iw, h / ih) * z;
        const ox = Math.sin(t * (L.drift || 0) * 0.2) * w * 0.02, oy = Math.cos(t * (L.drift || 0) * 0.17) * h * 0.02;
        if (L.blur > 0) ctx.filter = 'blur(' + L.blur * u + 'px)';
        ctx.drawImage(asset, w / 2 - (iw * sc) / 2 + ox, h / 2 - (ih * sc) / 2 + oy, iw * sc, ih * sc);
        ctx.filter = 'none';
      }
    }
    if (L.dim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + L.dim + ')'; ctx.fillRect(0, 0, w, h); }
  }

  /* ---------- effects ---------- */
  function snapshot(ctx, env, w, h) {
    const s = env.scratch(0, w, h), sc = s.getContext('2d');
    sc.globalCompositeOperation = 'copy';
    sc.drawImage(ctx.canvas, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    return s;
  }
  function drawEffect(ctx, w, h, t, L, S, env, u, ta) {
    let k = (L.amount == null ? 0.5 : L.amount) * ta;
    if (DYNAMIC_FX.indexOf(L.fx) >= 0) k *= lerp(1, reactVal(S, L.reactBand), L.reactAmount == null ? 1 : L.reactAmount);
    switch (L.fx) {
      case 'vignette': {
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
        g.addColorStop(0, rgba(L.color || '#000000', 0));
        g.addColorStop(1, 'rgba(0,0,0,' + clamp(k, 0, 1) + ')');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'scanlines': {
        const sp = Math.max(1, Math.round(u * 0.4));
        ctx.fillStyle = 'rgba(0,0,0,' + clamp(k * 0.5, 0, 1) + ')';
        for (let y = 0; y < h; y += sp * 2) ctx.fillRect(0, y, w, sp);
        const by = frac(t * 0.15) * (h + h * 0.3) - h * 0.15;
        const g = ctx.createLinearGradient(0, by - h * 0.08, 0, by + h * 0.08);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,' + clamp(k * 0.06, 0, 1) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, by - h * 0.08, w, h * 0.16);
        break;
      }
      case 'grain': {
        if (!env.noise) {
          env.noise = [];
          for (let n = 0; n < 4; n++) {
            const c = VZ.makeCanvas(256, 256), cc = c.getContext('2d'), id = cc.createImageData(256, 256), rnd = mulberry32(1234 + n * 77);
            for (let i = 0; i < id.data.length; i += 4) { const v = Math.floor(rnd() * 255); id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
            cc.putImageData(id, 0, 0);
            env.noise.push(c);
          }
        }
        const pat = ctx.createPattern(env.noise[Math.floor(t * 24) % 4], 'repeat');
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = clamp(k * 0.7, 0, 1);
        ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'rgbsplit': {
        const d = k * 1.4 * u;
        if (d < 0.3) break;
        const snap = snapshot(ctx, env, w, h), ch = env.scratch(1, w, h), cc = ch.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        const chans = [['#ff0000', -d, 0], ['#00ff00', 0, 0], ['#0000ff', d, 0]];
        for (const c of chans) {
          cc.globalCompositeOperation = 'source-over'; cc.clearRect(0, 0, w, h); cc.drawImage(snap, 0, 0);
          cc.globalCompositeOperation = 'multiply'; cc.fillStyle = c[0]; cc.fillRect(0, 0, w, h);
          ctx.drawImage(ch, c[1], c[2]);
        }
        break;
      }
      case 'glitch': {
        if (k < 0.06) break;
        const snap = snapshot(ctx, env, w, h), seed = Math.floor(t * 14), n = Math.round(3 + k * 10);
        for (let i = 0; i < n; i++) {
          const y = hash(i, seed) * h, sh = (0.01 + hash(i, seed + 1) * 0.07) * h, dx = (hash(i, seed + 2) - 0.5) * k * 0.3 * w;
          ctx.drawImage(snap, 0, y, w, sh, dx, y, w, sh);
        }
        break;
      }
      case 'shake': {
        if (k < 0.02) break;
        const snap = snapshot(ctx, env, w, h), f = Math.floor(t * 30);
        const dx = (hash(f, 1) - 0.5) * k * 3.5 * u, dy = (hash(f, 2) - 0.5) * k * 3.5 * u;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(snap, -w * 0.025 + dx, -h * 0.025 + dy, w * 1.05, h * 1.05);
        break;
      }
      case 'zoom': {
        const s = 1 + k * 0.12;
        if (s < 1.002) break;
        const snap = snapshot(ctx, env, w, h);
        ctx.drawImage(snap, w / 2 - (w * s) / 2, h / 2 - (h * s) / 2, w * s, h * s);
        break;
      }
      case 'flash': {
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = rgba(L.color || '#ffffff', clamp(k * 0.7, 0, 1));
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'pixelate': {
        const block = 1 + k * 3.5 * u;
        if (block < 2) break;
        const snap = snapshot(ctx, env, w, h), sw = Math.max(2, Math.round(w / block)), sh = Math.max(2, Math.round(h / block));
        const small = env.scratch(1, sw, sh), sc = small.getContext('2d');
        sc.imageSmoothingEnabled = true;
        sc.clearRect(0, 0, sw, sh); sc.drawImage(snap, 0, 0, sw, sh);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        break;
      }
      case 'grade': {
        const snap = snapshot(ctx, env, w, h);
        ctx.filter = 'hue-rotate(' + (L.hue || 0) + 'deg) saturate(' + (L.sat == null ? 1 : L.sat) + ') contrast(' + (L.contrast == null ? 1 : L.contrast) + ') brightness(' + (L.bright == null ? 1 : L.bright) + ')';
        ctx.drawImage(snap, 0, 0);
        ctx.filter = 'none';
        break;
      }
      case 'mirror': {
        const snap = snapshot(ctx, env, w, h);
        ctx.translate(w, 0); ctx.scale(-1, 1);
        ctx.drawImage(snap, 0, 0, w / 2, h, 0, 0, w / 2, h);
        break;
      }
      default: {
        const f = VZ.FX[L.fx];
        if (f) f(ctx, w, h, t, L, S, env, u, k, ta);
      }
    }
  }

  /* ---------- main entry ---------- */
  function applyTransform(ctx, w, h, L, S) {
    ctx.translate((L.x == null ? 0.5 : L.x) * w, (L.y == null ? 0.5 : L.y) * h);
    ctx.rotate(((L.rotation || 0) * Math.PI) / 180);
    let s = L.scale == null ? 1 : L.scale;
    if (L.reactAmount) s *= 1 + reactVal(S, L.reactBand) * L.reactAmount * 0.35;
    ctx.scale(s, s);
  }

  VZ._k = { TAU, clamp, lerp, frac, parseColor, rgba, mix, hash, mulberry32, easeOut, easeOutBack, rect, bandAvg, barPos, strokeGrad, reactVal, snapshot, timeAlpha, REACT_BANDS, BLENDS, F_TRANSFORM, F_REACT, F_LOOK, F_TIME, common };
  const errored = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  VZ.renderFrame = function (ctx, w, h, t, project, S, env) {
    const u = Math.min(w, h) / 100;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'; ctx.shadowBlur = 0;
    ctx.fillStyle = project.bgColor || '#0b0b14';
    ctx.fillRect(0, 0, w, h);
    ctx.__meta = project.meta || {};
    for (const L of project.layers) {
      if (!L.visible) continue;
      const ta = timeAlpha(L, t);
      const inRange = t >= (L.start || 0) && (L.end == null || t < L.end);
      if (ta <= 0 && !(L.type === 'effect' && L.fx === 'fadeblack' && inRange)) continue;
      ctx.save();
      try {
        const base = (L.opacity == null ? 1 : L.opacity) * ta;
        ctx.globalAlpha = base;
        ctx.globalCompositeOperation = L.blend || 'source-over';
        ctx.__baseAlpha = base;
        switch (L.type) {
          case 'background': drawBackground(ctx, w, h, t, L, S, env, u); break;
          case 'particles': drawParticles(ctx, w, h, t, L, S, u); break;
          case 'effect': ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; drawEffect(ctx, w, h, t, L, S, env, u, ta); break;
          default:
            applyTransform(ctx, w, h, L, S);
            if (VZ.layerPost) VZ.layerPost(ctx, w, h, t, L, S, u);
            if (VZ.DRAW[L.type]) VZ.DRAW[L.type](ctx, w, h, t, L, S, env, u);
            else if (L.type === 'visualizer') drawVisualizer(ctx, w, h, t, L, S, env, u);
            else if (L.type === 'text') drawText(ctx, w, h, L, u);
            else if (L.type === 'lyrics') drawLyrics(ctx, w, h, t, L, u);
            else if (L.type === 'image') drawImageLayer(ctx, w, h, t, L, env, u);
            else if (L.type === 'shape') drawShape(ctx, w, h, L, u);
        }
      } catch (e) {
        if (errored && !errored.has(L)) { errored.add(L); console.error('Layer error (' + L.type + '):', e); }
      }
      ctx.restore();
    }
  };

  /* ---------- lyric file parsers ---------- */
  VZ.parseLyricsFile = function (text, name, shift) {
    shift = shift || 0;
    const out = [];
    const toSec = (h, m, s) => (+h || 0) * 3600 + (+m || 0) * 60 + parseFloat(String(s).replace(',', '.'));
    text = String(text).replace(/^\ufeff/, '').replace(/\r/g, '');
    if (/-->/.test(text)) {
      for (const block of text.split(/\n\n+/)) {
        const m = block.match(/(\d+):(\d+):(\d+[.,]\d+)\s*-->\s*(\d+):(\d+):(\d+[.,]\d+)/);
        if (!m) continue;
        const body = block.split('\n').filter((l) => !/-->/.test(l) && !/^\d+$/.test(l.trim())).join(' ').replace(/<[^>]+>/g, '').trim();
        if (body) out.push({ t0: toSec(m[1], m[2], m[3]) - shift, t1: toSec(m[4], m[5], m[6]) - shift, text: body });
      }
    } else {
      for (const line of text.split('\n')) {
        const stamps = [...line.matchAll(/\[(\d+):(\d+(?:[.,]\d+)?)\]/g)];
        const body = line.replace(/\[[^\]]*\]/g, '').trim();
        if (!stamps.length || !body) continue;
        for (const s of stamps) out.push({ t0: toSec(0, s[1], s[2]) - shift, t1: null, text: body });
      }
    }
    return out.filter((l) => l.t0 > -0.5).map((l) => ({ t0: Math.max(0, +l.t0.toFixed(2)), t1: l.t1 == null ? null : +l.t1.toFixed(2), text: l.text })).sort((a, b) => a.t0 - b.t0);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VZ;
})(typeof window !== 'undefined' ? window : globalThis);
