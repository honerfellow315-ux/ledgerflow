export interface DocumentPage {
  mimeType: "image/jpeg";
  data: string;
}
export async function prepareDocument(
  file: File,
): Promise<{ pages: DocumentPage[]; fileHash: string }> {
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new Error("Choose a nonempty file under 8 MB.");
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fileHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const pages: DocumentPage[] = [];
  const capture = (canvas: HTMLCanvasElement) => {
    pages.push({
      mimeType: "image/jpeg",
      data: canvas.toDataURL("image/jpeg", 0.88).split(",")[1]!,
    });
    if (pages.reduce((sum, p) => sum + p.data.length, 0) > 3_800_000)
      throw new Error(
        "These pages are too large for one AI request. Split the PDF or use fewer pages.",
      );
  };
  const canvas = document.createElement("canvas");
  try {
    if (/\.pdf$/i.test(file.name)) {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = (
        await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
      ).default;
      const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
      try {
        if (doc.numPages > 10)
          throw new Error(
            "AI reading accepts at most 10 pages. Split the PDF; no pages will be silently skipped.",
          );
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const base = p.getViewport({ scale: 1 });
          const viewport = p.getViewport({ scale: 1600 / Math.max(base.width, base.height) });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await p.render({ canvasContext: canvas.getContext("2d")!, viewport, background: "white" })
            .promise;
          capture(canvas);
          p.cleanup();
        }
      } finally {
        await doc.destroy();
      }
    } else {
      if (!/\.(jpe?g|png|webp)$/i.test(file.name))
        throw new Error("Use PDF, JPG, PNG or WebP. Convert HEIC to JPG first.");
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        capture(canvas);
      } finally {
        bitmap.close();
      }
    }
    return { pages, fileHash };
  } finally {
    canvas.width = canvas.height = 0;
  }
}
