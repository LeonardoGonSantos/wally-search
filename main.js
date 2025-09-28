import { openDatabase, saveAchado, listAchados, deleteAchado } from './db.js';
import { createDebugPanel } from './debug.js';

const videoEl = document.getElementById('camera');
const overlayEl = document.getElementById('overlay');
const hudFps = document.getElementById('hud-fps');
const hudInfer = document.getElementById('hud-infer');
const hudDrops = document.getElementById('hud-drops');
const hudN = document.getElementById('hud-n');
const hudRois = document.getElementById('hud-rois');
const toastEl = document.getElementById('toast');
const revealButton = document.getElementById('revealButton');
const findingsSheet = document.getElementById('findingsSheet');
const findingsList = document.getElementById('findingsList');
const clearFindingsBtn = document.getElementById('clearFindings');
const characterChips = document.getElementById('characterChips');
const openSettingsBtn = document.getElementById('openSettings');
const settingsDialog = document.getElementById('settingsSheet');
const fieldN = document.getElementById('fieldN');
const toggleDebug = document.getElementById('toggleDebug');
const toggleVibration = document.getElementById('toggleVibration');

const ctx = overlayEl.getContext('2d');
let worker;
let db;
let config;
let debugPanel;
let prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReducedMotion) {
  document.body.classList.add('prefers-reduced-motion');
}

const mailbox = {
  busy: false,
  pending: null
};

const state = {
  frameCount: 0,
  lastResults: [],
  lastToast: 0,
  findings: [],
  vibrationEnabled: true,
  drops: 0,
  inferMs: 0,
  iaFps: 0,
  rois: 0,
  debugVisible: false
};

const temporalFindings = new Map();

async function bootstrap() {
  await registerServiceWorker();
  config = await loadConfig();
  hudN.textContent = config.frameInterval;
  fieldN.value = config.frameInterval;
  toggleDebug.checked = false;
  setupChips(config.characters);
  db = await openDatabase();
  state.findings = await listAchados();
  renderFindings();
  await initWorker();
  await startCamera();
  scheduleFrame();
  attachEvents();
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./service-worker.js');
    } catch (err) {
      console.warn('SW registration failed', err);
    }
  }
}

async function loadConfig() {
  const res = await fetch('./config.json');
  if (!res.ok) {
    throw new Error('Não foi possível carregar config.json');
  }
  return res.json();
}

function setupChips(characters) {
  characterChips.innerHTML = '';
  characters.forEach((name) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.dataset.active = 'true';
    chip.textContent = name;
    chip.setAttribute('aria-pressed', 'true');
    chip.addEventListener('click', () => {
      const active = chip.dataset.active === 'true';
      chip.dataset.active = active ? 'false' : 'true';
      chip.setAttribute('aria-pressed', String(!active));
      postToWorker({
        type: 'toggle-character',
        character: name,
        enabled: !active
      });
    });
    characterChips.appendChild(chip);
  });
}

async function initWorker() {
  worker = new Worker('./detector.worker.js', { type: 'module' });
  worker.onmessage = handleWorkerMessage;
  worker.postMessage({ type: 'init', config });
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia não suportado.');
  }
  const constraints = {
    audio: false,
    video: {
      facingMode: 'environment',
      frameRate: { ideal: 60, max: 60 }
    }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  await videoEl.play();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const rect = videoEl.getBoundingClientRect();
  overlayEl.width = rect.width * devicePixelRatio;
  overlayEl.height = rect.height * devicePixelRatio;
}

function scheduleFrame() {
  requestAnimationFrame(tick);
}

async function tick() {
  state.frameCount++;
  drawOverlay(state.lastResults);

  if (videoEl.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
    const shouldSend = state.frameCount % config.frameInterval === 0;
    if (shouldSend) {
      const bitmap = await createVideoBitmap();
      if (bitmap) {
        dispatchFrame(bitmap);
      }
    }
  }

  scheduleFrame();
}

async function createVideoBitmap() {
  try {
    const trackSettings = videoEl.srcObject?.getVideoTracks?.()[0]?.getSettings?.();
    const width = trackSettings?.width ?? videoEl.videoWidth;
    const height = trackSettings?.height ?? videoEl.videoHeight;
    if (!width || !height) return null;
    const offscreen = new OffscreenCanvas(width, height);
    const offCtx = offscreen.getContext('2d', { willReadFrequently: false });
    offCtx.drawImage(videoEl, 0, 0, width, height);
    return await createImageBitmap(offscreen, 0, 0, width, height);
  } catch (error) {
    console.warn('Falha ao criar bitmap', error);
    return null;
  }
}

