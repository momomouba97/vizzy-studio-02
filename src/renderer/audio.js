/* Vizzy Studio \u2013 audio analysis.
 * Decodes nothing itself: it receives a mono Float32Array and precomputes
 * spectrum bands, bass/mid/treble, RMS, beat envelope and a motion clock.
 * Because everything is precomputed, preview and MP4 export look identical.
 */
(function (root) {
  'use strict';
  const VZ = (root.VZ = root.VZ || {});
  const NB = 128;          // number of log-spaced bands
  const FFT_N = 4096;
  const AFPS = 30;         // analysis frames per second (interpolated at render)
  VZ.NB = NB;
  VZ.AFPS = AFPS;
  VZ.MAXB = 108;           // highest band used by visualizers (~12 kHz)

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function makeFFT(n) {
    const levels = Math.round(Math.log2(n));
    const cos = new Float32Array(n / 2);
    const sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    return function fft(re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const tre = re[l] * cos[k] + im[l] * sin[k];
            const tim = -re[l] * sin[k] + im[l] * cos[k];
            re[l] = re[j] - tre; im[l] = im[j] - tim;
            re[j] += tre; im[j] += tim;
          }
        }
      }
    };
  }
  VZ._makeFFT = makeFFT;

  /** Convert stored band value (0..1, = (dB+90)/90) into a 0..1 visual amplitude. */
  VZ.ampOf = function (v, sens) {
    const x = clamp((v * 90 - 15) / 55, 0, 1); // (dB + 75) / 55
    const a = Math.pow(x, 1.25) * (sens == null ? 1 : sens);
    return a > 1 ? 1 : a;
  };

  VZ.newSample = function () {
    return { bands: new Float32Array(NB), bass: 0, mid: 0, treble: 0, rms: 0, beat: 0, cum: 0, _A: null, _t: 0 };
  };
  VZ.waveOf = function (S, count, span, out) {
    if (S._A && S._A.wave) S._A.wave(S._t, count, span, out);
    else out.fill(0);
    return out;
  };

  VZ.analyze = async function (mono, sr, onProgress) {
    const dur = mono.length / sr;
    const frames = Math.max(2, Math.ceil(dur * AFPS) + 1);
    const fft = makeFFT(FFT_N);
    const win = new Float32Array(FFT_N);
    for (let i = 0; i < FFT_N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1));
    const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N);
    const mag = new Float32Array(FFT_N / 2 + 2);
    const binHz = sr / FFT_N;
    const fmin = 35, fmax = Math.min(16000, sr * 0.45);
    const edges = new Float64Array(NB + 1);
    for (let b = 0; b <= NB; b++) edges[b] = fmin * Math.pow(fmax / fmin, b / NB);
    const tilt = new Float32Array(NB);
    for (let b = 0; b < NB; b++) {
      const fc = Math.sqrt(edges[b] * edges[b + 1]);
      tilt[b] = fc > 1000 ? 3 * Math.log2(fc / 1000) : 0;
    }
    const bandOfFreq = (f) => clamp(Math.round((Math.log(f / fmin) / Math.log(fmax / fmin)) * NB), 0, NB);
    const bassHi = Math.max(2, bandOfFreq(200));
    const midHi = bandOfFreq(2500);
    const trebHi = Math.max(midHi + 1, bandOfFreq(12000));

    const bands = new Float32Array(frames * NB);
    const rmsA = new Float32Array(frames), bassA = new Float32Array(frames);
    const midA = new Float32Array(frames), trebA = new Float32Array(frames);
    const beatA = new Float32Array(frames), cumA = new Float32Array(frames);
    const flux = new Float32Array(frames);
    const prevLow = new Float32Array(bassHi);
    const rawFrame = new Float32Array(NB);
    const nrm = (v) => clamp((v * 90 - 15) / 55, 0, 1);

    for (let k = 0; k < frames; k++) {
      const c = Math.round((k / AFPS) * sr) - (FFT_N >> 1);
      for (let i = 0; i < FFT_N; i++) {
        const idx = c + i;
        re[i] = idx >= 0 && idx < mono.length ? mono[idx] * win[i] : 0;
        im[i] = 0;
      }
      fft(re, im);
      for (let i = 0; i <= FFT_N / 2; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (FFT_N / 4);

      for (let b = 0; b < NB; b++) {
        const bl = edges[b] / binHz, bh = edges[b + 1] / binHz;
        let m;
        if (bh - bl < 1) {
          const bc = (bl + bh) / 2, i0 = Math.floor(bc), fr = bc - i0;
          m = mag[i0] * (1 - fr) + mag[i0 + 1] * fr;
        } else {
          m = 0;
          for (let i = Math.ceil(bl); i <= Math.floor(bh); i++) if (mag[i] > m) m = mag[i];
        }
        const db = 20 * Math.log10(m + 1e-9) + tilt[b];
        rawFrame[b] = clamp((db + 90) / 90, 0, 1);
      }

      // spectral flux in the low end (for beats), measured on un-smoothed data
      let fl = 0;
      for (let b = 0; b < bassHi; b++) {
        const x = nrm(rawFrame[b]);
        const d = x - prevLow[b];
        if (d > 0) fl += d;
        prevLow[b] = x;
      }
      flux[k] = fl / bassHi;

      // smoothing: fast attack, slower release
      const o = k * NB, op = (k - 1) * NB;
      for (let b = 0; b < NB; b++) {
        const cur = rawFrame[b];
        if (k === 0) bands[o + b] = cur;
        else {
          const prev = bands[op + b];
          bands[o + b] = prev + (cur - prev) * (cur > prev ? 0.85 : 0.3);
        }
      }

      // group energies
      let sB = 0, sM = 0, sT = 0;
      for (let b = 0; b < bassHi; b++) sB += nrm(bands[o + b]);
      for (let b = bassHi; b < midHi; b++) sM += nrm(bands[o + b]);
      for (let b = midHi; b < trebHi; b++) sT += nrm(bands[o + b]);
      bassA[k] = Math.pow(sB / bassHi, 1.5);
      midA[k] = Math.pow(sM / Math.max(1, midHi - bassHi), 1.5);
      trebA[k] = Math.pow(sT / Math.max(1, trebHi - midHi), 1.5);

      // RMS (1024 samples around the center)
      const cc = c + (FFT_N >> 1);
      let s2 = 0, cnt = 0;
      for (let i = -512; i < 512; i++) {
        const idx = cc + i;
        if (idx >= 0 && idx < mono.length) { s2 += mono[idx] * mono[idx]; cnt++; }
      }
      rmsA[k] = cnt ? clamp(Math.sqrt(s2 / cnt) * 3.2, 0, 1) : 0;
      cumA[k] = (k ? cumA[k - 1] : 0) + (0.25 + bassA[k]) / AFPS;

      if (k % 150 === 0) {
        if (onProgress) onProgress(k / frames);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // beat detection: adaptive threshold on low-band flux
    const W = AFPS; // 1 second window
    let last = -100, env = 0;
    const beatTimes = [];
    const decay = Math.exp(-6.5 / AFPS);
    for (let k = 0; k < frames; k++) {
      let s = 0, s2 = 0, cnt = 0;
      for (let j = Math.max(0, k - W); j < k; j++) { s += flux[j]; s2 += flux[j] * flux[j]; cnt++; }
      const mean = cnt ? s / cnt : 0;
      const sd = cnt ? Math.sqrt(Math.max(0, s2 / cnt - mean * mean)) : 0;
      const thr = mean + Math.max(1.4 * sd, 0.03);
      env *= decay;
      if (flux[k] > thr && k - last >= 6) {
        last = k;
        beatTimes.push(k / AFPS);
        env = Math.max(env, clamp(0.55 + (flux[k] - thr) * 5, 0.55, 1));
      }
      beatA[k] = env;
    }
    if (onProgress) onProgress(1);

    const peakCache = {};
    const A = {
      duration: dur, frames, sr, mono, demo: false, beats: beatTimes,
      raw: { bands, frames, rms: rmsA, bass: bassA, mid: midA, treble: trebA, beat: beatA },
      peaks(n) {
        if (peakCache[n]) return peakCache[n];
        const out = new Float32Array(n);
        let gmax = 1e-6;
        for (let i = 0; i < n; i++) {
          const i0 = Math.floor((i / n) * mono.length), i1 = Math.max(i0 + 1, Math.floor(((i + 1) / n) * mono.length));
          const step = Math.max(1, Math.floor((i1 - i0) / 200));
          let m = 0;
          for (let j = i0; j < i1; j += step) { const v = Math.abs(mono[j]); if (v > m) m = v; }
          out[i] = m; if (m > gmax) gmax = m;
        }
        for (let i = 0; i < n; i++) out[i] = Math.pow(out[i] / gmax, 0.8);
        peakCache[n] = out;
        return out;
      },
      sample(t, out) {
        let f = t * AFPS;
        if (f < 0) f = 0;
        if (f > frames - 1) f = frames - 1;
        const i = Math.floor(f), j = Math.min(frames - 1, i + 1), a = f - i;
        const o1 = i * NB, o2 = j * NB, ob = out.bands;
        for (let b = 0; b < NB; b++) ob[b] = bands[o1 + b] * (1 - a) + bands[o2 + b] * a;
        out.bass = bassA[i] * (1 - a) + bassA[j] * a;
        out.mid = midA[i] * (1 - a) + midA[j] * a;
        out.treble = trebA[i] * (1 - a) + trebA[j] * a;
        out.rms = rmsA[i] * (1 - a) + rmsA[j] * a;
        out.beat = beatA[i] * (1 - a) + beatA[j] * a;
        out.cum = cumA[i] * (1 - a) + cumA[j] * a;
        out._A = A; out._t = t;
        return out;
      },
      wave(t, count, span, out) {
        for (let p = 0; p < count; p++) {
          const idx = Math.floor((t + (p / count) * span) * sr);
          out[p] = idx >= 0 && idx < mono.length ? mono[idx] : 0;
        }
        return out;
      },
    };
    return A;
  };

  /** Fake audio so the editor looks alive before a song is loaded. */
  VZ.demoAnalysis = function () {
    const A = {
      duration: 30, demo: true, beats: [], raw: null,
      peaks(n) {
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = 0.25 + 0.7 * Math.abs(Math.sin(i * 0.37) * Math.sin(i * 0.11 + 1));
        return out;
      },
      sample(t, out) {
        for (let b = 0; b < NB; b++) {
          const x = 0.5 + 0.5 * Math.sin(t * 2.1 + b * 0.21) * Math.sin(t * 0.7 + b * 0.05);
          const fall = 1 - (b / NB) * 0.5;
          out.bands[b] = 0.3 + 0.45 * x * fall;
        }
        const ph = (t * 2) % 1;
        out.beat = Math.exp(-ph * 6);
        out.bass = 0.35 + 0.45 * out.beat;
        out.mid = 0.4 + 0.2 * Math.sin(t * 1.3);
        out.treble = 0.3 + 0.2 * Math.sin(t * 2.7 + 1);
        out.rms = 0.4 + 0.3 * out.beat;
        out.cum = t * 0.6;
        out._A = A; out._t = t;
        return out;
      },
      wave(t, count, span, out) {
        for (let p = 0; p < count; p++) {
          const x = t + (p / count) * span;
          out[p] = 0.35 * Math.sin(x * 2 * Math.PI * 110) + 0.2 * Math.sin(x * 2 * Math.PI * 330 + 1) * (0.5 + 0.5 * Math.sin(t * 3));
        }
        return out;
      },
    };
    return A;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VZ;
})(typeof window !== 'undefined' ? window : globalThis);
