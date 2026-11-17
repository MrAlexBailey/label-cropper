# 4×6 Label Cropper

Crops shipping labels out of letter-size PDFs (USPS, UPS, FedEx, eBay, Vinted, Mercari, …)
into 4×6 for thermal label printers. Everything runs in the browser and files are never uploaded.

## How it finds the label
1. If the page is already 4×6, use it as-is.
2. Otherwise, look for the largest bordered rectangle with a 4×6-like shape (solid or dotted border).
3. If there's no border, use a label-sized page with its margins trimmed. On a full sheet, use the
   largest block of printed content; these are flagged in the UI for a quick check.

Landscape labels are rotated upright. Output is 812×1218 px (4×6 in at 203 dpi), pure black and white.

## Deploy to GitHub Pages
```
git init && git add . && git commit -m "Label cropper"
git branch -M main
git remote add origin https://github.com/<you>/label-cropper.git
git push -u origin main
```
Then in the repo, go to Settings → Pages → Deploy from branch → `main` / root.
The site will be at `https://<you>.github.io/label-cropper/`.

## Tests
Fixtures are generated from your own label PDFs and stay out of git:
```
# Python reference implementation lives in ../shipping-label-extract
../shipping-label-extract/.venv/Scripts/python test/make_fixtures.py path/to/labels/*.pdf
node test/crop.test.mjs   # detection matches the Python version
node test/run-e2e.mjs     # full browser pipeline + UI in headless Chrome; output in test/out/
```