function dispatchFrame(bitmap) {
  if (mailbox.busy) {
    if (mailbox.pending) {
      mailbox.pending.close?.();
    }
    mailbox.pending = bitmap;
    return;
  }

  mailbox.busy = true;
  worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
}

function handleWorkerMessage(event) {
  const { type, data } = event.data;
  switch (type) {
    case 'ready':
      mailbox.busy = false;
      break;
    case 'metrics':
      mailbox.busy = false;
      handleMetrics(data);
      flushMailbox();
      break;
    case 'results':
      mailbox.busy = false;
      processResults(data);
      flushMailbox();
      break;
    case 'timeout':
      mailbox.busy = false;
      if (data?.drops != null) {
        state.drops = data.drops;
      } else {
        state.drops += 1;
      }
      hudDrops.textContent = state.drops;
      if (debugPanel) {
        debugPanel.update({ drops: state.drops });
      }
      flushMailbox();
      break;
    case 'log':
      console.log('[worker]', data);
      break;
    default:
      mailbox.busy = false;
      flushMailbox();
  }
}

function flushMailbox() {
  if (mailbox.pending) {
    const next = mailbox.pending;
    mailbox.pending = null;
    dispatchFrame(next);
  }
}

function handleMetrics({ inferMs, fps, rois, drops }) {
  state.inferMs = inferMs;
  state.iaFps = fps;
  state.rois = rois;
  if (typeof drops === 'number') {
    state.drops = drops;
  }
  hudInfer.textContent = inferMs.toFixed(1);
  hudFps.textContent = fps.toFixed(1);
  hudRois.textContent = rois;
  hudDrops.textContent = state.drops;
  if (debugPanel) {
    debugPanel.update({ inferMs, fps, rois, drops: state.drops });
  }
}

function processResults({ detections, inferMs, fps, rois, drops }) {
  state.lastResults = detections;
  if (inferMs) state.inferMs = inferMs;
  if (fps) state.iaFps = fps;
  if (rois != null) state.rois = rois;
  if (drops != null) state.drops = drops;
  hudInfer.textContent = state.inferMs.toFixed(1);
  hudFps.textContent = state.iaFps.toFixed(1);
  hudRois.textContent = state.rois;
  hudDrops.textContent = state.drops;

  detections
    .filter((det) => det.confirmed)
    .forEach((det) => handleConfirmedDetection(det));
}

async function handleConfirmedDetection(det) {
  if (temporalFindings.has(det.id)) {
    return;
  }
  temporalFindings.set(det.id, true);
  const blob = await captureCurrentFrame(det);
  const record = {
    id: det.id,
    character: det.label,
    score: det.score,
    timestamp: Date.now(),
    bbox: det.bbox,
    blob
  };
  await saveAchado(record);
  state.findings = await listAchados();
  renderFindings();
  revealButton.disabled = false;
  showToast(`${det.label.toUpperCase()} encontrado!`);
  if (state.vibrationEnabled && 'vibrate' in navigator) {
    navigator.vibrate?.(120);
  }
}

async function captureCurrentFrame(det) {
  const trackSettings = videoEl.srcObject?.getVideoTracks?.()[0]?.getSettings?.();
  const width = trackSettings?.width ?? videoEl.videoWidth;
  const height = trackSettings?.height ?? videoEl.videoHeight;
  const offscreen = new OffscreenCanvas(width, height);
  const context = offscreen.getContext('2d');
  context.drawImage(videoEl, 0, 0, width, height);
  const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return blob;
}

function drawOverlay(detections) {
  const rect = videoEl.getBoundingClientRect();
  const width = overlayEl.width;
  const height = overlayEl.height;
  ctx.clearRect(0, 0, width, height);

  if (!detections?.length) return;

  ctx.save();
  ctx.scale(width / rect.width, height / rect.height);

  detections.forEach((det) => {
    const [x, y, w, h] = det.bbox;
    const label = det.label;
    const score = det.score;
    const color = chooseAccent(label);

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    const px = x * rect.width;
    const py = y * rect.height;
    const pw = w * rect.width;
    const ph = h * rect.height;
    const radius = 12;
    roundRect(ctx, px, py, pw, ph, radius);
    ctx.stroke();

    ctx.fillStyle = 'rgba(14,14,16,0.6)';
    ctx.fillRect(px, py - 24, pw, 24);
    ctx.fillStyle = color;
    ctx.font = '600 13px "Inter", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${label} ${(score * 100).toFixed(0)}%`, px + 8, py - 12);
  });

  ctx.restore();
}

