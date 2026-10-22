import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { openPdf, pdfjs } from "./pdfjs.js";
const readDoc = async (file) => PDFDocument.load(await file.arrayBuffer());
const bytesOut = async (doc) => doc.save();
const color = (value = "#222222") => {
  const hex = value.replace("#", "");
  return rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
};
const pageNumber = (n, total) => {
  const i = Number(n) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= total)
    throw new Error(`Page number must be between 1 and ${total}.`);
  return i;
};

export async function readFormFields(file) {
  const doc = await readDoc(file);
  try {
    return doc
      .getForm()
      .getFields()
      .map((field) => ({
        name: field.getName(),
        type: field.constructor.name,
      }));
  } catch {
    return [];
  }
}

async function rasterProcess(file, options, mode) {
  const pdf = await openPdf(file);
  const out = await PDFDocument.create(),
    scale = 1.5,
    selectedPage = options.page ? Number(options.page) : 1;
  if (mode === "replace" && (!options.find || !options.replacement))
    throw new Error("Enter both the existing text and its replacement.");
  if (
    (mode === "redact" || mode === "whiteout") &&
    !(Number(options.width) > 0 && Number(options.height) > 0)
  )
    throw new Error("Area width and height must be greater than zero.");
  if (selectedPage < 1 || selectedPage > pdf.numPages)
    throw new Error(`Page number must be between 1 and ${pdf.numPages}.`);
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n),
      viewport = page.getViewport({ scale }),
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
      background: "#ffffff",
    }).promise;
    const replacements = [];
    if (n === selectedPage && (mode === "redact" || mode === "whiteout")) {
      const p1 = [Number(options.x), Number(options.y)];
      const p2 = [
        Number(options.x) + Number(options.width),
        Number(options.y) + Number(options.height),
      ];
      pdfjs.Util.applyTransform(p1, viewport.transform);
      pdfjs.Util.applyTransform(p2, viewport.transform);
      ctx.fillStyle = mode === "redact" ? "#000" : "#fff";
      ctx.fillRect(
        Math.min(p1[0], p2[0]),
        Math.min(p1[1], p2[1]),
        Math.abs(p2[0] - p1[0]),
        Math.abs(p2[1] - p1[1]),
      );
    } else if (n === selectedPage && mode === "replace") {
      const content = await page.getTextContent(),
        wanted = String(options.find).trim();
      for (const item of content.items) {
        if (!("str" in item) || item.str !== wanted) continue;
        const transform = pdfjs.Util.transform(
            viewport.transform,
            item.transform,
          ),
          x = transform[4],
          baseline = transform[5],
          h = Math.max(8, Math.abs(transform[3]));
        ctx.fillStyle = "#fff";
        ctx.fillRect(x - 1, baseline - h, item.width * scale + 3, h + 2);
        ctx.fillStyle = options.color || "#222";
        ctx.font = `${Math.max(6, Number(options.fontSize) || h / scale)}px Arial`;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(options.replacement, x, baseline);
        replacements.push(item.str);
      }
    }
    const png = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? blob.arrayBuffer().then(resolve, reject)
            : reject(new Error("Could not render a PDF page image.")),
        "image/png",
      ),
    );
    const embedded = await out.embedPng(new Uint8Array(png)),
      width = viewport.width / scale,
      height = viewport.height / scale;
    const target = out.addPage([width, height]);
    target.drawImage(embedded, { x: 0, y: 0, width, height });
    if (n === selectedPage && mode === "replace" && replacements.length === 0)
      throw new Error(
        `Could not find an exact text item matching “${options.find}” on page ${n}.`,
      );
    options.onProgress?.(n, pdf.numPages);
  }
  return bytesOut(out);
}

