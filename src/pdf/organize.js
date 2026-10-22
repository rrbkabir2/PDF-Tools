import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFString,
  PDFHexString,
  StandardFonts,
  rgb,
  degrees,
} from "pdf-lib";

const safeName = (name) =>
  name.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_");

export function parsePageSelection(raw, count) {
  if (!raw.trim()) return Array.from({ length: count }, (_, i) => i);
  const selected = new Set();
  for (const part of raw.split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*[-:]\s*(\d+))?$/);
    if (!match) throw new Error("Enter pages like 1, 3-5.");
    const first = Number(match[1]),
      last = Number(match[2] || match[1]);
    if (first < 1 || last < first || last > count)
      throw new Error(`Page range ${part.trim()} is outside 1–${count}.`);
    for (let page = first; page <= last; page++) selected.add(page - 1);
  }
  return [...selected].sort((a, b) => a - b);
}

const load = async (file) => PDFDocument.load(await file.arrayBuffer());
const buildPages = async (target, source, indices) =>
  (await target.copyPages(source, indices)).forEach((page) =>
    target.addPage(page),
  );
const output = async (doc, name) => ({ bytes: await doc.save(), name });
const pdfText = (object) =>
  object instanceof PDFString || object instanceof PDFHexString
    ? object.decodeText()
    : "";

function topLevelBookmarks(doc) {
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!root) return [];
  let current = root.get(PDFName.of("First"));
  const visited = new Set(),
    pageIndex = new Map(
      doc.getPages().map((page, i) => [page.ref.toString(), i]),
    );
  const bookmarks = [];
  while (current) {
    const refTag = current.toString();
    if (visited.has(refTag)) break;
    visited.add(refTag);
    const item = doc.context.lookupMaybe(current, PDFDict);
    if (!item) break;
    let destination = item.get(PDFName.of("Dest"));
    if (!destination) {
      const action = item.lookupMaybe(PDFName.of("A"), PDFDict);
      if (action) destination = action.get(PDFName.of("D"));
    }
    const destArray =
      destination && doc.context.lookupMaybe(destination, PDFArray);
    const pageRef = destArray?.get(0);
    const page = pageRef && pageIndex.get(pageRef.toString());
    if (page !== undefined)
      bookmarks.push({
        page,
        title:
          pdfText(
            item.lookupMaybe(PDFName.of("Title"), PDFString, PDFHexString),
          ) || `Section ${bookmarks.length + 1}`,
      });
    current = item.get(PDFName.of("Next"));
  }
  return bookmarks.sort((a, b) => a.page - b.page);
}

