// Builds the 4x6 output PDF by copying each label's original vector content (cropped and
// turned upright) onto a 4x6 page, so text and barcodes stay sharp and the printer driver
// rasterizes them at its own resolution. Falls back to the preview image for a label whose
// source PDF can't be embedded (e.g. some encrypted files).
const { PDFDocument, degrees } = window.PDFLib;

const PAGE_W = 288; // 4in in PDF points
const PAGE_H = 432; // 6in
const MARGIN = 7.2; // 0.1in on every side, so slight feed drift can't clip the label
const FIT_W = PAGE_W - 2 * MARGIN;
const FIT_H = PAGE_H - 2 * MARGIN;

// Lower-left corner of a w x h box after turning it counter-clockwise about the origin.
const TURNED_MIN = { 0: (w, h) => [0, 0], 90: (w, h) => [-h, 0], 180: (w, h) => [-w, -h], 270: (w, h) => [0, -w] };

function place(page, embedded, angle) {
  const turned = angle === 90 || angle === 270;
  const scale = Math.min(
    FIT_W / (turned ? embedded.height : embedded.width),
    FIT_H / (turned ? embedded.width : embedded.height),
  );
  const w = embedded.width * scale, h = embedded.height * scale;
  const [outW, outH] = turned ? [h, w] : [w, h];
  const [minX, minY] = TURNED_MIN[angle](w, h);
  page.drawPage(embedded, {
    x: (PAGE_W - outW) / 2 - minX,
    y: (PAGE_H - outH) / 2 - minY,
    xScale: scale,
    yScale: scale,
    rotate: degrees(angle),
  });
}

/**
 * labels: [{ source: Uint8Array (original PDF bytes), vector, canvas }]
 * Returns the PDF as a Uint8Array.
 */
export async function buildPdf(labels) {
  const out = await PDFDocument.create();
  const loaded = new Map();
  for (const l of labels) {
    const page = out.addPage([PAGE_W, PAGE_H]);
    try {
      if (!loaded.has(l.source)) loaded.set(l.source, PDFDocument.load(l.source, { ignoreEncryption: true }));
      const src = await loaded.get(l.source);
      const [embedded] = await out.embedPages([src.getPage(l.vector.pageIndex)], [l.vector.bbox]);
      place(page, embedded, l.vector.rotate);
    } catch (err) {
      console.warn("Couldn't copy the label's vector content; using the image instead.", err);
      const png = await out.embedPng(l.canvas.toDataURL("image/png"));
      page.drawImage(png, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    }
  }
  return out.save();
}
