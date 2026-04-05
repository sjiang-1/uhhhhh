import './style.css';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rn(s) {
  return (Math.random() - 0.5) * 2 * s;
}

/** HSL for particle tint from sampled camera pixel. */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

// Gaze smoothing
const SMOOTH_ALPHA = 0.11;
let smoothedX = null;
let smoothedY = null;

const FOCUS_DWELL_MS = 280;

const ATTENTION = { ABSENT: 0, DISTRACTED: 1, PRESENT: 2 };

let attentionCandidate = null;
let attentionSince = 0;
let committedAttention = ATTENTION.PRESENT;

const particleCanvas = document.getElementById('particles');
const gazeDotEl = document.getElementById('gaze-dot');
const eyeBtn = document.getElementById('eye-btn');
const calibrationOverlay = document.getElementById('calibration-overlay');
const calibrationDot = document.getElementById('calibration-dot');
const calibrationProgress = document.getElementById('calibration-progress');

let eyeTrackingActive = false;

const INNER_FRAC_W = 0.24;
const INNER_FRAC_H = 0.2;
const OUTER_FRAC_W = 0.54;
const OUTER_FRAC_H = 0.46;

function gazeAttentionZone(x, y) {
  const host = document.getElementById('canvas-host');
  if (!host) return ATTENTION.ABSENT;
  const rect = host.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  const iw = rect.width * INNER_FRAC_W * 0.5;
  const ih = rect.height * INNER_FRAC_H * 0.5;
  const ow = rect.width * OUTER_FRAC_W * 0.5;
  const oh = rect.height * OUTER_FRAC_H * 0.5;
  if (dx <= iw && dy <= ih) return ATTENTION.PRESENT;
  if (dx <= ow && dy <= oh) return ATTENTION.DISTRACTED;
  return ATTENTION.ABSENT;
}

/** Webcam frame → tiny grid; prev frame luma for motion magnitude. */
let asciiCols = 96;
let asciiRows = 54;
let prevLuma = null;
let motionGrid = null;
let captureCanvas = null;
let captureCtx = null;
/** Video element from WebGazer (same camera as eye tracking). */
let videoEl = null;
let videoPollId = null;

/** Portrait particles: each maps to a stable cell in the downsampled camera grid. */
let cellPerm = null;
let particleN = 0;
let px = null;
let py = null;
let vx = null;
let vy = null;
let particleTime = 0;
let focusLevel = 0;
/** Previous-frame focus — drives finer sampling grid without waiting on this frame's motion. */
let prevFocusDetail = 0;
let lastParticleLayout = '';

function findWebgazerVideo() {
  if (typeof webgazer !== 'undefined') {
    if (webgazer.videoElement) return webgazer.videoElement;
    if (typeof webgazer.getVideoElement === 'function') {
      const el = webgazer.getVideoElement();
      if (el) return el;
    }
  }
  const videos = document.querySelectorAll('video');
  for (const v of videos) {
    if (v.videoWidth > 0 && v.readyState >= 2) return v;
  }
  for (const v of videos) {
    if (v.readyState >= 1) return v;
  }
  return null;
}

function startVideoPoll() {
  if (videoPollId) clearInterval(videoPollId);
  const tryOnce = () => {
    const v = findWebgazerVideo();
    if (v) {
      videoEl = v;
      if (videoPollId) {
        clearInterval(videoPollId);
        videoPollId = null;
      }
    }
  };
  tryOnce();
  videoPollId = setInterval(tryOnce, 100);
}

function ensureMotionGrid(w, h, detailBlend) {
  const t = detailBlend < 0.38 ? 0 : detailBlend < 0.72 ? 1 : 2;
  const cell = [3.2, 2.65, 2.05][t];
  asciiCols = Math.max(48, Math.min(240, Math.floor(w / cell)));
  const aspect = h / w;
  asciiRows = Math.max(48, Math.min(240, Math.round(asciiCols * aspect * 0.9)));
  const n = asciiCols * asciiRows;
  if (!prevLuma || prevLuma.length !== n) {
    prevLuma = new Uint8Array(n);
    prevLuma.fill(128);
  }
  if (!motionGrid || motionGrid.length !== n) {
    motionGrid = new Uint8Array(n);
  }
  if (!captureCanvas || captureCanvas.width !== asciiCols || captureCanvas.height !== asciiRows) {
    captureCanvas = document.createElement('canvas');
    captureCanvas.width = asciiCols;
    captureCanvas.height = asciiRows;
    captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
  }
}

