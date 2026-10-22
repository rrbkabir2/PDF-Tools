import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { extractPdfText } from "./text.js";
import { escapeHtml } from "./convert.js";

export async function processOptimize(tool, files, options = {}) {
  if (!files.length) throw new Error("Choose a PDF first.");
  const file = files[0];
  if (tool === "Compare PDFs") {
    if (files.length !== 2)
      throw new Error("Choose exactly two PDFs to compare.");
    const [left, right] = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        pages: (await PDFDocument.load(await f.arrayBuffer())).getPageCount(),
        text: await extractPdfText(f),
      })),
    );
    const a = left.text.split(/\r?\n/),
      b = right.text.split(/\r?\n/),
      count = Math.max(a.length, b.length),
      rows = [];
    for (let i = 0; i < count; i++)
      if ((a[i] || "") !== (b[i] || ""))
        rows.push({ line: i + 1, left: a[i] || "", right: b[i] || "" });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>PDF comparison</title><style>body{font:14px Arial,sans-serif;margin:32px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top;white-space:pre-wrap}th{background:#f2f2f7}.changed{background:#fff1e9}.meta{color:#666}</style></head><body><h1>PDF comparison</h1><p class="meta">${escapeHtml(left.name)} (${left.pages} pages) vs ${escapeHtml(right.name)} (${right.pages} pages)</p><p>${rows.length} changed text lines (line-by-line comparison).</p><table><thead><tr><th>Line</th><th>${escapeHtml(left.name)}</th><th>${escapeHtml(right.name)}</th></tr></thead><tbody>${rows.map((r) => `<tr class="changed"><td>${r.line}</td><td>${escapeHtml(r.left)}</td><td>${escapeHtml(r.right)}</td></tr>`).join("")}</tbody></table></body></html>`;
    return {
      bytes: new Blob([html], { type: "text/html;charset=utf-8" }),
      name: "pdf-comparison.html",
    };
  }
  const doc = await PDFDocument.load(await file.arrayBuffer());
  if (tool === "Flatten PDF") {
    const form = doc.getForm();
    if (form.getFields().length) form.flatten();
  } else if (tool === "Remove metadata") {
    const infoRef = doc.context.trailerInfo.Info;
    if (infoRef) {
      const info = doc.context.lookup(infoRef, PDFDict);
      for (const key of [
        "Title",
        "Author",
        "Subject",
        "Keywords",
        "Creator",
        "Producer",
        "CreationDate",
        "ModDate",
        "Trapped",
      ])
        info.delete(PDFName.of(key));
    }
    const metadataRef = doc.catalog.get(PDFName.of("Metadata"));
    if (metadataRef) {
      doc.context.delete(metadataRef);
      doc.catalog.delete(PDFName.of("Metadata"));
    }
  } else if (tool === "Edit metadata") {
    doc.setTitle(options.title || "");
    doc.setAuthor(options.author || "");
    doc.setSubject(options.subject || "");
    doc.setKeywords(
      String(options.keywords || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } else throw new Error(`Unknown optimize operation: ${tool}`);
  return {
    bytes: await doc.save(),
    name: `${file.name.replace(/\.pdf$/i, "")}_${tool.toLowerCase().replaceAll(" ", "-")}.pdf`,
  };
}
