import { processPdf, toCanvas } from "./pipeline.js";
import { buildPdf } from "./output.js";

const $ = (s) => document.querySelector(s);
const drop = $("#drop");
const input = $("#file");
const list = $("#labels");
const toolbar = $("#toolbar");
const status = $("#status");

/**
 * @type {{ id: number, name: string, method: string, canvas: HTMLCanvasElement,
 *          source: Uint8Array, vector: object }[]}
 */
let labels = [];
let nextId = 1;

const NOTES = {
  page: "Already 4×6",
  border: "Label found",
  trim: "Margins trimmed",
  content: "No border found, cropped to content. Check before printing.",
};

async function addFiles(files) {
  const pdfs = [...files].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  if (!pdfs.length) {
    setStatus("That doesn't look like a PDF.");
    return;
  }
  for (const file of pdfs) {
    setStatus(`Reading ${file.name}…`);
    try {
      const source = new Uint8Array(await file.arrayBuffer());
      const found = await processPdf(source.slice()); // pdf.js may detach its copy
      if (!found.length) {
        setStatus(`No label found in ${file.name}.`);
        continue;
      }
      for (const l of found) {
        const suffix = found.length > 1 ? ` (page ${l.page})` : "";
        labels.push({
          id: nextId++, name: file.name + suffix, method: l.method,
          canvas: toCanvas(l.pixels), source, vector: l.vector,
        });
      }
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't read ${file.name}: ${err.message}`);
    }
  }
  render();
}

function setStatus(text) {
  status.textContent = text;
}

function render() {
  list.replaceChildren(
    ...labels.map((l) => {
      const card = document.createElement("li");
      card.className = "card" + (l.method === "content" ? " warn" : "");
      l.canvas.className = "preview";
      l.canvas.setAttribute("role", "img");
      l.canvas.setAttribute("aria-label", `Cropped label from ${l.name}`);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = `<span class="name"></span><span class="note"></span>`;
      meta.querySelector(".name").textContent = l.name;
      meta.querySelector(".note").textContent = NOTES[l.method];
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        labels = labels.filter((x) => x.id !== l.id);
        render();
      });
      meta.append(remove);
      card.append(l.canvas, meta);
      return card;
    }),
  );
  toolbar.hidden = labels.length === 0;
  $("#thanks").hidden = labels.length === 0;
  $("#count").textContent = `${labels.length} label${labels.length === 1 ? "" : "s"}`;
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

async function pdfUrl() {
  const bytes = await buildPdf(labels);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

async function printLabels() {
  // iOS can't print a PDF from inside a page; open it so the share sheet's Print works.
  // The tab is opened before any await so popup blockers allow it.
  const tab = isIOS ? window.open("", "_blank") : null;
  setStatus("Preparing labels…");
  try {
    const url = await pdfUrl();
    if (tab) {
      tab.location.href = url;
    } else {
      let frame = $("#print-frame");
      if (!frame) {
        frame = document.createElement("iframe");
        frame.id = "print-frame";
        frame.title = "Labels to print";
        frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
        document.body.append(frame);
      }
      frame.onload = () => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch {
          window.open(url, "_blank"); // some browsers won't print an embedded PDF
        }
      };
      frame.src = url;
    }
    setStatus("");
  } catch (err) {
    tab?.close();
    console.error(err);
    setStatus(`Couldn't prepare the labels: ${err.message}`);
  }
}

async function downloadPdf() {
  setStatus("Preparing PDF…");
  try {
    const a = document.createElement("a");
    a.href = await pdfUrl();
    const base = labels.length === 1 ? labels[0].name.replace(/\.pdf.*$/i, "") : "labels";
    a.download = `${base}-4x6.pdf`;
    a.click();
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't build the PDF: ${err.message}`);
  }
}

input.addEventListener("change", () => {
  addFiles(input.files);
  input.value = "";
});
for (const ev of ["dragenter", "dragover"]) {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
}
for (const ev of ["dragleave", "drop"]) {
  drop.addEventListener(ev, () => drop.classList.remove("over"));
}
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});
// Let people drop anywhere on the page, not just the box.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!drop.contains(e.target)) addFiles(e.dataTransfer.files);
});
$("#print").addEventListener("click", printLabels);
$("#download").addEventListener("click", downloadPdf);
$("#clear").addEventListener("click", () => {
  labels = [];
  render();
});