const MAX_PORTRAIT_PARTICLES = 20800;
const CELL_PERM_PRIME = 7919;

function ensurePortraitParticles(w, h) {
  const key = `${w}x${h}x${asciiCols}x${asciiRows}`;
  const M = asciiCols * asciiRows;
  const n = Math.min(MAX_PORTRAIT_PARTICLES, Math.max(1, M * 2));
  if (key === lastParticleLayout && px && px.length === n && cellPerm && cellPerm.length === n) return;
  lastParticleLayout = key;
  particleN = n;
  cellPerm = new Uint32Array(particleN);
  for (let i = 0; i < particleN; i++) {
    cellPerm[i] = (i * CELL_PERM_PRIME) % M;
  }
  px = new Float32Array(particleN);
  py = new Float32Array(particleN);
  vx = new Float32Array(particleN);
  vy = new Float32Array(particleN);
  for (let i = 0; i < particleN; i++) {
    px[i] = Math.random() * w;
    py[i] = Math.random() * h;
    vx[i] = rn(1.5);
    vy[i] = rn(1.5);
  }
  focusLevel = 0;
  particleTime = 0;
}

let cohesionBlend = 1;
/** Skip motion spikes for a few frames while luminance buffer stabilizes. */
let asciiBootFrames = 4;

const BG = { r: 255, g: 255, b: 255 };

