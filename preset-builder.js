import {
  openDatabase,
  savePresetSample,
  listPresetSamples,
  deletePresetSample,
  clearStore
} from './db.js';

const videoEl = document.getElementById('pbVideo');
const canvasEl = document.getElementById('pbCanvas');
const ctx = canvasEl.getContext('2d');
const captureBtn = document.getElementById('pbCapture');
const importBtn = document.getElementById('pbImportButton');
const importInput = document.getElementById('pbImport');
const saveBtn = document.getElementById('pbSave');
const exportBtn = document.getElementById('pbExport');
const clearBtn = document.getElementById('pbClear');
const galleryEl = document.getElementById('pbGallery');
const charactersEl = document.getElementById('pbCharacters');
const partsEl = document.getElementById('pbParts');
const itemTemplate = document.getElementById('pbItemTemplate');

let db;
let stream;
let currentImage = null; // ImageBitmap
let currentBlob = null;
let viewTransform = { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
let roi = null;
let pointerActive = false;
let activeCharacter = 'wally';
let activePart = 'hat';

const CHARACTERS = {
  wally: ['hat', 'glasses', 'torso_stripes'],
  wenda: ['glasses', 'torso_stripes'],
  odlaw: ['hat_stripes', 'torso_stripes'],
  mago: ['beard_large', 'hat_red'],
  woof: ['tail_with_hat', 'mini_hat'],
  negatives_hard: ['frame']
};

async function init() {
  db = await openDatabase();
  await setupCamera();
  buildCharacterChips();
  buildPartChips(activeCharacter);
  await refreshGallery();
  attachEvents();
}

async function setupCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  } catch (error) {
    console.warn('Sem acesso à câmera', error);
  }
}

function resizeCanvas() {
  const rect = videoEl.getBoundingClientRect();
  canvasEl.width = rect.width * devicePixelRatio;
  canvasEl.height = rect.height * devicePixelRatio;
  draw();
}

function buildCharacterChips() {
  charactersEl.innerHTML = '';
  Object.keys(CHARACTERS).forEach((character) => {
    const button = document.createElement('button');
    button.textContent = character;
    button.dataset.active = character === activeCharacter ? 'true' : 'false';
    button.type = 'button';
    button.addEventListener('click', () => {
      activeCharacter = character;
      buildCharacterChips();
      buildPartChips(character);
    });
    charactersEl.appendChild(button);
  });
}

function buildPartChips(character) {
  partsEl.innerHTML = '';
  const parts = CHARACTERS[character] || [];
  if (!parts.includes(activePart)) {
    activePart = parts[0] ?? 'hat';
  }
  parts.forEach((part) => {
    const button = document.createElement('button');
    button.textContent = part;
    button.dataset.active = part === activePart ? 'true' : 'false';
    button.type = 'button';
    button.addEventListener('click', () => {
      activePart = part;
      buildPartChips(character);
      draw();
    });
    partsEl.appendChild(button);
  });
}

function attachEvents() {
  captureBtn.addEventListener('click', captureFrame);
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', handleImport);
  saveBtn.addEventListener('click', saveSample);
  exportBtn.addEventListener('click', exportZip);
  clearBtn.addEventListener('click', clearAllSamples);

  canvasEl.addEventListener('pointerdown', startPointer);
  canvasEl.addEventListener('pointermove', movePointer);
  canvasEl.addEventListener('pointerup', endPointer);
  canvasEl.addEventListener('pointerleave', endPointer);
}

async function captureFrame() {
  if (!videoEl.videoWidth) return;
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = videoEl.videoWidth;
  captureCanvas.height = videoEl.videoHeight;
  const captureCtx = captureCanvas.getContext('2d');
  captureCtx.drawImage(videoEl, 0, 0);
  currentBlob = await canvasToBlob(captureCanvas);
  currentImage = await createImageBitmap(captureCanvas);
  applyViewTransform(currentImage.width, currentImage.height);
  roi = null;
  draw();
  saveBtn.disabled = false;
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const c = canvas.getContext('2d');
  c.drawImage(image, 0, 0);
  currentBlob = await canvasToBlob(canvas);
  currentImage = await createImageBitmap(canvas);
  applyViewTransform(currentImage.width, currentImage.height);
  roi = null;
  draw();
  saveBtn.disabled = false;
}

function applyViewTransform(width, height) {
  const displayWidth = canvasEl.width;
  const displayHeight = canvasEl.height;
  const scale = Math.min(displayWidth / width, displayHeight / height);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const offsetX = (displayWidth - scaledWidth) / 2;
  const offsetY = (displayHeight - scaledHeight) / 2;
  viewTransform = { scale, offsetX, offsetY, width, height };
}

function draw() {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (currentImage) {
    ctx.drawImage(
      currentImage,
      0,
      0,
      currentImage.width,
      currentImage.height,
      viewTransform.offsetX,
      viewTransform.offsetY,
      currentImage.width * viewTransform.scale,
      currentImage.height * viewTransform.scale
    );
  }
  if (roi) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 230, 168, 0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(roi.displayX, roi.displayY, roi.displayW, roi.displayH);
    ctx.restore();
    drawHandles();
  }
}

