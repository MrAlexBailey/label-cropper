// Serves the site, opens test/e2e.html in headless Chrome, and waits for the page to POST
// its results. Saves label PNGs to test/out/.
// Run: node test/run-e2e.mjs [path-to-chrome]
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const chromePath = process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".pdf": "application/pdf", ".css": "text/css" };

let resolveResults;
const resultsPromise = new Promise((r) => (resolveResults = r));

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/__results") {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(204).end();
    return resolveResults(JSON.parse(body));
  }
  let pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const path = normalize(join(root, pathname));
  if (!path.startsWith(normalize(root))) return res.writeHead(403).end();
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));

const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run",
  `--user-data-dir=${fileURLToPath(new URL("./.chrome-profile", import.meta.url))}`,
  `http://127.0.0.1:${server.address().port}/test/e2e.html`], { stdio: "ignore" });
const timeout = setTimeout(() => resolveResults({ error: "timed out after 90s" }), 90_000);
const results = await resultsPromise;
clearTimeout(timeout);
chrome.kill();
server.close();

if (results.error) {
  console.error(results.error);
  process.exit(1);
}
const outDir = new URL("./out/", import.meta.url);
await mkdir(outDir, { recursive: true });
let failed = 0;
for (const r of results.pipeline) {
  // Python reports "content" for both of the browser's "trim" and "content" cases.
  const same = (m) => m === r.expected || (r.expected === "border" && m === "page") || (r.expected === "content" && m === "trim");
  const ok = r.got.length > 0 && r.got.every(same);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${r.name}  got [${r.got}] expected ${r.expected}`);
  for (const [i, png] of r.pngs.entries()) {
    await writeFile(new URL(`${r.name}-${i + 1}.png`, outDir), Buffer.from(png.split(",")[1], "base64"));
  }
}

const { ui } = results;
const uiOk = ui.cards.length === results.pipeline.length && !ui.toolbarHidden;
if (!uiOk) failed++;
console.log(`${uiOk ? "PASS" : "FAIL"} UI: ${ui.count}, toolbar ${ui.toolbarHidden ? "hidden" : "shown"}`);
for (const c of ui.cards) console.log(`  ${c.warn ? "!" : " "} ${c.name}: ${c.note}`);
await writeFile(new URL("labels-4x6.pdf", outDir), Buffer.from(ui.pdf, "base64"));
console.log("Download PDF output saved to test/out/labels-4x6.pdf");
process.exit(failed ? 1 : 0);
