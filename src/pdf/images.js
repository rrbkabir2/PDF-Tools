import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { openPdf, pdfjs } from "./pdfjs.js";

const canvasBlob = (canvas, mime) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? blob.arrayBuffer().then(resolve, reject)
          : reject(new Error("The browser could not encode this image.")),
      mime,
    ),
  );
const mimeFor = (format) => (format === "jpg" ? "image/jpeg" : "image/png");
const extFor = (format) => (format === "jpg" ? "jpg" : "png");
const pageList = (raw, max) => {
  if (!raw?.trim()) return Array.from({ length: max }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of raw.split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error("Enter pages like 1, 3-5.");
    const first = Number(m[1]),
      last = Number(m[2] || m[1]);
    if (first < 1 || last < first || last > max)
      throw new Error(`Page range ${part} is outside 1–${max}.`);
    for (let i = first; i <= last; i++) pages.add(i);
  }
  return [...pages].sort((a, b) => a - b);
};
const safeBase = (name) =>
  name.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_");

export async function pdfPagesToImages(
  file,
  { format = "png", scale = 1.5, pages: selected = "", crop = null } = {},
) {
  const pdf = await openPdf(file),
    zip = new JSZip();
  for (const n of pageList(selected, pdf.numPages)) {
    const page = await pdf.getPage(n),
      viewport = page.getViewport({ scale: Number(scale) || 1.5 }),
      canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      background: "#fff",
    }).promise;
    let outputCanvas = canvas;
    if (crop) {
      const p1 = [Number(crop.x), Number(crop.y)],
        p2 = [
          Number(crop.x) + Number(crop.width),
          Number(crop.y) + Number(crop.height),
        ];
      pdfjs.Util.applyTransform(p1, viewport.transform);
      pdfjs.Util.applyTransform(p2, viewport.transform);
      const sx = Math.max(0, Math.floor(Math.min(p1[0], p2[0]))),
        sy = Math.max(0, Math.floor(Math.min(p1[1], p2[1])));
      const sw = Math.min(
          canvas.width - sx,
          Math.ceil(Math.abs(p2[0] - p1[0])),
        ),
        sh = Math.min(canvas.height - sy, Math.ceil(Math.abs(p2[1] - p1[1])));
      if (sw < 1 || sh < 1)
        throw new Error("Crop area falls outside the page.");
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = sw;
      outputCanvas.height = sh;
      outputCanvas
        .getContext("2d")
        .drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    }
    zip.file(
      `${safeBase(file.name)}_page-${n}.${extFor(format)}`,
      await canvasBlob(outputCanvas, mimeFor(format)),
    );
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function imagesToPdf(files) {
  if (!files.length) throw new Error("Choose one or more PNG or JPG images.");
  const out = await PDFDocument.create();
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer()),
      image =
        file.type === "image/png"
          ? await out.embedPng(data)
          : await out.embedJpg(data);
    const maxW = 612,
      maxH = 792,
      scale = Math.min(maxW / image.width, maxH / image.height, 1),
      width = image.width * scale,
      height = image.height * scale;
    const page = out.addPage([maxW, maxH]);
    page.drawImage(image, {
      x: (maxW - width) / 2,
      y: (maxH - height) / 2,
      width,
      height,
    });
  }
  return out.save();
}

function imageToBlob(image) {
  const width = image.width || image.bitmap?.width,
    height = image.height || image.bitmap?.height;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  try {
    if (image.data && image.data.length === width * height * 4)
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(image.data), width, height),
        0,
        0,
      );
    else if (
      image.bitmap ||
      (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
    )
      ctx.drawImage(image.bitmap || image, 0, 0);
    else return null;
  } catch {
    return null;
  }
  return { canvas, width, height };
}

export async function extractEmbeddedImages(file) {
  const pdf = await openPdf(file),
    zip = new JSZip(),
    seen = new Set();
  let total = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n),
      viewport = page.getViewport({ scale: 0.1 }),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    const ops = await page.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (
        ops.fnArray[i] !== pdfjs.OPS.paintImageXObject &&
        ops.fnArray[i] !== pdfjs.OPS.paintInlineImageXObject
      )
        continue;
      const args = ops.argsArray[i],
        id = typeof args?.[0] === "string" ? args[0] : null;
      if (id && seen.has(id)) continue;
      let image;
      try {
        image = id
          ? await new Promise((resolve) => page.objs.get(id, resolve))
          : args?.[0];
      } catch {
        continue;
      }
      const encoded = image && imageToBlob(image);
      if (!encoded || encoded.width < 2 || encoded.height < 2) continue;
      if (id) seen.add(id);
      zip.file(
        `image-${String(++total).padStart(3, "0")}.png`,
        await canvasBlob(encoded.canvas, "image/png"),
      );
    }
  }
  if (!total)
    throw new Error("No extractable embedded raster images were found.");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
