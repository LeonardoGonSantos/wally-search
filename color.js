const TWO_PI = Math.PI * 2;

const thresholds = {
  red: { ranges: [[345, 360], [0, 15]], s: 0.45, v: 0.35 },
  white: { s: 0.2, v: 0.75 },
  yellow: { ranges: [[40, 65]], s: 0.45, v: 0.45 },
  black: { v: 0.2 },
  orange: { ranges: [[15, 30]], s: 0.55 },
  magenta: { ranges: [[300, 330]], s: 0.5 },
  yellow_brown: { ranges: [[25, 40]], s: 0.5 }
};

export function hsvFromRgb(r, g, b) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) h = ((gNorm - bNorm) / delta) % 6;
    else if (max === gNorm) h = (bNorm - rNorm) / delta + 2;
    else h = (rNorm - gNorm) / delta + 4;
  }
  h = Math.round((h * 60 + 360) % 360);
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

export function computeMaskStats(imageData) {
  const { data, width, height } = imageData;
  const totals = {
    red: 0,
    white: 0,
    yellow: 0,
    black: 0,
    orange: 0,
    magenta: 0,
    yellow_brown: 0,
    total: width * height
  };
  for (let i = 0; i < data.length; i += 4) {
    const hsv = hsvFromRgb(data[i], data[i + 1], data[i + 2]);
    classify(hsv, totals);
  }
  return { totals, width, height, data };
}

export function findStripedRegions(imageData, config, stats) {
  const regions = [];
  const width = imageData.width;
  const height = imageData.height;
  const minSize = Math.max(48, Math.min(width, height) * 0.15);
  const sizes = [minSize, minSize * 1.5, minSize * 2];
  const step = minSize * 0.5;
  const characters = Object.keys(config.colorRules || {});

  for (const size of sizes) {
    for (let y = 0; y < height - size; y += step) {
      for (let x = 0; x < width - size; x += step) {
        const regionStats = computeRegion(imageData, x, y, size, size);
        for (const character of characters) {
          if (!config.characters.includes(character)) continue;
          const rule = config.colorRules[character];
          if (!rule) continue;
          const positiveOk = evaluatePositive(rule.positive, regionStats);
          if (!positiveOk) continue;
          const negativeOk = !(rule.negative || []).some((neg) => evaluateNegative(neg, regionStats));
          if (!negativeOk) continue;
          regions.push({ x, y, width: size, height: size, hint: character, stats: regionStats });
        }
      }
    }
  }

  return dedupeRegions(regions, width, height);
}

function dedupeRegions(regions, width, height) {
  const deduped = [];
  regions.sort((a, b) => (b.stats.luma - a.stats.luma));
  regions.forEach((region) => {
    const norm = [region.x / width, region.y / height, region.width / width, region.height / height];
    const keep = deduped.every((other) => intersectionOverUnion(norm, [other.x / width, other.y / height, other.width / width, other.height / height]) < 0.35);
    if (keep) deduped.push(region);
  });
  return deduped;
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
  return union <= 0 ? 0 : inter / union;
}

function computeRegion(imageData, x, y, width, height) {
  const { data } = imageData;
  const stats = {
    red: 0,
    white: 0,
    yellow: 0,
    black: 0,
    orange: 0,
    magenta: 0,
    yellow_brown: 0,
    pixels: width * height,
    luma: 0
  };
  const imgWidth = imageData.width;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = ((row + y) * imgWidth + (col + x)) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const hsv = hsvFromRgb(r, g, b);
      classify(hsv, stats);
      stats.luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }
  stats.luma /= stats.pixels;
  return stats;
}

function classify(hsv, stats) {
  if (matchThreshold(hsv, thresholds.red)) stats.red++;
  if (matchThreshold(hsv, thresholds.white)) stats.white++;
  if (matchThreshold(hsv, thresholds.yellow)) stats.yellow++;
  if (matchThreshold(hsv, thresholds.black)) stats.black++;
  if (matchThreshold(hsv, thresholds.orange)) stats.orange++;
  if (matchThreshold(hsv, thresholds.magenta)) stats.magenta++;
  if (matchThreshold(hsv, thresholds.yellow_brown)) stats.yellow_brown++;
}

function matchThreshold(hsv, descriptor) {
  if (descriptor.ranges) {
    const inRange = descriptor.ranges.some(([start, end]) => {
      if (start > end) {
        return hsv.h >= start || hsv.h <= end;
      }
      return hsv.h >= start && hsv.h <= end;
    });
    if (!inRange) return false;
  }
  if (descriptor.s != null && hsv.s < descriptor.s) return false;
  if (descriptor.v != null) {
    if (descriptor.v <= 0.3 && hsv.v > descriptor.v) return false;
    if (descriptor.v > 0.3 && hsv.v < descriptor.v) return false;
  }
  return true;
}

function evaluatePositive(type, stats) {
  const redRatio = stats.red / stats.pixels;
  const whiteRatio = stats.white / stats.pixels;
  const yellowRatio = stats.yellow / stats.pixels;
  const blackRatio = stats.black / stats.pixels;
  switch (type) {
    case 'red_white_stripes':
      return redRatio >= 0.25 && redRatio <= 0.6 && whiteRatio >= 0.15 && whiteRatio <= 0.5 && hasStripe(stats.red, stats.white);
    case 'yellow_black_stripes':
      return yellowRatio >= 0.25 && yellowRatio <= 0.6 && blackRatio >= 0.15 && blackRatio <= 0.5 && hasStripe(stats.yellow, stats.black);
    case 'red_white_beard':
      return redRatio > 0.2 && whiteRatio > 0.25;
    case 'red_white_spot':
      return redRatio > 0.15 && whiteRatio > 0.15;
    default:
      return false;
  }
}

function hasStripe(primary, secondary) {
  const ratio = Math.min(primary, secondary) / Math.max(primary, secondary || 1);
  return ratio > 0.4;
}

function evaluateNegative(type, stats) {
  switch (type) {
    case 'orange':
      return stats.orange / stats.pixels > 0.2;
    case 'magenta':
      return stats.magenta / stats.pixels > 0.2;
    case 'yellow_brown':
      return stats.yellow_brown / stats.pixels > 0.25;
    default:
      return false;
  }
}

export function ratioGate(det, globalStats, config) {
  if (!det?.label) return false;
  const label = det.label;
  const region = regionFromBbox(globalStats, det.bbox);
  if (!region) return false;
  const rule = config.colorRules?.[label];
  if (!rule) return true;
  const positive = evaluatePositive(rule.positive, region);
  const negative = (rule.negative || []).some((neg) => evaluateNegative(neg, region));
  return positive && !negative;
}

function regionFromBbox(stats, bbox) {
  if (!stats?.data) return null;
  const [x, y, w, h] = bbox;
  const width = Math.round(w * stats.width);
  const height = Math.round(h * stats.height);
  const startX = Math.max(0, Math.round(x * stats.width));
  const startY = Math.max(0, Math.round(y * stats.height));
  const region = computeRegion({ data: stats.data, width: stats.width, height: stats.height }, startX, startY, Math.max(1, width), Math.max(1, height));
  return region;
}