export async function processEdit(tool, file, options = {}) {
  if (!file) throw new Error("Choose a PDF first.");
  if (tool === "Redact PDF") return rasterProcess(file, options, "redact");
  if (tool === "Whiteout PDF") return rasterProcess(file, options, "whiteout");
  if (tool === "Edit PDF" && options.find)
    return rasterProcess(file, options, "replace");
  const source = await readDoc(file),
    out = await PDFDocument.create();
  const pages = await out.copyPages(source, source.getPageIndices());
  pages.forEach((p) => out.addPage(p));
  if (tool === "Fill forms") {
    const form = out.getForm();
    for (const field of form.getFields()) {
      if (!(field.getName() in (options.fields || {}))) continue;
      const value = options.fields[field.getName()];
      if (field.constructor.name === "PDFCheckBox")
        value ? field.check() : field.uncheck();
      else if (
        field.constructor.name === "PDFDropdown" ||
        field.constructor.name === "PDFRadioGroup"
      )
        field.select(String(value));
      else if (typeof field.setText === "function")
        field.setText(String(value));
    }
    form.flatten();
  } else {
    const index = pageNumber(options.page || 1, out.getPageCount()),
      page = out.getPages()[index],
      font = await out.embedFont(
        StandardFonts[options.font] || StandardFonts.Helvetica,
      );
    const x = Number(options.x) || 48,
      y = Number(options.y) || 48,
      size = Number(options.fontSize) || 18,
      fill = color(options.color);
    if (tool === "Add signature") {
      if (options.image) {
        const raw = new Uint8Array(await options.image.arrayBuffer()),
          embedded =
            options.image.type === "image/png"
              ? await out.embedPng(raw)
              : await out.embedJpg(raw);
        const dims = embedded.scale(
          Math.min(220 / embedded.width, 80 / embedded.height),
        );
        page.drawImage(embedded, {
          x,
          y,
          width: dims.width,
          height: dims.height,
        });
      } else if (options.points?.length > 1) {
        for (let i = 1; i < options.points.length; i++)
          page.drawLine({
            start: options.points[i - 1],
            end: options.points[i],
            thickness: 2.2,
            color: fill,
          });
      } else if (options.text?.trim())
        page.drawText(options.text, {
          x,
          y,
          size,
          font: await out.embedFont(StandardFonts.TimesRomanItalic),
          color: fill,
        });
      else
        throw new Error(
          "Type a signature or choose a PNG/JPG signature image.",
        );
    } else if (tool === "Edit PDF") {
      if (!options.text?.trim() && !options.image)
        throw new Error(
          "Enter text or choose an image to add. To replace existing text, enter an exact text item above.",
        );
      if (options.text?.trim())
        page.drawText(options.text, {
          x,
          y,
          size,
          font,
          color: fill,
          maxWidth: Number(options.width) || 420,
        });
      if (options.image) {
        const raw = new Uint8Array(await options.image.arrayBuffer()),
          embedded =
            options.image.type === "image/png"
              ? await out.embedPng(raw)
              : await out.embedJpg(raw);
        const dims = embedded.scale(
          Math.min(
            (Number(options.width) || 220) / embedded.width,
            (Number(options.height) || 160) / embedded.height,
          ),
        );
        page.drawImage(embedded, {
          x,
          y,
          width: dims.width,
          height: dims.height,
        });
      }
    } else if (tool === "Annotate PDF") {
      const width = Number(options.width) || 160,
        height = Number(options.height) || 24,
        kind = options.annotation || "highlight";
      if (kind === "highlight")
        page.drawRectangle({
          x,
          y,
          width,
          height,
          color: color(options.color || "#fff27a"),
          opacity: 0.38,
          borderWidth: 0,
        });
      else if (kind === "underline")
        page.drawLine({
          start: { x, y },
          end: { x: x + width, y },
          thickness: 1.5,
          color: fill,
        });
      else if (kind === "strikeout")
        page.drawLine({
          start: { x, y: y + height / 2 },
          end: { x: x + width, y: y + height / 2 },
          thickness: 1.5,
          color: fill,
        });
      else if (kind === "rectangle")
        page.drawRectangle({
          x,
          y,
          width,
          height,
          borderColor: fill,
          borderWidth: 2,
        });
      else if (kind === "comment" || kind === "text") {
        if (!options.text?.trim()) throw new Error("Enter annotation text.");
        page.drawText(options.text, {
          x,
          y,
          size,
          font,
          color: fill,
          maxWidth: width,
        });
      } else if (kind === "freehand") {
        const points = (options.points || []).filter(
          (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
        );
        if (points.length < 2)
          throw new Error("Freehand drawing needs at least two points.");
        for (let i = 1; i < points.length; i++)
          page.drawLine({
            start: points[i - 1],
            end: points[i],
            thickness: 2,
            color: fill,
          });
      } else throw new Error("Choose a supported annotation type.");
    } else throw new Error(`Unknown edit operation: ${tool}`);
  }
  return bytesOut(out);
}
