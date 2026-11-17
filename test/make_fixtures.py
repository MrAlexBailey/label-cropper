"""Render sample PDFs to grayscale fixtures and record the Python cropper's boxes.

Usage (from the shipping-label-extract venv):
  python test/make_fixtures.py ../shipping-label-extract/labels/*.pdf
Fixtures contain real label data and are gitignored.
"""
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shipping-label-extract"))
from labelprint import crop  # noqa: E402

out = Path(__file__).parent / "fixtures"
out.mkdir(exist_ok=True)
manifest = []
for pdf in sys.argv[1:]:
    with crop.pymupdf.open(pdf) as doc:
        page = doc[0]
        gray = crop._render_gray(page, crop.DETECT_ZOOM)
        box = crop.find_label_box(page)
        method = "border" if box else "content"
        if box is None:
            box = crop._content_box(page)
        name = Path(pdf).stem
        (out / f"{name}.gray").write_bytes(gray.tobytes())
        shutil.copy(pdf, out / Path(pdf).name)
        manifest.append({
            "name": name, "pdf": Path(pdf).name, "w": gray.shape[1], "h": gray.shape[0],
            "pageW": page.rect.width, "pageH": page.rect.height,
            "method": method, "box": list(box),
        })
(out / "manifest.json").write_text(json.dumps(manifest, indent=1))
print(f"{len(manifest)} fixtures written to {out}")
