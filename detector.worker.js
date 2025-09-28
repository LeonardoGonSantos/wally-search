import {
  computeMaskStats,
  findStripedRegions,
  ratioGate,
  hsvFromRgb
} from './color.js';

let config = null;
let ort = null;
let session = null;
let tfliteModule = null;
let enabledCharacters = new Set();
let lastDetections = [];
let frameIndex = 0;
let dropCount = 0;
let debug = false;

const temporalMemory = new Map();

self.onmessage = async (event) => {
  const { type, config: incomingConfig } = event.data;
  switch (type) {
    case 'init':
      config = incomingConfig;
      enabledCharacters = new Set(config.characters ?? []);
      await loadEngines();
      postMessage({ type: 'ready' });
      break;
    case 'frame':
      frameIndex++;
      await processFrame(event.data.bitmap);
      break;
    case 'toggle-character':
      if (event.data.enabled) {
        enabledCharacters.add(event.data.character);
      } else {
        enabledCharacters.delete(event.data.character);
      }
      break;
    case 'update-config':
      Object.assign(config, incomingConfig);
      break;
    case 'debug':
      debug = !!event.data.enabled;
      break;
    default:
      console.warn('worker: mensagem desconhecida', type);
  }
};

async function loadEngines() {
  if (session) return;
  try {
    ort = await tryImport(config.ort?.wasmPath) || await tryImport(config.ort?.fallbackWasmPath) || await import('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.wasm.min.js');
    if (ort?.InferenceSession) {
      session = await ort.InferenceSession.create(config.model.onnx, {
        executionProviders: ['wasm'],
        logSeverityLevel: 2
      });
    }
  } catch (error) {
    console.warn('Falha ao carregar ONNX Runtime', error);
  }

  if (!session) {
    try {
      const moduleFactory = await tryImport(config.tflite?.wasmPath);
      if (moduleFactory?.createTFLiteModel) {
        tfliteModule = moduleFactory;
      }
    } catch (error) {
      console.warn('Fallback TFLite indisponível', error);
    }
  }
}

async function tryImport(path) {
  if (!path) return null;
  try {
    return await import(path);
  } catch (error) {
    return null;
  }
}

async function processFrame(bitmap) {
  const deadline = config.deadlineMs ?? 30;
  const start = performance.now();
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);

  const rawImage = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const colorStats = computeMaskStats(rawImage, config);
  const rois = findStripedRegions(rawImage, config, colorStats).slice(0, config.maxRois ?? 12);
  const spentPre = performance.now() - start;

  if (spentPre > deadline) {
    dropCount++;
    postMessage({ type: 'timeout', data: { drops: dropCount } });
    return;
  }

  const detections = [];
  const inferenceStart = performance.now();

  for (const roi of rois) {
    if (performance.now() - start > deadline) {
      dropCount++;
      postMessage({ type: 'timeout', data: { drops: dropCount } });
      return;
    }
    const candidate = await runDetectorForRoi(rawImage, roi);
    if (!candidate?.length) continue;
    candidate.forEach((det) => {
      if (!enabledCharacters.has(det.label)) return;
      if (!ratioGate(det, colorStats, config)) return;
      detections.push(det);
    });
  }

  const inferenceTime = performance.now() - inferenceStart;
  const totalTime = performance.now() - start;

  const merged = nonMaxSuppression(detections, 0.45);
  const confirmed = applyTemporalMemory(merged, config.temporalWindow ?? 4, config.temporalConfirmations ?? 2);

  postMessage({
    type: 'results',
    data: {
      detections: confirmed,
      inferMs: totalTime,
      fps: totalTime ? 1000 / totalTime : 0,
      rois: rois.length,
      drops: dropCount
    }
  });
}

async function runDetectorForRoi(image, roi) {
  if (!session && !tfliteModule) {
    return [];
  }

  const { x, y, width, height } = roi;
  const inputSize = config.inputSize ?? 160;
  const cropCanvas = new OffscreenCanvas(inputSize, inputSize);
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(imageToCanvas(image), x, y, width, height, 0, 0, inputSize, inputSize);

  if (session?.inputNames?.length) {
    const tensor = await imageToTensor(cropCanvas, inputSize);
    const feeds = {};
    feeds[config.model.inputName] = tensor;
    try {
      const output = await session.run(feeds);
      return decodeDetections(output[config.model.outputName], roi, image.width, image.height);
    } catch (error) {
      console.warn('Erro inferência ONNX', error);
      return [];
    }
  }

  if (tfliteModule) {
    try {
      const result = await tfliteModule.run(cropCanvas);
      return decodeDetections(result, roi, image.width, image.height);
    } catch (error) {
      console.warn('Erro inferência TFLite', error);
    }
  }
  return [];
}

function imageToCanvas(image) {
  if (image instanceof ImageData) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(image, 0, 0);
    return canvas;
  }
  return image;
}

async function imageToTensor(canvas, size) {
  const tensorData = new Float32Array(3 * size * size);
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    tensorData[i] = data[i * 4] / 255;
    tensorData[i + size * size] = data[i * 4 + 1] / 255;
    tensorData[i + 2 * size * size] = data[i * 4 + 2] / 255;
  }
  return new ort.Tensor('float32', tensorData, [1, 3, size, size]);
}

function decodeDetections(output, roi, width, height) {
  if (!output) return [];
  const detections = [];
  const items = output.data || output;
  const stride = 6;
  for (let i = 0; i < items.length; i += stride) {
    const score = items[i + 4];
    if (score < 0.45) continue;
    const labelIndex = items[i + 5] | 0;
    const label = mapLabel(labelIndex);
    const cx = items[i] * roi.width + roi.x;
    const cy = items[i + 1] * roi.height + roi.y;
    const bw = items[i + 2] * roi.width;
    const bh = items[i + 3] * roi.height;
    detections.push({
      id: `${label}-${Math.random().toString(16).slice(2)}`,
      label,
      score,
      bbox: [cx / width, cy / height, bw / width, bh / height]
    });
  }
  return detections;
}

function mapLabel(index) {
  const list = Array.from(enabledCharacters);
  return list[index] ?? 'desconhecido';
}

function nonMaxSuppression(dets, iouThreshold) {
  if (!dets.length) return [];
  dets.sort((a, b) => b.score - a.score);
  const kept = [];
  dets.forEach((det) => {
    const shouldKeep = kept.every((other) => intersectionOverUnion(det.bbox, other.bbox) < iouThreshold);
    if (shouldKeep) kept.push(det);
  });
  return kept;
}

function intersectionOverUnion(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const left = Math.max(ax, bx);
  const top = Math.max(ay, by);
  const right = Math.min(ax + aw, bx + bw);
  const bottom = Math.min(ay + ah, by + bh);
  if (right < left || bottom < top) return 0;
  const inter = (right - left) * (bottom - top);
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

function applyTemporalMemory(dets, window, confirmations) {
  const now = frameIndex;
  const confirmed = [];
  dets.forEach((det) => {
    const key = `${det.label}-${Math.round(det.bbox[0] * 20)}-${Math.round(det.bbox[1] * 20)}`;
    const entry = temporalMemory.get(key) || { frames: [], det };
    entry.frames.push(now);
    entry.det = det;
    entry.frames = entry.frames.filter((frame) => now - frame <= window);
    if (entry.frames.length >= confirmations) {
      det.confirmed = true;
      confirmed.push(det);
    }
    temporalMemory.set(key, entry);
  });

  for (const [key, entry] of temporalMemory.entries()) {
    if (now - entry.frames[entry.frames.length - 1] > window) {
      temporalMemory.delete(key);
    }
  }

  return dets;
}