function chooseAccent(label) {
  switch (label) {
    case 'wally':
    case 'wenda':
      return 'rgba(229, 57, 53, 0.9)';
    case 'odlaw':
      return 'rgba(246, 201, 14, 0.9)';
    case 'mago':
      return 'rgba(255, 255, 255, 0.75)';
    case 'woof':
      return 'rgba(0, 230, 168, 0.9)';
    default:
      return 'rgba(0, 230, 168, 0.7)';
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
}

function attachEvents() {
  revealButton.addEventListener('click', async () => {
    if (!state.findings.length) return;
    const latest = state.findings[state.findings.length - 1];
    await revealFinding(latest);
  });

  clearFindingsBtn.addEventListener('click', async () => {
    const deletions = await Promise.all(state.findings.map((item) => deleteAchado(item.id)));
    if (deletions) {
      state.findings = await listAchados();
      renderFindings();
      revealButton.disabled = true;
    }
  });

  openSettingsBtn.addEventListener('click', () => {
    settingsDialog.showModal();
  });

  settingsDialog.addEventListener('close', () => {
    settingsDialog.classList.remove('is-open');
  });

  fieldN.addEventListener('change', () => {
    const value = Math.max(1, Math.min(12, Number(fieldN.value)));
    config.frameInterval = value;
    hudN.textContent = value;
    worker.postMessage({ type: 'update-config', config: { frameInterval: value } });
  });

  toggleDebug.addEventListener('change', () => {
    state.debugVisible = toggleDebug.checked;
    if (toggleDebug.checked) {
      debugPanel = createDebugPanel();
    } else if (debugPanel) {
      debugPanel.destroy();
      debugPanel = null;
    }
    worker.postMessage({ type: 'debug', enabled: toggleDebug.checked });
  });

  toggleVibration.addEventListener('change', () => {
    state.vibrationEnabled = toggleVibration.checked;
  });

  findingsSheet.addEventListener('click', (event) => {
    if (event.target === findingsSheet) {
      toggleFindings(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'f') {
      toggleFindings(findingsSheet.dataset.open !== 'true');
    }
  });
}

async function revealFinding(finding) {
  const url = URL.createObjectURL(finding.blob);
  const image = new Image();
  image.src = url;
  const revealCanvas = document.createElement('canvas');
  revealCanvas.width = overlayEl.width;
  revealCanvas.height = overlayEl.height;
  const revealCtx = revealCanvas.getContext('2d');
  revealCtx.globalAlpha = 0;
  document.body.appendChild(revealCanvas);
  revealCanvas.className = 'reveal-overlay';
  revealCanvas.style.position = 'fixed';
  revealCanvas.style.inset = '0';
  revealCanvas.style.pointerEvents = 'none';
  revealCanvas.style.transition = prefersReducedMotion ? 'none' : 'opacity var(--transition-slow)';
  revealCanvas.style.opacity = '0';

  image.onload = () => {
    revealCtx.globalAlpha = 1;
    revealCtx.drawImage(image, 0, 0, revealCanvas.width, revealCanvas.height);
    if (!prefersReducedMotion) {
      requestAnimationFrame(() => {
        revealCanvas.style.opacity = '1';
        revealCanvas.style.filter = 'saturate(140%)';
      });
    } else {
      revealCanvas.style.opacity = '1';
    }
    setTimeout(() => {
      revealCanvas.style.opacity = '0';
      setTimeout(() => {
        revealCanvas.remove();
        URL.revokeObjectURL(url);
      }, 400);
    }, prefersReducedMotion ? 1200 : 2200);
  };
}

function renderFindings() {
  findingsList.innerHTML = '';
  state.findings.forEach((item) => {
    const li = document.createElement('article');
    li.className = 'finding-card';
    li.role = 'listitem';
    const img = document.createElement('img');
    img.alt = `Frame de ${item.character}`;
    const url = URL.createObjectURL(item.blob);
    img.src = url;
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    const meta = document.createElement('div');
    meta.className = 'finding-meta';
    const title = document.createElement('div');
    title.textContent = item.character.toUpperCase();
    const subtitle = document.createElement('div');
    subtitle.textContent = new Date(item.timestamp).toLocaleTimeString();
    meta.appendChild(title);
    meta.appendChild(subtitle);
    li.appendChild(img);
    li.appendChild(meta);
    findingsList.appendChild(li);
  });
  toggleFindings(state.findings.length > 0);
  revealButton.disabled = state.findings.length === 0;
}

function toggleFindings(show) {
  findingsSheet.dataset.open = show ? 'true' : 'false';
  findingsSheet.setAttribute('aria-hidden', show ? 'false' : 'true');
}

let toastTimer;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.dataset.visible = 'false';
  }, 2400);
}

function postToWorker(msg) {
  worker?.postMessage(msg);
}

window.addEventListener('load', () => {
  bootstrap().catch((err) => {
    console.error(err);
    showToast('Erro ao iniciar: ' + err.message);
  });
});

window.addEventListener('beforeunload', () => {
  worker?.terminate();
});