function startPointer(event) {
  if (!currentImage) return;
  pointerActive = true;
  const { x, y } = pointerToImage(event);
  roi = {
    x,
    y,
    width: 0,
    height: 0,
    displayX: event.offsetX * devicePixelRatio,
    displayY: event.offsetY * devicePixelRatio,
    displayW: 0,
    displayH: 0
  };
}

function movePointer(event) {
  if (!pointerActive || !roi) return;
  const { x, y } = pointerToImage(event);
  roi.width = Math.max(1, x - roi.x);
  roi.height = Math.max(1, y - roi.y);
  const display = imageToDisplay(roi.x, roi.y, roi.width, roi.height);
  Object.assign(roi, display);
  draw();
}

function endPointer() {
  pointerActive = false;
  draw();
}

function pointerToImage(event) {
  const x = (event.offsetX * devicePixelRatio - viewTransform.offsetX) / viewTransform.scale;
  const y = (event.offsetY * devicePixelRatio - viewTransform.offsetY) / viewTransform.scale;
  return {
    x: clamp(x, 0, viewTransform.width),
    y: clamp(y, 0, viewTransform.height)
  };
}

function imageToDisplay(x, y, width, height) {
  return {
    displayX: x * viewTransform.scale + viewTransform.offsetX,
    displayY: y * viewTransform.scale + viewTransform.offsetY,
    displayW: width * viewTransform.scale,
    displayH: height * viewTransform.scale
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function saveSample() {
  if (!roi || !currentImage) return;
  const cropSize = 160;
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropSize;
  cropCanvas.height = cropSize;
  const cropCtx = cropCanvas.getContext('2d');
  const sx = Math.round(roi.x);
  const sy = Math.round(roi.y);
  const sw = Math.round(roi.width);
  const sh = Math.round(roi.height);
  cropCtx.drawImage(currentImage, sx, sy, sw, sh, 0, 0, cropSize, cropSize);
  const cropBlob = await canvasToBlob(cropCanvas);

  const sample = {
    character: activeCharacter,
    part: activePart,
    timestamp: Date.now(),
    roi: { x: sx, y: sy, width: sw, height: sh },
    device: navigator.userAgent,
    original: currentBlob,
    crop: cropBlob
  };
  await savePresetSample(sample);
  await refreshGallery();
}

async function refreshGallery() {
  const items = await listPresetSamples();
  galleryEl.innerHTML = '';
  items.forEach((item) => {
    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    const img = node.querySelector('img');
    const url = URL.createObjectURL(item.crop);
    img.src = url;
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    const labelEl = node.querySelector('[data-field="label"]');
    labelEl.textContent = `${item.character}:${item.part}`;
    const timeEl = node.querySelector('[data-field="timestamp"]');
    timeEl.textContent = new Date(item.timestamp).toLocaleString();
    node.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      await deletePresetSample(item.id);
      await refreshGallery();
    });
    galleryEl.appendChild(node);
  });
}

async function exportZip() {
  const samples = await listPresetSamples();
  if (!samples.length) return;
  const entries = [];
  for (const sample of samples) {
    const folder = sample.character === 'negatives_hard'
      ? 'dataset/negatives_hard'
      : `dataset/${sample.character}/${sample.part}`;
    const filename = `${folder}/${sample.id || Math.random().toString(16).slice(2)}.jpg`;
    const cropArrayBuffer = await sample.crop.arrayBuffer();
    entries.push({ path: filename, data: new Uint8Array(cropArrayBuffer) });
  }
  const zipBlob = buildZip(entries);
  const url = URL.createObjectURL(zipBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'dataset_presets.zip';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearAllSamples() {
  await clearStore('presetSamples');
  await refreshGallery();
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function drawHandles() {
  if (!roi) return;
  const handleSize = 18 * devicePixelRatio;
  const handles = [
    [roi.displayX, roi.displayY],
    [roi.displayX + roi.displayW, roi.displayY],
    [roi.displayX, roi.displayY + roi.displayH],
    [roi.displayX + roi.displayW, roi.displayY + roi.displayH]
  ];
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  handles.forEach(([x, y]) => {
    ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
    ctx.strokeStyle = 'rgba(0, 230, 168, 0.9)';
    ctx.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
  });
}

function buildZip(entries) {
  const encoder = new TextEncoder();
  const fileRecords = [];
  let offset = 0;
  const fileDataParts = [];

  entries.forEach(({ path, data }) => {
    const nameBytes = encoder.encode(path);
    const crc = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0, true);
    header.setUint16(8, 0, true);
    header.setUint16(10, 0, true);
    header.setUint16(12, 0, true);
    header.setUint32(14, crc >>> 0, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);
    fileDataParts.push(new Uint8Array(header.buffer));
    fileDataParts.push(nameBytes);
    fileDataParts.push(data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 0x0314, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0, true);
    central.setUint32(16, crc >>> 0, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    fileRecords.push({ central: new Uint8Array(central.buffer), nameBytes });
    offset += 30 + nameBytes.length + data.length;
  });

  const centralParts = [];
  fileRecords.forEach((record) => {
    centralParts.push(record.central);
    centralParts.push(record.nameBytes);
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  const blobParts = [...fileDataParts, ...centralParts, new Uint8Array(end.buffer)];
  return new Blob(blobParts, { type: 'application/zip' });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = -1;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

init();