export async function processOrganize(tool, files, options = {}) {
  if (!files.length) throw new Error("Choose a PDF first.");
  const first = files[0];
  const range = options.range || "";
  if (tool === "Merge PDFs" || tool === "Create from pages") {
    const target = await PDFDocument.create();
    for (const [index, file] of files.entries()) {
      const source = await load(file);
      await buildPages(
        target,
        source,
        parsePageSelection(
          options.ranges?.[index] ?? range,
          source.getPageCount(),
        ),
      );
    }
    return [
      await output(
        target,
        `${safeName(first.name)}_${tool === "Merge PDFs" ? "merged" : "selected-pages"}.pdf`,
      ),
    ];
  }
  const source = await load(first),
    count = source.getPageCount();
  if (tool === "Split PDF") {
    if (options.splitMode === "bookmarks") {
      const marks = topLevelBookmarks(source);
      if (!marks.length)
        throw new Error("This PDF has no usable top-level page bookmarks.");
      if (marks[0].page > 0)
        marks.unshift({ page: 0, title: "Before first bookmark" });
      const unique = marks.filter(
          (mark, i) => i === 0 || mark.page !== marks[i - 1].page,
        ),
        results = [];
      for (let i = 0; i < unique.length; i++) {
        const start = unique[i].page,
          end = unique[i + 1]?.page ?? count,
          target = await PDFDocument.create();
        if (end <= start) continue;
        await buildPages(
          target,
          source,
          Array.from({ length: end - start }, (_, n) => start + n),
        );
        results.push(
          await output(
            target,
            `${safeName(first.name)}_${safeName(unique[i].title)}.pdf`,
          ),
        );
      }
      return results;
    }
    if (options.splitMode === "range" && range.trim()) {
      const target = await PDFDocument.create();
      await buildPages(target, source, parsePageSelection(range, count));
      return [await output(target, `${safeName(first.name)}_split.pdf`)];
    }
    if (options.splitMode === "range")
      throw new Error("Enter the page range to split out.");
    const chunkSize = Number(options.splitN);
    if (!Number.isInteger(chunkSize) || chunkSize < 1)
      throw new Error("Pages per output file must be a positive whole number.");
    const results = [];
    for (let start = 0; start < count; start += chunkSize) {
      const target = await PDFDocument.create(),
        indices = Array.from(
          { length: Math.min(chunkSize, count - start) },
          (_, i) => start + i,
        );
      await buildPages(target, source, indices);
      results.push(
        await output(
          target,
          `${safeName(first.name)}_${start + 1}-${start + indices.length}.pdf`,
        ),
      );
    }
    return results;
  }
  const target = await PDFDocument.create(),
    pages = source.getPages();
  if (tool === "Extract pages") {
    await buildPages(target, source, parsePageSelection(range, count));
  } else if (tool === "Delete pages") {
    if (!range.trim()) throw new Error("Choose the page numbers to delete.");
    const remove = new Set(parsePageSelection(range, count)),
      keep = Array.from({ length: count }, (_, i) => i).filter(
        (i) => !remove.has(i),
      );
    if (!keep.length) throw new Error("Cannot delete every page.");
    await buildPages(target, source, keep);
  } else if (tool === "Reorder pages") {
    const order = String(
      options.order || Array.from({ length: count }, (_, i) => i + 1).join(","),
    )
      .split(",")
      .map((s) => Number(s.trim()) - 1);
    if (
      order.length !== count ||
      new Set(order).size !== count ||
      order.some((i) => !Number.isInteger(i) || i < 0 || i >= count)
    )
      throw new Error(
        `Enter every page once, e.g. ${Array.from({ length: count }, (_, i) => count - i).join(",")}.`,
      );
    await buildPages(target, source, order);
  } else {
    await buildPages(
      target,
      source,
      Array.from({ length: count }, (_, i) => i),
    );
    const outPages = target.getPages(),
      font = await target.embedFont(StandardFonts.Helvetica),
      ink = rgb(0.12, 0.13, 0.18);
    const selected = range.trim()
      ? parsePageSelection(range, count)
      : Array.from({ length: count }, (_, i) => i);
    if (tool === "Rotate pages") {
      const angle = Number(options.angle);
      if (![90, 180, 270].includes(angle))
        throw new Error("Choose a rotation of 90, 180, or 270 degrees.");
      for (const i of selected)
        outPages[i].setRotation(
          degrees((outPages[i].getRotation().angle + angle) % 360),
        );
    } else if (tool === "Crop PDF") {
      const inset = Number(options.margin);
      if (!Number.isFinite(inset) || inset < 0)
        throw new Error("Crop margin must be zero or greater.");
      for (const page of outPages) {
        const { width, height } = page.getSize(),
          crop = Math.min(inset, Math.min(width, height) / 2 - 1);
        page.setCropBox(crop, crop, width - 2 * crop, height - 2 * crop);
      }
    } else if (tool === "Resize pages") {
      const width = Number(options.width),
        height = Number(options.height);
      if (!(width > 0 && height > 0))
        throw new Error("Page width and height must be positive.");
      for (const page of outPages) page.setSize(width, height);
    } else if (tool === "Watermark") {
      const text = String(options.text || "").trim(),
        image = options.image;
      if (!text && !image)
        throw new Error("Enter watermark text or choose a PNG/JPG image.");
      if (text)
        for (const page of outPages) {
          const { width, height } = page.getSize();
          page.drawText(text, {
            x: width * 0.15,
            y: height * 0.48,
            size: Number(options.fontSize) || 36,
            font,
            color: rgb(0.65, 0.65, 0.68),
            opacity: 0.32,
            rotate: degrees(-35),
            maxWidth: width * 0.7,
          });
        }
      if (image) {
        const bytes = await image.arrayBuffer(),
          embedded =
            image.type === "image/png"
              ? await target.embedPng(bytes)
              : await target.embedJpg(bytes);
        for (const page of outPages) {
          const { width, height } = page.getSize(),
            dims = embedded.scale(
              Math.min(
                (width * 0.55) / embedded.width,
                (height * 0.55) / embedded.height,
              ),
            );
          page.drawImage(embedded, {
            x: (width - dims.width) / 2,
            y: (height - dims.height) / 2,
            width: dims.width,
            height: dims.height,
            opacity: 0.28,
          });
        }
      }
    } else if (tool === "Page numbers, headers & footers") {
      const template = String(options.text || "").trim();
      if (!template)
        throw new Error(
          "Enter header or footer text. Use {page} and {pages} for page values.",
        );
      for (let i = 0; i < outPages.length; i++) {
        const page = outPages[i],
          { width, height } = page.getSize(),
          size = Number(options.fontSize) || 12,
          label = template
            .replaceAll("{page}", String(i + 1))
            .replaceAll("{pages}", String(outPages.length));
        if (options.position !== "header")
          page.drawText(label, {
            x: 36,
            y: 18,
            size,
            font,
            color: ink,
            maxWidth: width - 72,
          });
        if (options.position !== "footer")
          page.drawText(label, {
            x: 36,
            y: height - size - 18,
            size,
            font,
            color: ink,
            maxWidth: width - 72,
          });
      }
    } else throw new Error(`Unknown organize operation: ${tool}`);
  }
  return [
    await output(
      target,
      `${safeName(first.name)}_${tool.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.pdf`,
    ),
  ];
}
