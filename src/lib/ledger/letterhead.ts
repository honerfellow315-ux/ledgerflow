/**
 * Auto-detects safe top/bottom margins on an uploaded letterhead image, so
 * invoice/statement content doesn't overlap the letterhead's own header or
 * footer artwork (logo band, colour strip, contact-details footer, etc).
 *
 * Heuristic: assume the image represents a full A4 page (210 x 297mm).
 * Scan rows of pixels and classify each as "quiet" (near-white/transparent,
 * i.e. no printed artwork) or "busy". Group consecutive quiet rows into
 * runs, and keep only runs long enough to be a genuine blank content area
 * (not just the gap between two lines of a logo or footer block). The
 * FIRST such run (from the top) marks where the header artwork ends; the
 * LAST such run (from the bottom) marks where the footer artwork begins.
 * Using the first/last *significant* run — instead of stopping at the very
 * first quiet row, or at whichever run happens to be longest — is what
 * keeps this correct both for letterheads with a mid-page watermark (which
 * splits the blank area into two runs) and for footers built from several
 * lines with small gaps between them (icons row, divider, address row —
 * each individually "quiet" for a few rows, but not the real footer edge).
 * This is a heuristic, not true layout understanding, so the result is
 * always shown to the user as an editable, pre-filled suggestion rather
 * than applied silently.
 */

const A4_HEIGHT_MM = 297;
const QUIET_ROW_THRESHOLD = 0.985; // fraction of pixels in a row considered "near white"
const MIN_BLANK_RUN_FRACTION = 0.05; // a run of quiet rows must span at least ~5% of page height (~15mm) to count as real blank content area, not just a gap between two lines of artwork
const NEAR_WHITE = 246; // 0-255 per channel

export interface LetterheadAnalysis {
  marginTopMm: number;
  marginBottomMm: number;
  imageWidth: number;
  imageHeight: number;
}

function isRowQuiet(data: Uint8ClampedArray, width: number, y: number): boolean {
  const rowStart = y * width * 4;
  let quietPixels = 0;
  for (let x = 0; x < width; x++) {
    const i = rowStart + x * 4;
    const r = data[i] ?? 255;
    const g = data[i + 1] ?? 255;
    const b = data[i + 2] ?? 255;
    const a = data[i + 3] ?? 255;
    // Transparent or near-white counts as "quiet" (no printed artwork here).
    if (a < 10 || (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE)) quietPixels++;
  }
  return quietPixels / width >= QUIET_ROW_THRESHOLD;
}

/**
 * Loads a data-URL image and returns suggested top/bottom margins in mm.
 * Resolves with zero margins (and the image's natural size) if analysis
 * fails for any reason — callers should treat that as "couldn't tell,
 * please set manually" rather than an error.
 */
export function analyzeLetterhead(dataUrl: string): Promise<LetterheadAnalysis> {
  return new Promise((resolve) => {
    const fallback = { marginTopMm: 0, marginBottomMm: 0, imageWidth: 0, imageHeight: 0 };
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          if (!width || !height) return resolve(fallback);

          const canvas = document.createElement("canvas");
          // Downscale for speed — we only need row-level "is this quiet" data.
          const scale = Math.min(1, 400 / width);
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(fallback);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

          const rowQuiet: boolean[] = [];
          for (let y = 0; y < canvas.height; y++) rowQuiet.push(isRowQuiet(data, canvas.width, y));

          const minRunRows = Math.max(3, Math.round(canvas.height * MIN_BLANK_RUN_FRACTION));

          // Collect every run of consecutive quiet rows at least minRunRows long.
          const runs: Array<{ start: number; end: number }> = [];
          let runStart: number | null = null;
          for (let y = 0; y < canvas.height; y++) {
            if (rowQuiet[y]) {
              if (runStart === null) runStart = y;
            } else if (runStart !== null) {
              if (y - runStart >= minRunRows) runs.push({ start: runStart, end: y });
              runStart = null;
            }
          }
          if (runStart !== null && canvas.height - runStart >= minRunRows) {
            runs.push({ start: runStart, end: canvas.height });
          }

          // No significant blank run found (very busy image) — leave it to
          // manual entry rather than guessing.
          if (runs.length === 0) {
            return resolve({ ...fallback, imageWidth: width, imageHeight: height });
          }

          // First run's start = where the header artwork ends.
          // Last run's end = where the footer artwork begins. On a plain
          // letterhead these come from the same run; a mid-page watermark
          // just means the content well sits between two runs, which this
          // still gets right since it only looks at the outermost edges.
          const topRow = runs[0].start;
          const bottomRow = runs[runs.length - 1].end;

          const marginTopMm = Math.round((topRow / canvas.height) * A4_HEIGHT_MM * 10) / 10;
          const marginBottomMm =
            Math.round(((canvas.height - bottomRow) / canvas.height) * A4_HEIGHT_MM * 10) / 10;

          resolve({
            marginTopMm: Math.min(marginTopMm, 120),
            marginBottomMm: Math.min(marginBottomMm, 100),
            imageWidth: width,
            imageHeight: height,
          });
        } catch {
          resolve(fallback);
        }
      };
      img.onerror = () => resolve(fallback);
      img.src = dataUrl;
    } catch {
      resolve(fallback);
    }
  });
}
