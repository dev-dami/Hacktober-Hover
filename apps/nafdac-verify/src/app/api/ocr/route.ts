import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";

const MAX_BYTES = 10 * 1024 * 1024;
const extensions: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > MAX_BYTES + 1024 * 1024) {
    return Response.json({ error: "Image must be 10 MB or smaller." }, { status: 413 });
  }
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
      return Response.json({ error: "Choose an image of up to 10 MB." }, { status: 400 });
    }
    const original = Buffer.from(await file.arrayBuffer());
    const image = sharp(original, { limitInputPixels: 40_000_000, failOn: "error" });
    const metadata = await image.metadata();
    const extension = metadata.format && extensions[metadata.format];
    if (!extension) return Response.json({ error: "Use a JPEG, PNG, or WebP image." }, { status: 400 });
    const { data: normalized, info } = await image.rotate().png().toBuffer({ resolveWithObject: true });
    worker = await createWorker("eng");
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const result = await worker.recognize(normalized, {}, { blocks: true, text: true });
    const words = (result.data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) =>
        line.words.filter((word) => word.text.trim()).map((word) => ({
          text: word.text, confidence: word.confidence, bbox: word.bbox,
        })),
      )),
    );
    const id = randomUUID();
    const dir = path.resolve(process.cwd(), "data", "ocr", id);
    await mkdir(dir, { recursive: true });
    const annotation = {
      id, createdAt: new Date().toISOString(), status: "unreviewed", engine: "tesseract.js",
      originalFile: `original.${extension}`, imageFile: "image.png", width: info.width, height: info.height,
      text: result.data.text, words,
    };
    await Promise.all([
      writeFile(path.join(dir, annotation.originalFile), original),
      writeFile(path.join(dir, annotation.imageFile), normalized),
      writeFile(path.join(dir, "annotation.json"), JSON.stringify(annotation, null, 2)),
    ]);
    return Response.json({ ...annotation, image: `data:image/png;base64,${normalized.toString("base64")}` });
  } catch (error) {
    console.error("OCR failed", error);
    return Response.json({ error: "Could not process this image. Try a clear JPEG, PNG, or WebP photo." }, { status: 500 });
  } finally {
    if (worker) await worker.terminate();
  }
}
