/* Vizzy Studio \u2013 AI lyrics helpers.
 * Works with the output of whisper.cpp (open-source Whisper): word timestamps -> lyric lines,
 * and "forced alignment" of the user's own lyrics to the recognised words.
 */
(function (root) {
  'use strict';
  const VZ = (root.VZ = root.VZ || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r2 = (v) => Math.round(v * 100) / 100;
  const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
  const SENT_END = /[.!?\u061f\u3002\uff01\uff1f\u2026]["')\]]?$/;
  const ANNOT = /^\s*[\[(].*[\])]\s*$/;

  VZ.isRTL = (s) => /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(String(s || ''));

  /* ---------- whisper.cpp JSON -> words ---------- */
  VZ.parseWhisperJson = function (json) {
    const tr = (json && (json.transcription || json.segments)) || [];
    const words = [];
    for (const it of tr) {
      let raw = String(it.text == null ? '' : it.text);
      if (ANNOT.test(raw)) continue;
      raw = raw.replace(/[\u266a\u266b\ud83c\udfb5\ud83c\udfb6]/g, '');
      if (!raw.trim()) continue;
      const off = it.offsets || {};
      let t0 = off.from != null ? off.from / 1000 : it.start != null ? it.start : 0;
      let t1 = off.to != null ? off.to / 1000 : it.end != null ? it.end : t0 + 0.3;
      const startsWithSpace = /^\s/.test(raw);
      const txt = raw.trim();
      if (!txt) continue;
      if (!startsWithSpace && words.length) { // sub-word piece or punctuation -> glue to previous word
        const p = words[words.length - 1];
        p.text += txt; p.t1 = Math.max(p.t1, t1);
      } else words.push({ t0, t1, text: txt });
    }
    for (let i = 0; i < words.length; i++) {
      const w = words[i], nx = words[i + 1];
      if (w.t1 < w.t0 + 0.06) w.t1 = w.t0 + 0.06;
      if (nx && w.t1 > nx.t0 + 0.02 && nx.t0 >= w.t0) w.t1 = Math.max(w.t0 + 0.06, nx.t0);
      w.t0 = r2(w.t0); w.t1 = r2(w.t1);
    }
    return words;
  };

  /* ---------- words -> lines ---------- */
  VZ.groupWords = function (words, opts) {
    opts = Object.assign({ gap: 0.7, maxWords: 8, maxChars: 44, minWords: 2 }, opts || {});
    const lines = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      lines.push({ t0: cur[0].t0, t1: cur[cur.length - 1].t1, text: cur.map((w) => w.text).join(' '), words: cur.map((w) => ({ t0: w.t0, t1: w.t1, text: w.text })) });
      cur = [];
    };
    for (let i = 0; i < words.length; i++) {
      const w = words[i], prev = cur[cur.length - 1];
      if (prev) {
        const gap = w.t0 - prev.t1;
        const chars = cur.reduce((a, x) => a + x.text.length + 1, 0);
        if (gap > opts.gap || cur.length >= opts.maxWords || chars + w.text.length > opts.maxChars || (SENT_END.test(prev.text) && cur.length >= opts.minWords)) flush();
      }
      cur.push(w);
    }
    flush();
    // hold each line a little, but never into the next one
    for (let i = 0; i < lines.length; i++) {
      const nxt = lines[i + 1];
      let end = lines[i].t1 + 0.4;
      if (nxt) end = Math.min(end, nxt.t0);
      lines[i].t1 = r2(Math.max(end, lines[i].t0 + 0.2));
    }
    return lines;
  };

  /* ---------- word timing helper (used by renderer when a line has no word data) ---------- */
  VZ.distributeWords = function (text, t0, t1) {
    const toks = String(text || '').split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    const wts = toks.map((w) => w.length + 1.5), sum = wts.reduce((a, b) => a + b, 0), span = Math.max(0.1, t1 - t0);
    let acc = 0;
    return toks.map((w, i) => { const a = t0 + (acc / sum) * span; acc += wts[i]; return { text: w, t0: a, t1: t0 + (acc / sum) * span }; });
  };

  /* ---------- normalisation / tokens ---------- */
  function norm(s) {
    s = String(s).toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* old engines */ }
    s = s.replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627').replace(/\u0649/g, '\u064a').replace(/\u0629/g, '\u0647');
    try { return s.replace(/[^\p{L}\p{N}]/gu, ''); } catch (e) { return s.replace(/[^a-z0-9\u0600-\u06ff]/g, ''); }
  }
  function tokenize(line) {
    const out = [];
    for (const raw of String(line).split(/\s+/)) {
      if (!raw) continue;
      if (CJK.test(raw)) { for (const ch of raw) if (norm(ch)) out.push({ text: ch, n: norm(ch) }); } else { const n = norm(raw); out.push({ text: raw, n }); }
    }
    return out;
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  function sim(a, b) {
    if (!a || !b) return -1;
    if (a === b) return 2;
    const L = Math.max(a.length, b.length);
    if (L >= 3 && 1 - lev(a, b) / L >= 0.7) return 1;
    return -1;
  }
  VZ._norm = norm; VZ._tokenize = tokenize;

  /* ---------- align the user's lyrics to the recognised words ---------- */
  VZ.alignLyrics = function (userLines, words) {
    const lines = userLines.map((s) => String(s).trim()).filter((s) => s && !ANNOT.test(s));
    const U = [];
    lines.forEach((ln, li) => { for (const t of tokenize(ln)) U.push({ line: li, text: t.text, n: t.n }); });
    const A = words.map((w) => ({ n: norm(w.text), t0: w.t0, t1: w.t1 }));
    const m = U.length, n = A.length;
    if (!m || !n) return null;
    const GAP = -0.6, W = n + 1;
    const sc = new Float32Array((m + 1) * W), tb = new Uint8Array((m + 1) * W); // 1 diag, 2 up(skip user token), 3 left(skip asr word)
    for (let i = 1; i <= m; i++) { sc[i * W] = i * GAP; tb[i * W] = 2; }
    for (let j = 1; j <= n; j++) { sc[j] = j * GAP * 0.5; tb[j] = 3; } // extra spoken words cost less
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const d = sc[(i - 1) * W + j - 1] + sim(U[i - 1].n, A[j - 1].n);
        const up = sc[(i - 1) * W + j] + GAP, lf = sc[i * W + j - 1] + GAP * 0.5;
        let best = d, dir = 1;
        if (up > best) { best = up; dir = 2; }
        if (lf > best) { best = lf; dir = 3; }
        sc[i * W + j] = best; tb[i * W + j] = dir;
      }
    }
    const match = new Int32Array(m).fill(-1);
    let i = m, j = n;
    while (i > 0 && j > 0) {
      const d = tb[i * W + j];
      if (d === 1) { if (sim(U[i - 1].n, A[j - 1].n) > 0) match[i - 1] = j - 1; i--; j--; } else if (d === 2) i--; else j--;
    }
    const matched = Array.from(match).filter((x) => x >= 0).length;
    if (matched < Math.max(2, Math.min(m, n) * 0.15)) return { lines: null, matched, total: m };
    // times for matched tokens, interpolate the rest between anchors
    const T0 = new Array(m).fill(null), T1 = new Array(m).fill(null);
    for (let k = 0; k < m; k++) if (match[k] >= 0) { T0[k] = A[match[k]].t0; T1[k] = A[match[k]].t1; }
    const anchors = []; for (let k = 0; k < m; k++) if (T0[k] != null) anchors.push(k);
    const avgLen = A.reduce((a, w) => a + (w.t1 - w.t0), 0) / n || 0.3;
    const spread = (idx, tStart, tEnd) => { // proportional to word length
      if (!idx.length) return;
      let sum = 0; const wts = idx.map((k) => { const w = U[k].n.length + 1; sum += w; return w; });
      let acc = 0;
      idx.forEach((k, q) => { T0[k] = tStart + (acc / sum) * (tEnd - tStart); acc += wts[q]; T1[k] = tStart + (acc / sum) * (tEnd - tStart); });
    };
    // Unmatched tokens between two anchors: words of the previous anchor's line hug it, words of the next anchor's line hug that one,
    // whole missing lines are spread across what is left (so a long instrumental gap does not drag a line away from its first matched word).
    const fill = (from, to, tStart, tEnd, prevLine, nextLine) => {
      const cnt = to - from; if (cnt <= 0) return;
      const all = []; for (let k = from; k < to; k++) all.push(k);
      if (prevLine === nextLine || prevLine < 0 || nextLine < 0) { spread(all, tStart, tEnd); return; }
      const A = all.filter((k) => U[k].line === prevLine), C = all.filter((k) => U[k].line === nextLine), B = all.filter((k) => U[k].line !== prevLine && U[k].line !== nextLine);
      const d = Math.min(avgLen, (tEnd - tStart) / cnt);
      let t = tStart;
      A.forEach((k) => { T0[k] = t; T1[k] = t + d; t += d; });
      let u = tEnd;
      for (let q = C.length - 1; q >= 0; q--) { T1[C[q]] = u; T0[C[q]] = u - d; u -= d; }
      spread(B, t, Math.max(t + 0.01, u));
    };
    const first = anchors[0], last = anchors[anchors.length - 1];
    fill(0, first, Math.max(0, T0[first] - first * avgLen), T0[first], -1, -1);
    for (let a = 0; a < anchors.length - 1; a++) fill(anchors[a] + 1, anchors[a + 1], T1[anchors[a]], T0[anchors[a + 1]], U[anchors[a]].line, U[anchors[a + 1]].line);
    fill(last + 1, m, T1[last], T1[last] + (m - last - 1) * avgLen + 0.001, -1, -1);
    // monotonic clean-up
    let prevEnd = 0;
    for (let k = 0; k < m; k++) {
      T0[k] = Math.max(T0[k], prevEnd - 0.03);
      T1[k] = Math.max(T1[k], T0[k] + 0.06);
      prevEnd = T1[k];
    }
    const out = [];
    lines.forEach((ln, li) => {
      const idx = []; for (let k = 0; k < m; k++) if (U[k].line === li) idx.push(k);
      if (!idx.length) return;
      out.push({ t0: r2(T0[idx[0]]), t1: r2(T1[idx[idx.length - 1]]), text: ln, words: idx.map((k) => ({ t0: r2(T0[k]), t1: r2(T1[k]), text: U[k].text })) });
    });
    for (let k = 0; k < out.length; k++) {
      const nxt = out[k + 1]; let end = out[k].t1 + 0.4;
      if (nxt) end = Math.min(end, nxt.t0);
      out[k].t1 = r2(Math.max(end, out[k].t0 + 0.2));
    }
    return { lines: out, matched, total: m };
  };

  /* ---------- audio helpers for Whisper (16 kHz mono WAV) ---------- */
  VZ.resampleTo16k = async function (mono, sr) {
    const TARGET = 16000;
    if (sr === TARGET) return mono;
    const ratio = sr / TARGET, outLen = Math.floor(mono.length / ratio), out = new Float32Array(outLen);
    const fc = 0.46 * TARGET / sr;          // cut-off in cycles per input sample
    const T = Math.ceil(ratio * 8);          // taps each side
    const taps = new Float32Array(2 * T + 1);
    const hann = (x) => 0.5 + 0.5 * Math.cos((Math.PI * x) / (T + 1));
    for (let o = 0; o < outLen; o++) {
      const p = o * ratio, c = Math.floor(p), frac = p - c;
      let acc = 0, ws = 0;
      for (let k = -T; k <= T; k++) {
        const idx = c + k; if (idx < 0 || idx >= mono.length) continue;
        const d = k - frac, x = 2 * Math.PI * fc * d;
        const w = (Math.abs(d) < 1e-9 ? 2 * fc : (2 * fc * Math.sin(x)) / x) * hann(d);
        acc += mono[idx] * w; ws += w;
      }
      out[o] = ws ? acc / ws : 0;
      if (o % 400000 === 399999) await new Promise((r) => setTimeout(r, 0));
    }
    void taps;
    return out;
  };
  VZ.encodeWav16 = function (f32, sr) {
    const n = f32.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(clamp(f32[i], -1, 1) * 32767), true);
    return new Uint8Array(buf);
  };

  VZ.WHISPER_LANGS = [['auto', 'Auto-detect'], ['ar', 'Arabic'], ['en', 'English'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['tr', 'Turkish'], ['ru', 'Russian'], ['hi', 'Hindi'], ['ur', 'Urdu'], ['fa', 'Persian'], ['id', 'Indonesian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'], ['he', 'Hebrew']];
  VZ.WHISPER_MODELS = [
    { id: 'tiny', label: 'Tiny \u2013 fastest, rough (75 MB)', file: 'ggml-tiny.bin', size: 75e6 },
    { id: 'base', label: 'Base \u2013 fast, decent (142 MB)', file: 'ggml-base.bin', size: 142e6 },
    { id: 'small', label: 'Small \u2013 good (466 MB) \u2605 recommended', file: 'ggml-small.bin', size: 466e6 },
    { id: 'large-v3-turbo-q5_0', label: 'Large v3 Turbo \u2013 best quality (574 MB)', file: 'ggml-large-v3-turbo-q5_0.bin', size: 574e6 },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = VZ;
})(typeof window !== 'undefined' ? window : globalThis);
