/* Vizzy Studio \u2013 audio intelligence tools (all offline, pure JS):
 * tempo/BPM, musical key, loudness, song structure (sections), colour palette from artwork.
 */
(function (root) {
  'use strict';
  const VZ = (root.VZ = root.VZ || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /* ---------- tempo ---------- */
  async function onsetEnvelope(mono, sr, onProgress) {
    const N = 2048, hop = 512, fft = VZ._makeFFT(N);
    const frames = Math.max(2, Math.floor((mono.length - N) / hop));
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const re = new Float32Array(N), im = new Float32Array(N);
    const maxBin = Math.min(N / 2 - 1, Math.floor(9000 / (sr / N)));
    const prev = new Float32Array(N / 2);
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const o = f * hop;
      for (let i = 0; i < N; i++) { re[i] = mono[o + i] * win[i]; im[i] = 0; }
      fft(re, im);
      let flux = 0;
      for (let k = 1; k <= maxBin; k++) {
        const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (N / 4);
        const lm = Math.log(1 + 40 * m);
        const d = lm - prev[k];
        if (d > 0) flux += d;
        prev[k] = lm;
      }
      env[f] = flux;
      if (f % 800 === 0) { if (onProgress) onProgress(f / frames); await yieldUI(); }
    }
    return { env, fps: sr / hop };
  }

  VZ.estimateTempo = async function (mono, sr, onProgress) {
    if (mono.length < sr * 4) return { bpm: 0, confidence: 0, gridStart: 0 };
    const { env, fps } = await onsetEnvelope(mono, sr, onProgress);
    const n = env.length;
    // remove slow trend, keep positive part
    const w = Math.max(3, Math.round(fps * 0.5)), x = new Float32Array(n);
    let acc = 0;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
      const m = (pre[b] - pre[a]) / (b - a);
      x[i] = Math.max(0, env[i] - m);
      acc += x[i] * x[i];
    }
    const lagMin = Math.max(2, Math.floor((fps * 60) / 200)), lagMax = Math.ceil((fps * 60) / 55);
    const r = new Float64Array(lagMax * 2 + 3);
    for (let l = lagMin - 1; l <= lagMax * 2 + 2; l++) {
      let s = 0;
      for (let i = 0; i + l < n; i++) s += x[i] * x[i + l];
      r[l] = s / Math.max(1, n - l);
    }
    const r0 = acc / n || 1;
    const rs = (l) => (l < 1 ? 0 : 0.5 * (r[l - 1] || 0) + (r[l] || 0) + 0.5 * (r[l + 1] || 0)); // neighbour-smoothed (tempo is rarely a whole number of frames)
    let best = -1, bestScore = -1;
    for (let l = lagMin; l <= lagMax; l++) {
      const bpm = (60 * fps) / l;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 118) / 0.75, 2));
      const score = (rs(l) + 0.5 * rs(2 * l) + 0.25 * rs(Math.round(l / 2))) * prior;
      if (rs(l) >= rs(l - 1) && rs(l) >= rs(l + 1) && score > bestScore) { bestScore = score; best = l; }
    }
    if (best < 0) return { bpm: 0, confidence: 0, gridStart: 0 };
    let sw = 0, sl = 0, pk = 0;
    for (let l = best - 2; l <= best + 2; l++) { const v = Math.max(0, r[l] || 0); sw += v; sl += v * l; if (v > pk) pk = v; }
    const lagF = sw > 0 ? sl / sw : best;
    const bpm = (60 * fps) / lagF;
    // beat-grid phase
    const period = 60 / bpm, step = period / 24;
    let bestPh = 0, bestSum = -1;
    for (let ph = 0; ph < period; ph += step) {
      let s = 0;
      for (let t = ph; t < n / fps - 0.05; t += period) s += x[Math.min(n - 1, Math.round(t * fps))];
      if (s > bestSum) { bestSum = s; bestPh = ph; }
    }
    return { bpm: Math.round(bpm * 10) / 10, confidence: clamp(pk / r0, 0, 1), gridStart: bestPh };
  };
  VZ.beatGrid = function (bpm, gridStart, duration) {
    const out = [];
    if (!bpm) return out;
    const p = 60 / bpm;
    for (let t = gridStart; t < duration; t += p) out.push(Math.round(t * 1000) / 1000);
    return out;
  };

  /* ---------- key ---------- */
  const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function pearson(a, b) {
    const n = a.length; let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  VZ.detectKey = async function (mono, sr) {
    const N = 8192, hop = 4096, fft = VZ._makeFFT(N);
    if (mono.length < N * 2) return { key: '\u2014', confidence: 0 };
    const total = Math.floor((mono.length - N) / hop);
    const stride = Math.max(1, Math.floor(total / 900));
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const re = new Float32Array(N), im = new Float32Array(N), chroma = new Float64Array(12);
    const binHz = sr / N, lo = Math.ceil(55 / binHz), hi = Math.floor(2000 / binHz);
    const pcOf = new Int8Array(hi + 1);
    for (let i = lo; i <= hi; i++) pcOf[i] = (((Math.round(12 * Math.log2((i * binHz) / 440) + 69) % 12) + 12) % 12);
    for (let f = 0, c = 0; f < total; f += stride, c++) {
      const o = f * hop;
      for (let i = 0; i < N; i++) { re[i] = mono[o + i] * win[i]; im[i] = 0; }
      fft(re, im);
      for (let i = lo; i <= hi; i++) chroma[pcOf[i]] += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      if (c % 100 === 0) await yieldUI();
    }
    let best = -2, name = '\u2014', mode = '';
    for (let k = 0; k < 12; k++) {
      const rot = (prof) => { const out = new Array(12); for (let pc = 0; pc < 12; pc++) out[pc] = prof[(pc - k + 12) % 12]; return out; };
      const cM = pearson(Array.from(chroma), rot(KS_MAJ)), cm = pearson(Array.from(chroma), rot(KS_MIN));
      if (cM > best) { best = cM; name = NOTE[k]; mode = 'major'; }
      if (cm > best) { best = cm; name = NOTE[k]; mode = 'minor'; }
    }
    return { key: name + ' ' + mode, tonic: name, mode, confidence: clamp(best, 0, 1), chroma: Array.from(chroma) };
  };

  /* ---------- loudness ---------- */
  VZ.measureLoudness = function (mono, sr) {
    let s2 = 0, pk = 0;
    for (let i = 0; i < mono.length; i++) { const v = mono[i]; s2 += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
    const rms = Math.sqrt(s2 / Math.max(1, mono.length));
    const win = Math.floor(sr * 0.4), levels = [];
    for (let o = 0; o + win <= mono.length; o += win) {
      let e = 0; for (let i = o; i < o + win; i += 4) e += mono[i] * mono[i];
      levels.push(10 * Math.log10(e / (win / 4) + 1e-12));
    }
    levels.sort((a, b) => a - b);
    const q = (p) => (levels.length ? levels[Math.min(levels.length - 1, Math.floor(p * levels.length))] : -90);
    const db = (v) => 20 * Math.log10(v + 1e-9);
    return { rmsDb: db(rms), peakDb: db(pk), range: Math.max(0, q(0.95) - q(0.1)), clipping: pk >= 0.999 };
  };

  /* ---------- structure ---------- */
  VZ.detectSections = function (A) {
    const dur = A.duration;
    if (!A.raw || dur < 12) return [{ t0: 0, t1: dur, label: 'Song', energy: 1 }];
    const { bands, frames, rms, bass } = A.raw, NB = VZ.NB, FPS = VZ.AFPS;
    const secs = Math.floor(dur), G = 16, per = NB / G, D = G + 2;
    const feat = [], energy = new Float64Array(secs);
    for (let s = 0; s < secs; s++) {
      const v = new Float64Array(D), f0 = s * FPS, f1 = Math.min(frames, f0 + FPS);
      let cnt = 0, er = 0, eb = 0;
      for (let f = f0; f < f1; f++) {
        for (let g = 0; g < G; g++) {
          let m = 0;
          for (let b = Math.floor(g * per); b < Math.floor((g + 1) * per); b++) m += clamp((bands[f * NB + b] * 90 - 15) / 55, 0, 1);
          v[g] += m / per;
        }
        v[G] += rms[f]; v[G + 1] += bass[f]; er += rms[f]; eb += bass[f]; cnt++;
      }
      for (let d = 0; d < D; d++) v[d] /= Math.max(1, cnt);
      energy[s] = (er + eb) / Math.max(1, cnt);
      feat.push(v);
    }
    // z-normalise each dimension
    for (let d = 0; d < D; d++) {
      let m = 0, q = 0; for (let s = 0; s < secs; s++) m += feat[s][d]; m /= secs;
      for (let s = 0; s < secs; s++) q += (feat[s][d] - m) * (feat[s][d] - m);
      const sd = Math.sqrt(q / secs) || 1;
      for (let s = 0; s < secs; s++) feat[s][d] = (feat[s][d] - m) / sd;
    }
    const W = dur >= 60 ? 6 : 3, nov = new Float64Array(secs);
    for (let s = W; s <= secs - W; s++) {
      let dist = 0;
      for (let d = 0; d < D; d++) {
        let a = 0, b = 0;
        for (let k = 1; k <= W; k++) { a += feat[s - k][d]; b += feat[s + k - 1][d]; }
        const df = (a - b) / W; dist += df * df;
      }
      nov[s] = Math.sqrt(dist);
    }
    let mean = 0, sd = 0; for (let s = 0; s < secs; s++) mean += nov[s]; mean /= secs;
    for (let s = 0; s < secs; s++) sd += (nov[s] - mean) * (nov[s] - mean);
    sd = Math.sqrt(sd / secs);
    const thr = mean + 0.6 * sd, minDist = Math.max(6, dur / 14), maxCount = Math.max(2, Math.floor(dur / 15));
    const cand = [];
    for (let s = W; s <= secs - W; s++) {
      let isMax = nov[s] > thr;
      for (let k = -3; k <= 3 && isMax; k++) if (k && nov[s + k] !== undefined && nov[s + k] > nov[s]) isMax = false;
      if (isMax) cand.push(s);
    }
    cand.sort((a, b) => nov[b] - nov[a]);
    const picked = [];
    for (const s of cand) { if (picked.length >= maxCount) break; if (picked.every((p) => Math.abs(p - s) >= minDist)) picked.push(s); }
    picked.sort((a, b) => a - b);
    const bounds = [0].concat(picked, [dur]);
    const secList = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      let e = 0, c = 0;
      for (let s = Math.floor(bounds[i]); s < Math.min(secs, Math.ceil(bounds[i + 1])); s++) { e += energy[s]; c++; }
      secList.push({ t0: bounds[i], t1: bounds[i + 1], energy: c ? e / c : 0 });
    }
    const sorted = secList.map((x) => x.energy).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)] || 0;
    const avg = secList.reduce((a, x) => a + x.energy * (x.t1 - x.t0), 0) / dur;
    const cnt = {};
    secList.forEach((x, i) => {
      let base;
      if (i === 0 && x.energy < avg * 1.02 && secList.length > 1) base = 'Intro';
      else if (i === secList.length - 1 && x.energy < avg && secList.length > 2) base = 'Outro';
      else base = x.energy >= med * 1.05 && secList.length > 1 ? 'Chorus / Drop' : 'Verse';
      cnt[base] = (cnt[base] || 0) + 1;
      x.label = base === 'Intro' || base === 'Outro' ? base : base + ' ' + cnt[base];
    });
    return secList;
  };

  /* ---------- everything together ---------- */
  VZ.deepAnalyze = async function (A, onProgress) {
    const mono = A.mono, sr = A.sr;
    const tempo = await VZ.estimateTempo(mono, sr, (p) => onProgress && onProgress(p * 0.6));
    const key = await VZ.detectKey(mono, sr);
    if (onProgress) onProgress(0.8);
    const loud = VZ.measureLoudness(mono, sr);
    const sections = VZ.detectSections(A);
    if (onProgress) onProgress(1);
    const grid = VZ.beatGrid(tempo.bpm, tempo.gridStart, A.duration);
    return { bpm: tempo.bpm, bpmConfidence: tempo.confidence, gridStart: tempo.gridStart, grid, key: key.key, keyConfidence: key.confidence, loudness: loud, sections, duration: A.duration };
  };

  /* ---------- artwork palette ---------- */
  function rgb2hex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
  function hslOf(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    return { s, l };
  }
  VZ.extractPalette = function (data, k) {
    k = k || 5;
    const px = [], total = data.length / 4, stepP = Math.max(1, Math.floor(total / 4000));
    for (let i = 0; i < total; i += stepP) if (data[i * 4 + 3] > 128) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    if (!px.length) return [];
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const cent = [px[0].slice()];
    while (cent.length < Math.min(k, px.length)) {
      let bi = 0, bd = -1;
      for (let i = 0; i < px.length; i++) { let m = Infinity; for (const c of cent) m = Math.min(m, d2(px[i], c)); if (m > bd) { bd = m; bi = i; } }
      cent.push(px[bi].slice());
    }
    const counts = new Array(cent.length).fill(0);
    for (let it = 0; it < 10; it++) {
      const sum = cent.map(() => [0, 0, 0]); counts.fill(0);
      for (const p of px) {
        let bi = 0, bd = Infinity;
        for (let c = 0; c < cent.length; c++) { const d = d2(p, cent[c]); if (d < bd) { bd = d; bi = c; } }
        sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; counts[bi]++;
      }
      for (let c = 0; c < cent.length; c++) if (counts[c]) cent[c] = [sum[c][0] / counts[c], sum[c][1] / counts[c], sum[c][2] / counts[c]];
    }
    return cent.map((c, i) => { const h = hslOf(c[0], c[1], c[2]); return { r: c[0], g: c[1], b: c[2], count: counts[i], hex: rgb2hex(c[0], c[1], c[2]), sat: h.s, lum: h.l }; }).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  };
  VZ.paletteRoles = function (pal) {
    if (!pal.length) return null;
    const mixHex = (c, t, amt) => rgb2hex(c.r + (t - c.r) * amt, c.g + (t - c.g) * amt, c.b + (t - c.b) * amt);
    const colourful = pal.filter((c) => c.sat > 0.18 && c.lum > 0.12 && c.lum < 0.9);
    const primary = (colourful[0] || pal[0]);
    const accent = colourful.slice().sort((a, b) => b.sat * (0.4 + b.lum) - a.sat * (0.4 + a.lum))[0] || primary;
    const darkest = pal.slice().sort((a, b) => a.lum - b.lum)[0];
    const lightest = pal.slice().sort((a, b) => b.lum - a.lum)[0];
    return {
      primary: primary.hex, accent: accent.hex,
      dark: darkest.lum < 0.3 ? darkest.hex : mixHex(primary, 0, 0.8),
      light: lightest.lum > 0.7 ? lightest.hex : mixHex(accent, 255, 0.6),
      all: pal.map((c) => c.hex),
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VZ;
})(typeof window !== 'undefined' ? window : globalThis);