function tickParticles() {
  const ctx = particleCanvas.getContext('2d');
  const w = particleCanvas.width;
  const h = particleCanvas.height;

  let targetCohesion = 1;
  if (eyeTrackingActive) {
    if (committedAttention === ATTENTION.PRESENT) targetCohesion = 1;
    else if (committedAttention === ATTENTION.DISTRACTED) targetCohesion = 0.42;
    else targetCohesion = 0;
  }
  cohesionBlend += (targetCohesion - cohesionBlend) * 0.06;

  const viewFade = eyeTrackingActive ? lerp(0.06, 1, cohesionBlend) : 1;

  const detailBlend = eyeTrackingActive ? cohesionBlend : prevFocusDetail;
  ensureMotionGrid(w, h, detailBlend);
  ensurePortraitParticles(w, h);

  const v = videoEl && videoEl.readyState >= 1 ? videoEl : null;
  if (!v || particleN === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(90, 92, 102, 0.55)';
    ctx.font = '13px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Enable eye tracking — camera builds your portrait', w * 0.5, h * 0.5);
    requestAnimationFrame(tickParticles);
    return;
  }

  const vw = v.videoWidth || 1;
  const vh = v.videoHeight || 1;
  captureCtx.save();
  captureCtx.translate(asciiCols, 0);
  captureCtx.scale(-1, 1);
  captureCtx.drawImage(v, 0, 0, vw, vh, 0, 0, asciiCols, asciiRows);
  captureCtx.restore();

  const id = captureCtx.getImageData(0, 0, asciiCols, asciiRows);
  const pix = id.data;
  const gridN = asciiCols * asciiRows;
  let motionSum = 0;
  for (let j = 0; j < asciiRows; j++) {
    for (let i = 0; i < asciiCols; i++) {
      const idx = j * asciiCols + i;
      const p = idx * 4;
      const L = (0.299 * pix[p] + 0.587 * pix[p + 1] + 0.114 * pix[p + 2]) | 0;
      const prev = prevLuma[idx];
      const diff = Math.abs(L - prev);
      prevLuma[idx] = L;
      let motion = Math.min(255, diff * 4.5);
      if (asciiBootFrames > 0) motion = 0;
      motionGrid[idx] = motion;
      motionSum += motion;
    }
  }
  if (asciiBootFrames > 0) asciiBootFrames -= 1;

  const globalMotion = motionSum / (gridN * 255);
  const tfAttention = eyeTrackingActive ? cohesionBlend : Math.min(1, 0.12 + globalMotion * 4.2);
  const tf = tfAttention;
  focusLevel += (tf - focusLevel) * (tf > focusLevel ? 0.022 : 0.012);

  const trailA =
    (lerp(0.2, 0.14, focusLevel) + (1 - focusLevel) * 0.09) * viewFade;
  ctx.fillStyle = `rgba(${BG.r},${BG.g},${BG.b},${trailA})`;
  ctx.fillRect(0, 0, w, h);

  particleTime += 0.007;

  const cellW = w / asciiCols;
  const cellH = h / asciiRows;
  const pull = 0.038 * focusLevel;
  const drift = (1 - focusLevel) * 0.7;
  const motionKick = 5.2;

  for (let i = 0; i < particleN; i++) {
    const cidx = cellPerm[i];
    const col = cidx % asciiCols;
    const row = (cidx / asciiCols) | 0;
    const p = cidx * 4;
    const pr = pix[p];
    const pg = pix[p + 1];
    const pb = pix[p + 2];
    const L = (0.299 * pr + 0.587 * pg + 0.114 * pb) | 0;
    const Ln = L / 255;
    const [hue, sat, light] = rgbToHsl(pr, pg, pb);

    const tx =
      (col + 0.5) * cellW + Math.sin(i * 2.391 + cidx * 0.02) * cellW * 0.2;
    const ty =
      (row + 0.5) * cellH + Math.cos(i * 1.713 + cidx * 0.02) * cellH * 0.2;
    const dx = tx - px[i];
    const dy = ty - py[i];
    vx[i] += dx * pull;
    vy[i] += dy * pull;

    vx[i] += rn(0.5) * drift;
    vy[i] += rn(0.5) * drift;

    if (focusLevel > 0.6) {
      const breathe = Math.sin(particleTime + i * 0.009) * 0.2 * ((focusLevel - 0.6) / 0.4);
      vx[i] += rn(0.3) * breathe;
      vy[i] += rn(0.3) * breathe;
    }

    const gi = Math.min(asciiCols - 1, Math.max(0, (px[i] / cellW) | 0));
    const gj = Math.min(asciiRows - 1, Math.max(0, (py[i] / cellH) | 0));
    const m = motionGrid[gj * asciiCols + gi] / 255;
    vx[i] += rn(1) * m * motionKick;
    vy[i] += rn(1) * m * motionKick;

    vx[i] *= 0.87;
    vy[i] *= 0.87;
    px[i] += vx[i];
    py[i] += vy[i];

    if (px[i] < 0) {
      px[i] = 0;
      vx[i] *= -0.4;
    }
    if (px[i] > w) {
      px[i] = w;
      vx[i] *= -0.4;
    }
    if (py[i] < 0) {
      py[i] = 0;
      vy[i] *= -0.4;
    }
    if (py[i] > h) {
      py[i] = h;
      vy[i] *= -0.4;
    }

    const featGamma = lerp(0.74, 0.92, focusLevel);
    const feat = Math.pow(1 - Ln, featGamma);
    let alpha = (0.1 + feat * (0.36 + focusLevel * 0.12) + focusLevel * 0.14) * viewFade;
    alpha = Math.min(0.75, Math.max(0.08, alpha));
    const sz = 0.35 + feat * (0.88 + focusLevel * 0.14) + m * 0.2;
    const satBoost = Math.min(100, sat + 12 + m * 18);
    const litBoost = m * focusLevel * 22;

    ctx.beginPath();
    ctx.arc(px[i], py[i], sz, 0, 6.2832);
    ctx.fillStyle = `hsla(${hue},${satBoost}%,${Math.min(98, light + litBoost)}%,${alpha})`;
    ctx.fill();
  }

  prevFocusDetail = focusLevel;

  requestAnimationFrame(tickParticles);
}

function resizeParticleCanvas() {
  const host = document.getElementById('canvas-host');
  if (!host || !particleCanvas) return;
  const nw = Math.max(1, Math.floor(host.clientWidth));
  const nh = Math.max(1, Math.floor(host.clientHeight));
  particleCanvas.width = nw;
  particleCanvas.height = nh;
  prevLuma = null;
  motionGrid = null;
  asciiBootFrames = 4;
  lastParticleLayout = '';
  prevFocusDetail = 0;
}
window.addEventListener('resize', resizeParticleCanvas);
const _canvasHostEl = document.getElementById('canvas-host');
if (_canvasHostEl && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => resizeParticleCanvas()).observe(_canvasHostEl);
}

