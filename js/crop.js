// Label detection and 4x6 layout. Pure functions over grayscale pixel arrays (no DOM),
// so they run in the browser and in Node tests alike.

export const DPI = 203;
export const OUT_W = 812; // 4in at 203 dpi
export const OUT_H = 1218; // 6in at 203 dpi
export const DETECT_SCALE = 100 / 72; // detection renders at 100 dpi (PDF units are 1/72in)
export const INK = 160; // gray below this counts as black

export function is4x6(wPt, hPt) {
  const [s, l] = [wPt, hPt].sort((a, b) => a - b);
  return Math.abs(s - 288) < 15 && Math.abs(l - 432) < 15;
}

// Binary ink mask, then a 7x7 morphological close so dotted/dashed borders become solid.
function inkMask(gray, w, h) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = gray[i] < INK ? 1 : 0;
  return m;
}

// Sliding-window max (dilate) or min (erode) along one axis, radius r.
// Matches OpenCV defaults: outside the image counts as background for dilate, ink for erode.
function morph1d(src, w, h, r, horizontal, erode) {
  const out = new Uint8Array(w * h);
  const [n, lines] = horizontal ? [w, h] : [h, w];
  const idx = horizontal ? (line, k) => line * w + k : (line, k) => k * w + line;
  const pre = new Int32Array(n + 1);
  for (let line = 0; line < lines; line++) {
    for (let k = 0; k < n; k++) pre[k + 1] = pre[k] + src[idx(line, k)];
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - r), b = Math.min(n - 1, k + r);
      const inside = pre[b + 1] - pre[a];
      if (erode) {
        const outside = 2 * r + 1 - (b - a + 1); // virtual ink beyond the edges
        out[idx(line, k)] = inside + outside === 2 * r + 1 ? 1 : 0;
      } else {
        out[idx(line, k)] = inside > 0 ? 1 : 0;
      }
    }
  }
  return out;
}

function close7(mask, w, h) {
  let m = morph1d(mask, w, h, 3, true, false);
  m = morph1d(m, w, h, 3, false, false);
  m = morph1d(m, w, h, 3, true, true);
  return morph1d(m, w, h, 3, false, true);
}

