// Checks the JS cropper finds the same label boxes as the Python version.
// Run: node test/crop.test.mjs   (after generating fixtures with make_fixtures.py)
import { readFileSync } from "node:fs";
import { findLabelBox, contentBox, is4x6 } from "../js/crop.js";

const dir = new URL("./fixtures/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir)));
const TOL = 0.01; // 1% of page size
let failed = 0;
for (const f of manifest) {
  const gray = new Uint8Array(readFileSync(new URL(`${f.name}.gray`, dir)));
  let method = "border";
  let box = is4x6(f.pageW, f.pageH) ? { x0: 0, y0: 0, x1: 1, y1: 1 } : findLabelBox(gray, f.w, f.h);
  if (!box) {
    method = "content";
    box = contentBox(gray, f.w, f.h, Math.max(f.pageW, f.pageH) <= 7.5 * 72);
  }
  const got = [box.x0, box.y0, box.x1, box.y1];
  const diff = Math.max(...got.map((v, i) => Math.abs(v - f.box[i])));
  const ok = method === f.method && diff <= TOL;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${f.name}  ${method}/${f.method}  max diff ${(diff * 100).toFixed(2)}%`);
}
process.exit(failed ? 1 : 0);