const CALIBRATION_POINTS = [
  [0.2, 0.2], [0.5, 0.2], [0.8, 0.2],
  [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
  [0.2, 0.8], [0.5, 0.8], [0.8, 0.8],
];
let calibrationIndex = 0;
let calibrationClickHandler = null;

function startEyeTracking() {
  if (eyeTrackingActive) return;
  if (typeof webgazer === 'undefined') {
    console.error('WebGazer not found.');
    return;
  }
  eyeBtn.textContent = 'Starting…';
  eyeBtn.disabled = true;
  try {
    webgazer.saveDataAcrossSessions(false);
    webgazer.clearData();
    webgazer.applyKalmanFilter(true);
    webgazer.setGazeListener(() => {}).begin();
    webgazer.removeMouseEventListeners();
    startVideoPoll();
    startCalibration();
  } catch (err) {
    eyeBtn.disabled = false;
    eyeBtn.textContent = 'Enable eye tracking';
    console.error('WebGazer error:', err);
  }
}

function startCalibration() {
  calibrationIndex = 0;
  calibrationOverlay.hidden = false;
  calibrationDot.hidden = false;
  showCalibrationPoint();
  calibrationClickHandler = (e) => {
    e.preventDefault();
    const [px, py] = CALIBRATION_POINTS[calibrationIndex];
    const x = Math.round(px * window.innerWidth);
    const y = Math.round(py * window.innerHeight);
    webgazer.recordScreenPosition(x, y, 'click');
    calibrationIndex++;
    if (calibrationIndex >= CALIBRATION_POINTS.length) {
      endCalibration();
      return;
    }
    showCalibrationPoint();
  };
  document.addEventListener('click', calibrationClickHandler, true);
}

function showCalibrationPoint() {
  const [px, py] = CALIBRATION_POINTS[calibrationIndex];
  const x = px * window.innerWidth;
  const y = py * window.innerHeight;
  calibrationDot.style.left = `${x}px`;
  calibrationDot.style.top = `${y}px`;
  calibrationProgress.textContent = `Point ${calibrationIndex + 1} of ${CALIBRATION_POINTS.length} — look at the dot, then click`;
}

function endCalibration() {
  document.removeEventListener('click', calibrationClickHandler, true);
  calibrationClickHandler = null;
  calibrationOverlay.hidden = true;
  calibrationDot.hidden = true;
  smoothedX = null;
  smoothedY = null;
  attentionCandidate = null;
  attentionSince = 0;
  committedAttention = ATTENTION.ABSENT;
  webgazer.clearGazeListener();
  webgazer.setGazeListener((data) => {
    if (data == null || data.x == null || data.y == null) return;
    const rawX = Math.max(0, Math.min(window.innerWidth, data.x));
    const rawY = Math.max(0, Math.min(window.innerHeight, data.y));
    if (smoothedX == null) {
      smoothedX = rawX;
      smoothedY = rawY;
    } else {
      smoothedX = SMOOTH_ALPHA * rawX + (1 - SMOOTH_ALPHA) * smoothedX;
      smoothedY = SMOOTH_ALPHA * rawY + (1 - SMOOTH_ALPHA) * smoothedY;
    }
    const x = Math.round(smoothedX);
    const y = Math.round(smoothedY);
    gazeDotEl.style.left = `${x}px`;
    gazeDotEl.style.top = `${y}px`;
    gazeDotEl.style.display = 'block';

    const zone = gazeAttentionZone(x, y);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (attentionCandidate === null || zone !== attentionCandidate) {
      attentionCandidate = zone;
      attentionSince = now;
    } else if (now - attentionSince >= FOCUS_DWELL_MS) {
      committedAttention = zone;
    }
  });
  document.body.classList.add('gaze-only');
  eyeTrackingActive = true;
  eyeBtn.textContent = 'Eye tracking on';
  eyeBtn.disabled = true;
}

resizeParticleCanvas();
requestAnimationFrame(tickParticles);

eyeBtn.addEventListener('click', startEyeTracking);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.body.classList.remove('gaze-only');
});