// 8-connected components; returns labels and per-component bounding boxes.
function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const boxes = [];
  const stack = new Int32Array(w * h);
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = ++next;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    boxes.push({ id, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return { labels, boxes };
}

// True if the component draws (nearly) all four sides of its bounding box.
function isOutline(labels, imgW, b) {
  const band = 4;
  const sideCoverage = (len, hit) => {
    let n = 0;
    for (let k = 0; k < len; k++) if (hit(k)) n++;
    return n / len;
  };
  const has = (x, y) => labels[y * imgW + x] === b.id;
  const anyInRows = (x, yFrom, yTo) => {
    for (let y = yFrom; y <= yTo; y++) if (has(x, y)) return true;
    return false;
  };
  const anyInCols = (y, xFrom, xTo) => {
    for (let x = xFrom; x <= xTo; x++) if (has(x, y)) return true;
    return false;
  };
  const x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
  return (
    sideCoverage(b.w, (k) => anyInRows(b.x + k, b.y, b.y + band)) > 0.9 &&
    sideCoverage(b.w, (k) => anyInRows(b.x + k, y1 - band, y1)) > 0.9 &&
    sideCoverage(b.h, (k) => anyInCols(b.y + k, b.x, b.x + band)) > 0.9 &&
    sideCoverage(b.h, (k) => anyInCols(b.y + k, x1 - band, x1)) > 0.9
  );
}

/**
 * Find the largest roughly 4x6-proportioned bordered rectangle (solid or dotted).
 * gray: Uint8Array of a page rendered at DETECT_SCALE. Returns box as page fractions
 * {x0, y0, x1, y1}, or null.
 */
export function findLabelBox(gray, w, h) {
  const mask = close7(inkMask(gray, w, h), w, h);
  const { labels, boxes } = components(mask, w, h);
  const pageArea = w * h;
  let best = null;
  for (const b of boxes) {
    const area = b.w * b.h;
    if (area < 0.12 * pageArea || area > 0.95 * pageArea) continue;
    const ratio = Math.max(b.w, b.h) / Math.min(b.w, b.h);
    if (ratio < 1.3 || ratio > 1.75) continue;
    if (!isOutline(labels, w, b)) continue;
    if (!best || area > best.w * best.h) best = b;
  }
  if (!best) return null;
  const inset = 4; // drop the border line itself
  return {
    x0: (best.x + inset) / w,
    y0: (best.y + inset) / h,
    x1: (best.x + best.w - inset) / w,
    y1: (best.y + best.h - inset) / h,
  };
}

/**
 * Bounding box of printed content. On full-size sheets, content is split into bands at
 * blank gaps of 0.5in or more and the band with the most ink is kept (drops headers and
 * instructions). Label-sized pages are kept whole, since labels have big gaps of their own.
 */
export function contentBox(gray, w, h, labelSized) {
  const rowInk = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (gray[y * w + x] < INK) n++;
    rowInk[y] = n;
  }
  const rows = [];
  for (let y = 0; y < h; y++) if (rowInk[y]) rows.push(y);
  if (!rows.length) return null;

  let top = rows[0], bottom = rows[rows.length - 1] + 1;
  if (!labelSized) {
    const minGap = 0.5 * 100; // 0.5in at 100 dpi
    let bands = [], start = rows[0];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] - rows[i - 1] > minGap) {
        bands.push([start, rows[i - 1] + 1]);
        start = rows[i];
      }
    }
    bands.push([start, rows[rows.length - 1] + 1]);
    const inkIn = ([a, b]) => { let s = 0; for (let y = a; y < b; y++) s += rowInk[y]; return s; };
    [top, bottom] = bands.reduce((best, b) => (inkIn(b) > inkIn(best) ? b : best));
  }

  let left = w, right = -1;
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] < INK) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return { x0: left / w, y0: top / h, x1: (right + 1) / w, y1: bottom / h };
}

/** Render scale (pixels per PDF point) so the box fills 4x6, and whether to rotate. */
export function planRender(box, pageWPt, pageHPt) {
  const bw = (box.x1 - box.x0) * pageWPt;
  const bh = (box.y1 - box.y0) * pageHPt;
  const landscape = bw > bh;
  const [tw, th] = landscape ? [OUT_H, OUT_W] : [OUT_W, OUT_H];
  return { scale: Math.min(tw / bw, th / bh), landscape };
}

/**
 * Crop box out of a page rendered at planRender's scale, rotate landscape labels
 * counter-clockwise, center on a 4x6 canvas and threshold to pure black/white.
 * Returns Uint8Array OUT_W*OUT_H of 0 (black) / 255 (white).
 */
export function layoutLabel(gray, w, h, box, landscape) {
  const cx0 = Math.round(box.x0 * w), cy0 = Math.round(box.y0 * h);
  let cw = Math.round(box.x1 * w) - cx0, ch = Math.round(box.y1 * h) - cy0;
  // rotated size
  let rw = landscape ? ch : cw, rh = landscape ? cw : ch;
  rw = Math.min(rw, OUT_W);
  rh = Math.min(rh, OUT_H); // trims a pixel of rounding overflow, never real content
  const ox = (OUT_W - rw) >> 1, oy = (OUT_H - rh) >> 1;

  const out = new Uint8Array(OUT_W * OUT_H).fill(255);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      // counter-clockwise: output (x, y) comes from source (cw-1-y, x)
      const sx = landscape ? cx0 + (cw - 1 - y) : cx0 + x;
      const sy = landscape ? cy0 + x : cy0 + y;
      out[(oy + y) * OUT_W + ox + x] = gray[sy * w + sx] < INK ? 0 : 255;
    }
  }
  return out;
}
