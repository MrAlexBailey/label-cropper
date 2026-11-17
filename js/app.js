import { processPdf, toCanvas } from "./pipeline.js";

const $ = (s) => document.querySelector(s);
const drop = $("#drop");
const input = $("#file");
const list = $("#labels");
const toolbar = $("#toolbar");
const status = $("#status");
const printArea = $("#print-area");

/** @type {{ id: number, name: string, method: string, canvas: HTMLCanvasElement }[]} */
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
      const found = await processPdf(await file.arrayBuffer());
      if (!found.length) {
        setStatus(`No label found in ${file.name}.`);
        continue;
      }
      for (const l of found) {
        const suffix = found.length > 1 ? ` (page ${l.page})` : "";
        labels.push({ id: nextId++, name: file.name + suffix, method: l.method, canvas: toCanvas(l.pixels) });
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

function printLabels() {
  printArea.replaceChildren(
    ...labels.map((l) => {
      const img = new Image();
      img.src = l.canvas.toDataURL("image/png");
      img.alt = "";
      const sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.append(img);
      return sheet;
    }),
  );
  // give images a tick to decode before the dialog snapshots the page
  setTimeout(() => window.print(), 50);
}

function downloadPdf() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "in", format: [4, 6], compress: true });
  labels.forEach((l, i) => {
    if (i) pdf.addPage([4, 6], "portrait");
    pdf.addImage(l.canvas.toDataURL("image/png"), "PNG", 0, 0, 4, 6, undefined, "FAST");
  });
  const base = labels.length === 1 ? labels[0].name.replace(/\.pdf.*$/i, "") : "labels";
  pdf.save(`${base}-4x6.pdf`);
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
