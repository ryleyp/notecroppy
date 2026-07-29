# notecroppy

Photograph a piece of paper — a notepad, a sticky note, a sheet of cute
stationery — straighten it, and turn it into something you can use in GoodNotes
on an iPad: either **notebook paper** (PDF) or a **sticker** (transparent PNG).

It runs entirely in the browser. No account, no server, no upload. Your photos
never leave your device.

## Getting a piece of stationery into GoodNotes

The whole point of the app, start to finish:

1. Open notecroppy on your **iPhone** and tap **Take or choose a photo**.
   Photograph the paper flat-on-ish, with the whole sheet in frame.
2. It tries to find the edges. Drag any corner that looks off — a magnifier
   pops up so your finger isn't covering the edge you're lining up.
3. Tap **Flatten**. The angle is corrected and you get a square-on sheet.
4. Pick a look, rotate if needed, and optionally **Cut out background** to make
   a sticker.
5. Tap **Export**, choose a format, then **Share to GoodNotes**. That opens the
   iOS share sheet — pick GoodNotes, or **Save to Files** and open it on your
   iPad from iCloud Drive.

In GoodNotes on the iPad:

- **As notebook paper** — export a **PDF**. In GoodNotes: *New → Import*, pick
  the PDF. Or add it as a template under *Notebook paper → Import*.
- **As a sticker** — export a **PNG** with cut-out on. In GoodNotes, use the
  image tool or the Elements/sticker panel and add the PNG. Transparent areas
  stay transparent, so it sits on the page like a real sticky note.

### Which crop to use

This trips people up, so it is worth stating plainly:

- **For notebook paper**, put the four corners exactly on the corners of the
  sheet. You get a clean, square-on page with no background.
- **For a sticker with the background removed**, crop *looser* — leave some of
  the desk or table visible around the paper. The background remover works by
  flooding inward from the edges of the crop, so it needs some background to
  start from. If you crop tight to the paper, there is nothing but paper at the
  edges and it will erase the whole thing. The app detects this and tells you.

For a die-cut or torn-edge sticker, place the corners on a rectangular patch of
the *surface* around the paper, roughly squared up with it. You still get the
perspective correction, and you keep the background needed for the cut-out.

## Running it locally

```bash
npm install
npm run dev
```

Then open http://localhost:5273.

Other scripts:

```bash
npm test        # unit tests for the image maths
npm run lint    # eslint
npm run build   # typecheck + production build into dist/
npm run icons   # regenerate the PWA icons
```

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable it once under
**Settings → Pages → Source → GitHub Actions**.

The site lands at `https://<user>.github.io/notecroppy/`, which `vite.config.ts`
already sets as the production `base`. If you rename the repo, change that too.

HTTPS matters here: iOS will not grant camera access or allow installing to the
home screen over plain HTTP, which is why the deployed Pages URL is the one to
use on your phone rather than a laptop's local IP.

### Installing to the home screen

On iPhone, open the deployed URL in Safari, tap Share, then **Add to Home
Screen**. It then launches without browser chrome and works offline.

## How it works

Everything is client-side. The interesting parts live in `src/lib/`:

| Module | What it does |
| --- | --- |
| `homography.ts` | Solves the 8-parameter projective transform mapping one quad onto another, by Gaussian elimination with partial pivoting. |
| `warp.ts` | Flattens the cropped quad into an upright rectangle by inverse mapping every output pixel with bilinear sampling. |
| `detectEdges.ts` | Estimates where the sheet is: downscale, blur, Sobel, then find the strongest straight line per side and intersect them. |
| `cutout.ts` | Background removal by flood fill inward from the border, plus feathering, brush touch-ups and mask resampling. |
| `filters.ts` | Per-channel white balance, greyscale, and Otsu-thresholded black & white. |
| `pageSizes.ts` | Page presets and the layout maths for placing the image on a PDF page. |
| `pipeline.ts` | Crop → rotate → filter, run once cheaply for the editor and again at full resolution for export. |

The editor works on a copy downscaled to 1600px so dragging stays responsive.
Corner positions are stored in source-image coordinates, and the export re-runs
the whole pipeline against the original full-resolution pixels — so a 12MP photo
exports at full size, not at preview size.

The image maths is covered by unit tests (94 of them). The homography is checked
against known point correspondences — identity, translation, scale, rotation,
and a genuinely projective quad — plus round-trip inversion and a check that it
is not secretly an affine transform.

## Known limitations

Being upfront about the rough edges:

- **Edge detection is simple.** It finds one dominant straight line per side and
  intersects them. That works well when the paper roughly fills the frame
  against a contrasting surface. It does poorly on a busy background, a heavily
  rotated sheet, or paper close in colour to the surface underneath. When it is
  unsure it says so and gives you a rectangle to drag instead. Manual correction
  is always available and is the intended fallback, not a failure case.
- **Background removal is a flood fill, not a segmentation model.** It handles a
  plain, evenly-lit surface well. Shadows under the paper, a patterned desk, or
  a surface close in colour to the stationery will confuse it. The tolerance
  slider and the erase/restore brush exist because of this.
- **Adjusting the tolerance slider discards brush touch-ups**, because the mask
  is rebuilt from scratch. Get the tolerance roughly right first, then brush.
- **"Brighten" forces the lightest tone in the crop to white.** That is what you
  want for notepaper and wrong for saturated coloured stationery, which comes
  out washed out. Use **Original** for pretty paper.
- **No pinch-zoom on the crop screen.** The magnifier covers precision placement,
  the same way iOS's own document scanner does, so the extra gesture handling
  was left out rather than half-done.
- **The flatten step blocks briefly** on a big photo — the warp is synchronous on
  the main thread. It is a second or so on a 12MP image, with a spinner.
- **Share to GoodNotes needs the Web Share API**, which on iOS means Safari. On
  browsers without it the button is hidden and you get a plain download instead.

## Privacy

There is no backend. No analytics, no network requests for your images, nothing
uploaded. Exports are kept in IndexedDB on your device so you can re-share them,
and **Clear library** deletes them. Uninstalling the PWA or clearing site data
removes everything.
