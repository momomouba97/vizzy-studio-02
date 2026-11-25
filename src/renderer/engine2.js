/* Vizzy Studio \u2013 engine extensions (v2):
 * more visualizers, particle modes, effects, video overlay layer, in/out animations,
 * idle motion, per-layer filters, richer text / lyric options.
 */
(function (root) {
  'use strict';
  const VZ = root.VZ;
  const K = VZ._k, TAU = K.TAU, clamp = K.clamp, mix = K.mix, rgba = K.rgba, hash = K.hash, frac = K.frac, easeOut = K.easeOut, easeOutBack = K.easeOutBack;
  const T = VZ.TYPES;
  const fieldOf = (type, key) => T[type].fields.find((f) => f.key === key);
  const insertAfter = (type, afterKey, ...fields) => { const a = T[type].fields; const i = a.findIndex((f) => f.key === afterKey); a.splice(i < 0 ? a.length : i + 1, 0, ...fields); };
  const addDefaults = (type, extra) => { const d0 = T[type].defaults; T[type].defaults = () => Object.assign({}, extra, d0()); };
  const bounceOut = (x) => { const n1 = 7.5625, d1 = 2.75; if (x < 1 / d1) return n1 * x * x; if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75; if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375; return n1 * (x -= 2.625 / d1) * x + 0.984375; };

  VZ.isVideoLayer = (L) => (L.type === 'background' && L.mode === 'video') || L.type === 'video';

  /* =====================================================================
   * 1. Animation (in / out / idle) + filters for every transform layer
   * ===================================================================== */
  const ANIMS = [['none', 'None'], ['fade', 'Fade'], ['slideUp', 'Slide up'], ['slideDown', 'Slide down'], ['slideLeft', 'Slide from left'], ['slideRight', 'Slide from right'], ['zoomIn', 'Zoom in'], ['zoomOut', 'Zoom out'], ['pop', 'Pop (bounce)'], ['spin', 'Spin'], ['flip', 'Flip'], ['drop', 'Drop & bounce'], ['blur', 'Blur']];
  const IDLES = [['none', 'None'], ['float', 'Float'], ['sway', 'Sway'], ['pulse', 'Breathing'], ['spin', 'Rotate'], ['shake', 'Jitter']];
  const F_ANIM = [
    { key: 'animIn', label: 'Enter', type: 'select', options: ANIMS, group: 'Animation' },
    { key: 'animOut', label: 'Exit', type: 'select', options: ANIMS },
    { key: 'animDur', label: 'Duration (s)', type: 'range', min: 0.1, max: 3, step: 0.05, show: (L) => L.animIn !== 'none' || L.animOut !== 'none' },
    { key: 'idle', label: 'Loop motion', type: 'select', options: IDLES },
    { key: 'idleAmt', label: 'Motion amount', type: 'range', min: 0, max: 2, step: 0.01, show: (L) => L.idle !== 'none' },
  ];
  const F_FILTER = [
    { key: 'fBlur', label: 'Blur', type: 'range', min: 0, max: 10, step: 0.1, group: 'Filters' },
    { key: 'fBright', label: 'Brightness', type: 'range', min: 0, max: 2.5, step: 0.01 },
    { key: 'fContrast', label: 'Contrast', type: 'range', min: 0, max: 2.5, step: 0.01 },
    { key: 'fSat', label: 'Saturation', type: 'range', min: 0, max: 3, step: 0.01 },
    { key: 'fHue', label: 'Hue shift', type: 'range', min: -180, max: 180, step: 1 },
    { key: 'fShadow', label: 'Drop shadow', type: 'range', min: 0, max: 10, step: 0.1 },
    { key: 'fShadowColor', label: 'Shadow color', type: 'color', show: (L) => L.fShadow > 0 },
  ];
  const ANIM_D = { animIn: 'none', animOut: 'none', animDur: 0.6, idle: 'none', idleAmt: 0.5 };
  const FILTER_D = { fBlur: 0, fBright: 1, fContrast: 1, fSat: 1, fHue: 0, fShadow: 0, fShadowColor: '#000000' };

  function animStep(ctx, type, q, sign, u, w, h, acc) {
    if (type === 'none' || q >= 1) return;
    q = clamp(q, 0, 1);
    const e = easeOut(q), dist = 14 * u;
    switch (type) {
      case 'fade': acc.a *= q; break;
      case 'slideUp': ctx.translate(0, sign * (1 - e) * dist); acc.a *= clamp(q * 1.8, 0, 1); break;
      case 'slideDown': ctx.translate(0, -sign * (1 - e) * dist); acc.a *= clamp(q * 1.8, 0, 1); break;
      case 'slideLeft': ctx.translate(-sign * (1 - e) * dist * 2.2, 0); acc.a *= clamp(q * 1.8, 0, 1); break;
      case 'slideRight': ctx.translate(sign * (1 - e) * dist * 2.2, 0); acc.a *= clamp(q * 1.8, 0, 1); break;
      case 'zoomIn': { const s = 0.3 + 0.7 * e; ctx.scale(s, s); acc.a *= clamp(q * 2, 0, 1); break; }
      case 'zoomOut': { const s = 1 + (1 - e) * 1.1; ctx.scale(s, s); acc.a *= clamp(q * 1.6, 0, 1); break; }
      case 'pop': { const s = Math.max(0.001, easeOutBack(q)); ctx.scale(s, s); acc.a *= clamp(q * 3, 0, 1); break; }
      case 'spin': { ctx.rotate(-sign * (1 - e) * TAU * 0.75); const s = Math.max(0.001, e); ctx.scale(s, s); acc.a *= q; break; }
      case 'flip': ctx.scale(Math.max(0.001, Math.cos((1 - e) * Math.PI / 2)), 1); acc.a *= q; break;
      case 'drop': ctx.translate(0, -sign * (1 - bounceOut(q)) * dist * 2.4); acc.a *= clamp(q * 4, 0, 1); break;
      case 'blur': acc.blur += (1 - e) * 14 * (u / 5); acc.a *= q; break;
    }
  }

  VZ.layerPost = function (ctx, w, h, t, L, S, u) {
    const acc = { a: 1, blur: 0 };
    if (L.idle && L.idle !== 'none') {
      const m = L.idleAmt == null ? 0.5 : L.idleAmt;
      switch (L.idle) {
        case 'float': ctx.translate(0, Math.sin(t * 1.6) * m * 1.4 * u); break;
        case 'sway': ctx.rotate(Math.sin(t * 1.3) * m * 0.06); break;
        case 'pulse': { const s = 1 + Math.sin(t * 2.4) * m * 0.045; ctx.scale(s, s); break; }
        case 'spin': ctx.rotate(t * m * 0.6); break;
        case 'shake': { const f = Math.floor(t * 24); ctx.translate((hash(f, 1) - 0.5) * m * u * 0.9, (hash(f, 2) - 0.5) * m * u * 0.9); break; }
      }
    }
    const dur = Math.max(0.05, L.animDur || 0.6), lt = t - (L.start || 0), le = (L.end == null ? Infinity : L.end) - t;
    if (L.animIn && L.animIn !== 'none' && lt < dur) animStep(ctx, L.animIn, lt / dur, 1, u, w, h, acc);
    if (L.animOut && L.animOut !== 'none' && le < dur) animStep(ctx, L.animOut, le / dur, -1, u, w, h, acc);
    ctx.globalAlpha *= acc.a;
    const f = [];
    const blur = (L.fBlur || 0) * u * 0.25 + acc.blur;
    if (blur > 0.05) f.push('blur(' + blur.toFixed(2) + 'px)');
    if (L.fBright != null && L.fBright !== 1) f.push('brightness(' + L.fBright + ')');
    if (L.fContrast != null && L.fContrast !== 1) f.push('contrast(' + L.fContrast + ')');
    if (L.fSat != null && L.fSat !== 1) f.push('saturate(' + L.fSat + ')');
    if (L.fHue) f.push('hue-rotate(' + L.fHue + 'deg)');
    if (L.fShadow > 0) f.push('drop-shadow(0px ' + (L.fShadow * u * 0.12).toFixed(2) + 'px ' + (L.fShadow * u * 0.35).toFixed(2) + 'px ' + rgba(L.fShadowColor || '#000000', 0.85) + ')');
    if (f.length) ctx.filter = f.join(' ');
  };

  ['visualizer', 'text', 'lyrics', 'image', 'shape'].forEach((type) => {
    T[type].fields.push(...F_ANIM, ...F_FILTER);
    addDefaults(type, Object.assign({}, ANIM_D, FILTER_D));
  });

  /* =====================================================================
   * 2. Text / lyrics options
   * ===================================================================== */
  const TEXT_EXTRA = [
    { key: 'lineHeight', label: 'Line height', type: 'range', min: 0.7, max: 2.5, step: 0.01 },
    { key: 'gradient', label: 'Gradient fill', type: 'checkbox' },
    { key: 'color2', label: 'Gradient color', type: 'color', show: (L) => !!L.gradient },
    { key: 'boxOpacity', label: 'Background box', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'boxColor', label: 'Box color', type: 'color', show: (L) => L.boxOpacity > 0 },
    { key: 'boxPad', label: 'Box padding', type: 'range', min: 0, max: 6, step: 0.05, show: (L) => L.boxOpacity > 0 },
  ];
  const TEXT_D = { lineHeight: 1.2, gradient: false, color2: '#8b5cf6', boxOpacity: 0, boxColor: '#000000', boxPad: 1.2 };
  ['text', 'lyrics'].forEach((type) => { insertAfter(type, 'glowColor', ...TEXT_EXTRA); addDefaults(type, TEXT_D); });
  const anim = fieldOf('lyrics', 'anim');
  anim.options = [['pop', 'Pop in'], ['fade', 'Fade'], ['slide', 'Slide up'], ['zoom', 'Zoom in'], ['blurin', 'Blur in'], ['flicker', 'Neon flicker'], ['glitch', 'Glitch in'], ['none', 'None'],
    ['karaoke', '\u2605 Karaoke highlight (word by word)'], ['wordpop', '\u2605 Word pop (kinetic)'], ['typewriter', '\u2605 Typewriter'], ['bounce', '\u2605 Bouncing letters'], ['wave', '\u2605 Wavy letters']];
  insertAfter('lyrics', 'dim', { key: 'hiColor', label: 'Highlight color', type: 'color', show: (L) => /^(karaoke|wordpop|wave)$/.test(L.anim) },
    { key: 'lead', label: 'Appear early (s)', type: 'range', min: 0, max: 1, step: 0.01 });
  fieldOf('lyrics', 'dim').show = (L) => L.mode === 'stack' || L.anim === 'wordpop';
  addDefaults('lyrics', { hiColor: '#facc15', lead: 0.12 });

  /* =====================================================================
   * 3. Visualizers
   * ===================================================================== */
  const V = VZ.VIZ;
  const tmpOf = (env) => env._tmpS || (env._tmpS = VZ.newSample());
  const progressOf = (S) => { const A = S._A, d = A && A.duration; return d ? clamp(S._t / d, 0, 1) : (S._t % 30) / 30; };

  V.sunburst = (ctx, w, h, t, L, S, env, u, B) => {
    const n = Math.max(8, L.count | 0), R = L.radius * u, len = L.length * u * 1.6, rot = S.cum * 0.35, ha = (TAU / n) * (1 - (L.gap || 0.35)) * 0.5;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rot, p = L.symmetric ? (2 * Math.min(i, n - i)) / n : i / n;
      const a = B.amp(Math.min(1, p), n), l = Math.max(len * 0.05, a * len), r1 = R + l;
      ctx.fillStyle = mix(B.c1, B.c2, p);
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang - ha) * R, Math.sin(ang - ha) * R);
      ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
      ctx.lineTo(Math.cos(ang + ha) * R, Math.sin(ang + ha) * R);
      ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = Math.max(1, 0.25 * u); ctx.strokeStyle = rgba(B.c1, 0.55);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.98, 0, TAU); ctx.stroke();
  };

  V.ridge = (ctx, w, h, t, L, S, env, u, B) => {
    const rows = Math.max(3, L.lines | 0), cols = Math.max(12, L.count | 0), tmp = tmpOf(env), A = S._A, W = B.W, H = B.H;
    for (let r = rows - 1; r >= 0; r--) {
      if (A) A.sample(S._t - r * 0.085, tmp); else tmp.bands.fill(0.4);
      const yBase = H / 2 - r * ((H * 0.78) / rows), peak = H * 0.34 * (1 - (r / rows) * 0.4);
      const pts = [];
      for (let i = 0; i < cols; i++) {
        const x = -W / 2 + (i / (cols - 1)) * W, pos = L.symmetric ? Math.abs(i - (cols - 1) / 2) / ((cols - 1) / 2) : i / (cols - 1);
        const a = VZ.ampOf(K.bandAvg(tmp.bands, pos, cols), B.sens), tap = Math.pow(Math.sin((Math.PI * i) / (cols - 1)), 0.8);
        pts.push([x, yBase - a * peak * tap]);
      }
      ctx.beginPath(); ctx.moveTo(pts[0][0], yBase + H);
      ctx.lineTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < cols; i++) { const mx = (pts[i - 1][0] + pts[i][0]) / 2, my = (pts[i - 1][1] + pts[i][1]) / 2; ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my); }
      ctx.lineTo(pts[cols - 1][0], pts[cols - 1][1]); ctx.lineTo(pts[cols - 1][0], yBase + H); ctx.closePath();
      ctx.fillStyle = 'rgba(6,4,16,0.9)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); // outline only the curve (no side / bottom edges)
      for (let i = 1; i < cols; i++) { const mx = (pts[i - 1][0] + pts[i][0]) / 2, my = (pts[i - 1][1] + pts[i][1]) / 2; ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my); }
      ctx.lineTo(pts[cols - 1][0], pts[cols - 1][1]);
      ctx.lineWidth = Math.max(1, L.lineWidth * u * 0.6); ctx.strokeStyle = mix(B.c1, B.c2, r / rows); ctx.stroke();
    }
  };

  V.lissajous = (ctx, w, h, t, L, S, env, u, B) => {
    const N = 360, D = 34, buf = env._lis || (env._lis = new Float32Array(N + D + 8));
    VZ.waveOf(S, N + D, 0.045, buf);
    const gain = 1.7 * B.sens;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = Math.tanh(buf[i] * gain) * (B.W / 2), y = Math.tanh(buf[i + D] * gain) * (B.H / 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = Math.max(1, L.lineWidth * u); ctx.lineJoin = 'round';
    ctx.strokeStyle = K.strokeGrad(ctx, -B.W / 2, 0, B.W / 2, 0, B.c1, B.c2); ctx.stroke();
  };

  V.segments = (ctx, w, h, t, L, S, env, u, B) => {
    const n = Math.max(2, L.count | 0), rows = 16, cw = B.W / n, ch = B.H / rows, gx = cw * (L.gap == null ? 0.3 : L.gap) * 0.5, gy = ch * 0.18;
    for (let i = 0; i < n; i++) {
      const lit = Math.max(1, Math.ceil(B.amp(K.barPos(i, n, L.symmetric), n) * rows));
      for (let j = 0; j < lit; j++) {
        ctx.fillStyle = mix(B.c2, B.c1, j / (rows - 1));
        ctx.fillRect(-B.W / 2 + i * cw + gx, B.H / 2 - (j + 1) * ch + gy, Math.max(1, cw - gx * 2), Math.max(1, ch - gy * 2));
      }
    }
  };

  V.bubbles = (ctx, w, h, t, L, S, env, u, B) => {
    const n = Math.max(4, L.count | 0), maxR = Math.min(B.H * 0.5, (B.W / n) * 2.6);
    ctx.lineWidth = Math.max(1, L.lineWidth * u * 0.5);
    for (let i = 0; i < n; i++) {
      const a = B.amp(n > 1 ? i / (n - 1) : 0, n), r = Math.max(u * 0.4, (0.12 + a * 0.88) * maxR);
      const x = -B.W / 2 + ((i + 0.5) / n) * B.W + Math.sin(t * 0.7 + i) * u, y = B.H / 2 - a * B.H * 0.65 - hash(i, 9) * B.H * 0.2 + Math.sin(t * 1.3 + i * 1.7) * u * 0.8;
      const col = mix(B.c1, B.c2, i / n);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.globalAlpha = (ctx.__baseAlpha == null ? 1 : ctx.__baseAlpha) * (0.18 + a * 0.3); ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = (ctx.__baseAlpha == null ? 1 : ctx.__baseAlpha) * 0.85; ctx.strokeStyle = col; ctx.stroke();
    }
  };

  V.tunnel = (ctx, w, h, t, L, S, env, u, B) => {
    const rings = Math.max(3, L.lines | 0), R = L.radius * u, sp = L.speed == null ? 1 : L.speed, sides = 6;
    for (let k = 0; k < rings; k++) {
      const z = frac(k / rings + S.cum * 0.07 * sp), r = R * (0.08 + z * z * 3.4) * (1 + S.bass * 0.12);
      ctx.globalAlpha = (ctx.__baseAlpha == null ? 1 : ctx.__baseAlpha) * Math.sin(z * Math.PI);
      ctx.lineWidth = Math.max(1, (0.15 + z * 1.6) * L.lineWidth * u * 1.4); ctx.strokeStyle = mix(B.c1, B.c2, z);
      const rot = z * 0.5 + S.cum * 0.12;
      ctx.beginPath();
      for (let s = 0; s <= sides; s++) { const a = rot + (s / sides) * TAU; const px = Math.cos(a) * r, py = Math.sin(a) * r; if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    }
  };

  V.starfield = (ctx, w, h, t, L, S, env, u, B) => {
    const n = Math.max(20, (L.count | 0) * 3), sp = L.speed == null ? 1 : L.speed, reach = Math.max(w, h) * 0.62;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const sx = hash(i, 11) * 2 - 1, sy = hash(i, 12) * 2 - 1, z = frac(hash(i, 13) + S.cum * 0.1 * sp), z0 = Math.max(0, z - (0.012 + S.bass * 0.05 * sp));
      const x1 = sx * reach * z * z, y1 = sy * reach * z * z, x0 = sx * reach * z0 * z0, y0 = sy * reach * z0 * z0;
      ctx.globalAlpha = (ctx.__baseAlpha == null ? 1 : ctx.__baseAlpha) * clamp(z * 2.5, 0, 1);
      ctx.strokeStyle = mix(B.c1, B.c2, hash(i, 14)); ctx.lineWidth = Math.max(0.6, (0.3 + z * 1.8) * L.lineWidth * u * 0.5);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  };

  V.plasma = (ctx, w, h, t, L, S, env, u, B) => {
    const pw = 72, ph = Math.max(8, Math.round((72 * B.H) / B.W)), sc = env.scratch(3, pw, ph), sctx = sc.getContext('2d');
    const img = sctx.createImageData(pw, ph), d = img.data, tt = S.cum * 1.4 + S.bass * 0.6, c1 = K.parseColor(B.c1), c2 = K.parseColor(B.c2);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        let v = (Math.sin(x * 0.17 + tt) + Math.sin(y * 0.23 + tt * 1.3) + Math.sin((x + y) * 0.11 + tt * 0.7) + Math.sin(Math.hypot(x - pw / 2, y - ph / 2) * 0.17 - tt) + 4) / 8;
        v = clamp((v - 0.5) * 2.1 + 0.5, 0, 1);
        const o = (y * pw + x) * 4;
        d[o] = c2[0] + (c1[0] - c2[0]) * v; d[o + 1] = c2[1] + (c1[1] - c2[1]) * v; d[o + 2] = c2[2] + (c1[2] - c2[2]) * v; d[o + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(sc, -B.W / 2, -B.H / 2, B.W, B.H);
  };

  V.vinyl = (ctx, w, h, t, L, S, env, u, B) => {
    const R = L.radius * u * (1 + S.bass * 0.025), rot = S.cum * 0.9;
    ctx.save(); ctx.rotate(rot);
    ctx.fillStyle = '#0a0a0e'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 1;
    for (let g = 0.36; g < 0.98; g += 0.045) { ctx.strokeStyle = 'rgba(255,255,255,' + (0.035 + 0.03 * Math.sin(g * 40)) + ')'; ctx.beginPath(); ctx.arc(0, 0, R * g, 0, TAU); ctx.stroke(); }
    for (let k = 0; k < 2; k++) { // sheen
      const a0 = k * Math.PI + 0.3; ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R * 0.97, a0, a0 + 0.55); ctx.closePath(); ctx.fill();
    }
    const g = ctx.createLinearGradient(-R * 0.34, -R * 0.34, R * 0.34, R * 0.34); g.addColorStop(0, B.c1); g.addColorStop(1, B.c2);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 0.34, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(R * 0.24, 0, R * 0.025, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a0a0e'; ctx.beginPath(); ctx.arc(0, 0, R * 0.045, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(1, 0.3 * u); ctx.strokeStyle = rgba(B.c1, 0.7); ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  };

  V.spectrogram = (ctx, w, h, t, L, S, env, u, B) => {
    const cols = clamp((L.count | 0) * 2, 32, 200), rows = 22, cw = B.W / cols, ch = B.H / rows, tmp = tmpOf(env), A = S._A, base = ctx.__baseAlpha == null ? 1 : ctx.__baseAlpha;
    ctx.shadowBlur = 0;
    for (let c = 0; c < cols; c++) {
      if (A) A.sample(S._t - ((cols - 1 - c) / cols) * 6, tmp); else tmp.bands.fill(0.3);
      for (let r = 0; r < rows; r++) {
        const a = VZ.ampOf(K.bandAvg(tmp.bands, r / (rows - 1), rows), B.sens);
        if (a < 0.06) continue;
        ctx.globalAlpha = base * clamp(a * 1.25, 0, 1); ctx.fillStyle = mix(B.c2, B.c1, a);
        ctx.fillRect(-B.W / 2 + c * cw, B.H / 2 - (r + 1) * ch, cw + 0.6, ch + 0.6);
      }
    }
  };

  V.waveprogress = (ctx, w, h, t, L, S, env, u, B) => {
    const n = Math.max(10, L.count | 0), A = S._A, peaks = A && A.peaks ? A.peaks(n) : new Float32Array(n).fill(0.4), prog = progressOf(S), bw = B.W / n, bar = Math.max(1, bw * (1 - (L.gap == null ? 0.35 : L.gap))), base = ctx.__baseAlpha == null ? 1 : ctx.__baseAlpha;
    for (let i = 0; i < n; i++) {
      const played = (i + 0.5) / n <= prog, near = Math.abs((i + 0.5) / n - prog) < 1.5 / n, pk = Math.max(0.04, peaks[i]) * (near ? 1 + S.beat * 0.2 : 1), x = -B.W / 2 + i * bw + (bw - bar) / 2;
      const col = played ? B.c1 : B.c2;
      ctx.globalAlpha = base * (played ? 1 : 0.5); ctx.fillStyle = col;
      const th = pk * B.H * 0.62, bh = pk * B.H * 0.38;
      K.rect(ctx, x, -th, bar, th, L.rounded);
      ctx.globalAlpha = base * (played ? 0.45 : 0.22); K.rect(ctx, x, 0, bar, bh, L.rounded);
    }
  };

  V.progressbar = (ctx, w, h, t, L, S, env, u, B) => {
    const th = Math.max(2, L.lineWidth * u * 1.5), p = progressOf(S), W = B.W;
    ctx.fillStyle = rgba(B.c2, 0.3); K.rect(ctx, -W / 2, -th / 2, W, th, true);
    if (p > 0) { ctx.fillStyle = K.strokeGrad(ctx, -W / 2, 0, W / 2, 0, B.c2, B.c1); K.rect(ctx, -W / 2, -th / 2, Math.max(th, W * p), th, true); }
    ctx.fillStyle = B.c1; ctx.beginPath(); ctx.arc(-W / 2 + W * p, 0, th * (1.05 + S.beat * 0.3), 0, TAU); ctx.fill();
  };

  V.hexgrid = (ctx, w, h, t, L, S, env, u, B) => {
    const cols = clamp(Math.round((L.count | 0) / 5), 6, 32), size = B.W / cols / 1.732, rows = Math.max(2, Math.floor(B.H / (size * 1.5)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = -B.W / 2 + (c + 0.5 + (r % 2 ? 0.5 : 0)) * size * 1.732, cy = -B.H / 2 + (r + 0.5) * size * 1.5;
        const a = B.amp(K.barPos(c, cols, L.symmetric), cols) * (0.55 + 0.45 * (1 - r / rows)), s = size * (0.62 + 0.36 * a);
        ctx.globalAlpha = (ctx.__baseAlpha == null ? 1 : ctx.__baseAlpha) * (0.08 + a * 0.92); ctx.fillStyle = mix(B.c2, B.c1, a);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const ang = Math.PI / 6 + (k * Math.PI) / 3; const px = cx + Math.cos(ang) * s, py = cy + Math.sin(ang) * s; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
        ctx.closePath(); ctx.fill();
      }
    }
  };

  // schema for the new styles
  const vf = (k) => fieldOf('visualizer', k);
  vf('style').options.push(['sunburst', 'Sunburst rays'], ['ridge', 'Ridge lines (Joy Division)'], ['lissajous', 'Oscilloscope (Lissajous)'], ['segments', 'LED segments'], ['bubbles', 'Bubbles'], ['tunnel', 'Neon tunnel'], ['starfield', 'Starfield warp'], ['plasma', 'Plasma'], ['vinyl', 'Spinning vinyl record'], ['spectrogram', 'Spectrogram (scrolling)'], ['waveprogress', 'Waveform + progress (SoundCloud)'], ['progressbar', 'Progress bar'], ['hexgrid', 'Hexagon grid']);
  const circleLike = /^(circlebars|circlewave|rings|sunburst|tunnel|vinyl)$/;
  vf('count').show = (L) => /^(bars|mirror|dots|spectrum|circlebars|rings|sunburst|ridge|segments|bubbles|spectrogram|waveprogress|hexgrid|starfield)$/.test(L.style);
  vf('width').show = (L) => !circleLike.test(L.style) && L.style !== 'starfield';
  vf('height').show = (L) => !circleLike.test(L.style) && L.style !== 'starfield' && L.style !== 'progressbar';
  vf('radius').show = (L) => circleLike.test(L.style);
  vf('length').show = (L) => /^(circlebars|circlewave|rings|sunburst)$/.test(L.style);
  vf('gap').show = (L) => /^(bars|mirror|dots|circlebars|sunburst|segments|waveprogress)$/.test(L.style);
  vf('rounded').show = (L) => /^(bars|mirror|dots|circlebars|waveprogress)$/.test(L.style);
  vf('symmetric').show = (L) => /^(bars|mirror|dots|spectrum|circlebars|circlewave|sunburst|ridge|segments|hexgrid)$/.test(L.style);
  vf('lineWidth').show = (L) => /^(wave|circlewave|rings|lissajous|tunnel|ridge|progressbar|starfield|bubbles)$/.test(L.style);
  insertAfter('visualizer', 'sens', { key: 'lines', label: 'Rows / rings', type: 'range', min: 3, max: 40, step: 1, show: (L) => /^(ridge|tunnel)$/.test(L.style) },
    { key: 'speed', label: 'Speed', type: 'range', min: 0, max: 4, step: 0.05, show: (L) => /^(tunnel|starfield)$/.test(L.style) });
  addDefaults('visualizer', { lines: 14, speed: 1 });

  /* =====================================================================
   * 4. Particles
   * ===================================================================== */
  const P = VZ.PARTICLE;
  P.rain = (o) => ({ x: o.h1 * o.w, y: frac(o.h3 + o.S.cum * o.sp * (0.5 + o.h4 * 0.8)) * o.h, a: 0.65 * Math.sin(o.life * Math.PI + 0.3), rad: o.L.size * o.u * (0.2 + o.h6 * 0.35) });
  P.confetti = (o) => ({ x: (o.h1 + Math.sin(o.life * TAU * 3 + o.h5 * TAU) * 0.04) * o.w, y: o.life * o.h, a: clamp(Math.sin(o.life * Math.PI) * 2, 0, 1), rad: o.L.size * o.u * (0.5 + o.h6) * (1 + o.S.beat * 1.1) });
  P.bokeh = (o) => ({ x: o.h1 * o.w + Math.sin(o.t * 0.2 + o.h5 * TAU) * 0.03 * o.w, y: o.h2 * o.h + Math.sin(o.t * 0.17 + o.h6 * TAU) * 0.03 * o.h, a: 0.1 + 0.22 * (0.5 + 0.5 * Math.sin(o.t * 0.5 + o.h4 * TAU)), rad: o.L.size * o.u * (2.5 + o.h6 * 6) * (1 + o.r * 0.5) });
  P.fireflies = (o) => ({ x: (o.h1 + 0.06 * Math.sin(o.t * 0.3 + o.h5 * 10) + 0.04 * Math.sin(o.t * 0.71 + o.h6 * 20)) * o.w, y: (o.h2 + 0.05 * Math.sin(o.t * 0.27 + o.h3 * 12) + 0.04 * Math.cos(o.t * 0.63 + o.h4 * 9)) * o.h, a: 0.15 + 0.85 * Math.pow(Math.max(0, Math.sin(o.t * 1.4 + o.h3 * TAU)), 2) });
  P.embers = (o) => ({ x: (o.h1 + o.life * 0.08 + Math.sin(o.life * 8 + o.h5 * 6) * 0.02) * o.w, y: (1 - o.life) * o.h, a: Math.sin(o.life * Math.PI), rad: o.L.size * o.u * (0.3 + o.h6 * 0.7) * (1 - o.life * 0.7) * (1 + o.r * 1.6) });
  P.sparks = (o) => { const ang = -Math.PI / 2 + (o.h1 - 0.5) * 1.6, d = Math.pow(o.life, 0.6) * 0.55 * o.h; return { x: o.w * (0.15 + o.h2 * 0.7) + Math.cos(ang) * d * 0.6, y: o.h - Math.sin(-ang) * d + o.life * o.life * 0.25 * o.h, a: (1 - o.life) * (0.3 + 0.7 * clamp(o.S.beat + 0.3, 0, 1)), rad: o.L.size * o.u * (0.25 + o.h6 * 0.5) }; };
  fieldOf('particles', 'mode').options.push(['rain', 'Rain'], ['confetti', 'Confetti'], ['bokeh', 'Bokeh lights'], ['fireflies', 'Fireflies'], ['embers', 'Embers'], ['sparks', 'Sparks (beat-driven)']);

  /* =====================================================================
   * 5. Effects
   * ===================================================================== */
  const FX = VZ.FX;
  FX.bloom = (ctx, w, h, t, L, S, env, u, k) => {
    const snap = K.snapshot(ctx, env, w, h);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(k * 0.9, 0, 1);
    ctx.filter = 'blur(' + ((2 + k * 5) * u * 0.5).toFixed(2) + 'px) brightness(1.5)';
    ctx.drawImage(snap, 0, 0); ctx.filter = 'none';
  };
  FX.kaleidoscope = (ctx, w, h, t, L, S, env, u, k) => {
    const n = Math.max(2, (L.segments | 0) || 6), snap = K.snapshot(ctx, env, w, h), cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2, rot = t * 0.12;
    for (let i = 0; i < n; i++) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot + (i * TAU) / n); if (i % 2) ctx.scale(1, -1);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -Math.PI / n, Math.PI / n); ctx.closePath(); ctx.clip();
      ctx.drawImage(snap, -cx, -cy); ctx.restore();
    }
  };
  FX.ripple = (ctx, w, h, t, L, S, env, u, k) => {
    if (k < 0.02) return;
    const snap = K.snapshot(ctx, env, w, h), amp = k * u * 2.4, step = Math.max(2, Math.round(u * 0.6));
    for (let y = 0; y < h; y += step) { const dx = Math.sin(y * 0.045 / Math.max(0.5, u / 5) + t * 5) * amp; ctx.drawImage(snap, 0, y, w, step, dx - w * 0.02, y, w * 1.04, step); }
  };
  FX.zoomblur = (ctx, w, h, t, L, S, env, u, k) => {
    if (k < 0.02) return;
    const snap = K.snapshot(ctx, env, w, h);
    ctx.globalAlpha = 0.12;
    for (let i = 1; i <= 8; i++) { const s = 1 + i * k * 0.025; ctx.drawImage(snap, w / 2 - (w * s) / 2, h / 2 - (h * s) / 2, w * s, h * s); }
  };
  FX.duotone = (ctx, w, h, t, L, S, env, u, k) => {
    const snap = K.snapshot(ctx, env, w, h), sc = env.scratch(2, w, h), c = sc.getContext('2d');
    c.globalCompositeOperation = 'copy'; c.filter = 'grayscale(1) contrast(1.15)'; c.drawImage(snap, 0, 0); c.filter = 'none';
    c.globalCompositeOperation = 'screen'; c.fillStyle = L.color || '#1e1b4b'; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'multiply'; c.fillStyle = L.color2 || '#f472b6'; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clamp(k, 0, 1); ctx.drawImage(sc, 0, 0);
  };
  FX.letterbox = (ctx, w, h, t, L, S, env, u, k) => { const bar = clamp(k, 0, 1) * 0.18 * h; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar); };
  FX.strobe = (ctx, w, h, t, L, S, env, u, k) => { if (Math.floor(t * (L.rate || 8)) % 2 === 0) { ctx.fillStyle = rgba(L.color || '#ffffff', clamp(k * 0.8, 0, 1)); ctx.fillRect(0, 0, w, h); } };
  FX.lightleak = (ctx, w, h, t, L, S, env, u, k) => {
    const cols = [L.color || '#ff9a3c', L.color2 || '#ff3c8e', '#ffd27a'];
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const cx = w * (0.5 + 0.45 * Math.sin(t * 0.23 + i * 2.1)), cy = h * (0.5 + 0.4 * Math.cos(t * 0.31 + i * 1.3)), r = Math.max(w, h) * (0.35 + 0.15 * Math.sin(t * 0.4 + i));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, rgba(cols[i], clamp(k * 0.7, 0, 1))); g.addColorStop(1, rgba(cols[i], 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
  };
  FX.fadeblack = (ctx, w, h, t, L, S, env, u, k, ta) => { ctx.globalAlpha = clamp(1 - ta, 0, 1); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); };
  FX.wobble = (ctx, w, h, t, L, S, env, u, k) => {
    const snap = K.snapshot(ctx, env, w, h);
    ctx.translate(w / 2, h / 2); ctx.rotate(Math.sin(t * 1.7) * k * 0.035); const s = 1.04 + k * 0.05; ctx.scale(s, s);
    ctx.drawImage(snap, -w / 2, -h / 2);
  };
  Object.assign(VZ.FX_DEFAULT, { bloom: 0.6, kaleidoscope: 1, ripple: 0.5, zoomblur: 0.5, duotone: 1, letterbox: 0.6, strobe: 0.5, lightleak: 0.6, fadeblack: 1, wobble: 0.5 });
  VZ.DYNAMIC_FX.push('bloom', 'ripple', 'zoomblur', 'strobe', 'wobble');
  const fx = fieldOf('effect', 'fx');
  fx.options.push(['bloom', 'Bloom / glow'], ['kaleidoscope', 'Kaleidoscope'], ['ripple', 'Ripple distortion'], ['zoomblur', 'Zoom blur'], ['duotone', 'Duotone'], ['letterbox', 'Cinematic bars'], ['strobe', 'Strobe'], ['lightleak', 'Light leaks'], ['fadeblack', 'Fade from / to black'], ['wobble', 'Camera sway']);
  fieldOf('effect', 'amount').show = (L) => !/^(grade|mirror|kaleidoscope|fadeblack)$/.test(L.fx);
  fieldOf('effect', 'color').show = (L) => /^(vignette|flash|duotone|lightleak|strobe)$/.test(L.fx);
  fieldOf('effect', 'color').label = 'Color';
  insertAfter('effect', 'color', { key: 'color2', label: 'Color 2', type: 'color', show: (L) => /^(duotone|lightleak)$/.test(L.fx) },
    { key: 'segments', label: 'Segments', type: 'range', min: 2, max: 16, step: 1, show: (L) => L.fx === 'kaleidoscope' },
    { key: 'rate', label: 'Flashes / sec', type: 'range', min: 1, max: 30, step: 1, show: (L) => L.fx === 'strobe' });
  fieldOf('effect', 'reactBand').show = (L) => VZ.DYNAMIC_FX.indexOf(L.fx) >= 0;
  fieldOf('effect', 'reactAmount').show = (L) => VZ.DYNAMIC_FX.indexOf(L.fx) >= 0;
  addDefaults('effect', { color2: '#f472b6', segments: 6, rate: 8 });

  /* =====================================================================
   * 6. Video overlay layer
   * ===================================================================== */
  const C = K.common;
  T.video = {
    label: 'Video overlay', icon: '\u25b6',
    defaults: () => Object.assign(C({ src: null, size: 100, fit: 'cover', speed: 1, blend: 'screen', opacity: 0.6 }), ANIM_D, FILTER_D),
    fields: [
      { key: 'src', label: 'Video file', type: 'asset', kind: () => 'video', group: 'Video' },
      { key: 'fit', label: 'Fit', type: 'select', options: [['cover', 'Fill (crop)'], ['contain', 'Fit inside']] },
      { key: 'size', label: 'Size (%)', type: 'range', min: 5, max: 300, step: 1 },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.25, max: 3, step: 0.05 },
    ].concat(K.F_TRANSFORM, K.F_REACT, K.F_LOOK, K.F_TIME, F_ANIM, F_FILTER),
  };
  VZ.DRAW.video = (ctx, w, h, t, L, S, env, u) => {
    const a = L.src && env.getAsset(L.src.path);
    if (!a || a.readyState < 2) return;
    const iw = a.videoWidth, ih = a.videoHeight; if (!iw || !ih) return;
    const sc = (L.fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)) * (L.size / 100);
    ctx.drawImage(a, (-iw * sc) / 2, (-ih * sc) / 2, iw * sc, ih * sc);
  };
  VZ.videoTimeFor = function (L, t, dur) {
    if (!dur || !isFinite(dur)) return 0;
    return ((Math.max(0, t - (L.start || 0)) * (L.speed || 1)) % dur + dur) % dur;
  };
})(typeof window !== 'undefined' ? window : globalThis);
