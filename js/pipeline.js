// PDF -> 4x6 label images, using pdf.js for rendering and crop.js for detection.
import {
  DETECT_SCALE, OUT_W, OUT_H, is4x6, findLabelBox, contentBox, planRender, layoutLabel,
} from "./crop.js";

const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const MAX_PIXELS = 12_000_000; // stay under mobile Safari's canvas limit

async function renderGray(page, scale) {
  let vp = page.getViewport({ scale });
  if (vp.width * vp.height > MAX_PIXELS) {
    vp = page.getViewport({ scale: scale * Math.sqrt(MAX_PIXELS / (vp.width * vp.height)) });
  }
  const w = Math.floor(vp.width), h = Math.floor(vp.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const rgba = ctx.getImageData(0, 0, w, h).data;
  canvas.width = canvas.height = 0; // free memory early on phones
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return { gray, w, h };
}

// Where the label sits in the PDF's own (unrotated, y-up) coordinates, and how far to turn it
// counter-clockwise to stand upright. Used to build vector output without rasterizing.
function vectorPlacement(page, box, landscape) {
  const vp = page.getViewport({ scale: 1 });
  const corners = [[box.x0, box.y0], [box.x1, box.y1]].map(([fx, fy]) =>
    vp.convertToPdfPoint(fx * vp.width, fy * vp.height));
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  return {
    pageIndex: page.pageNumber - 1,
    bbox: { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) },
    // the viewer shows content turned clockwise by page.rotate; landscape labels then turn back 90°
    rotate: ((((landscape ? 90 : 0) - page.rotate) % 360) + 360) % 360,
  };
}

async function renderLabel(page, box) {
  const { width, height } = page.getViewport({ scale: 1 }); // points, rotation applied
  const { scale, landscape } = planRender(box, width, height);
  const { gray, w, h } = await renderGray(page, scale);
  return { pixels: layoutLabel(gray, w, h, box, landscape), vector: vectorPlacement(page, box, landscape) };
}

/**
 * Returns [{ page, method, pixels }] where method is "page" (already 4x6), "border"
 * (bordered label found), "trim" (label-sized page, margins trimmed) or "content"
 * (full sheet with no border: guessed from where the ink is, so check it).
 * pixels is a Uint8Array OUT_W*OUT_H of 0/255 (preview, and the fallback for output);
 * vector says where to find the label in the source PDF (see vectorPlacement).
 * data is consumed (pdf.js may detach it), so pass a copy if you need the bytes later.
 */
export async function processPdf(data) {
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const labels = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      if (is4x6(width, height)) {
        labels.push({ page: n, method: "page", ...(await renderLabel(page, { x0: 0, y0: 0, x1: 1, y1: 1 })) });
        continue;
      }
      const d = await renderGray(page, DETECT_SCALE);
      const box = findLabelBox(d.gray, d.w, d.h);
      if (box) labels.push({ page: n, method: "border", ...(await renderLabel(page, box)) });
    }
    if (!labels.length && doc.numPages) {
      const page = await doc.getPage(1);
      const { width, height } = page.getViewport({ scale: 1 });
      const d = await renderGray(page, DETECT_SCALE);
      const labelSized = Math.max(width, height) <= 7.5 * 72;
      const box = contentBox(d.gray, d.w, d.h, labelSized);
      // Trimming margins off a label-sized page is reliable; guessing on a full sheet isn't.
      if (box) labels.push({ page: 1, method: labelSized ? "trim" : "content", ...(await renderLabel(page, box)) });
    }
  } finally {
    doc.destroy();
  }
  return labels;
}

export function toCanvas(pixels) {
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(OUT_W, OUT_H);
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
