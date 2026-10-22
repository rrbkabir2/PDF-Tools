import { Document, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import pptxgen from "pptxgenjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { openPdf } from "./pdfjs.js";
import { extractPdfText } from "./text.js";

export async function convertPdf(tool, file) {
  if (tool === "PDF to Word") {
    const pages = (await extractPdfText(file))
      .split(/--- Page \d+ ---/)
      .filter((t) => t.trim());
    const children = [];
    pages.forEach((text, i) => {
      if (i)
        children.push(
          new Paragraph({ children: [new TextRun({ text: "", break: 1 })] }),
        );
      for (const line of text.trim().split(/\r?\n/))
        children.push(new Paragraph({ children: [new TextRun(line)] }));
    });
    return Packer.toBlob(new Document({ sections: [{ children }] }));
  }
  if (tool === "PDF to Excel") {
    const book = new ExcelJS.Workbook(),
      pdf = await openPdf(file);
    for (let n = 1; n <= pdf.numPages; n++) {
      const sheet = book.addWorksheet(`Page ${n}`),
        text = await extractPdfText(file, n);
      for (const line of text.split(/\r?\n/).filter(Boolean))
        sheet.addRow([line]);
    }
    return new Blob([await book.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
  if (tool === "PDF to PowerPoint") {
    const pptx = new pptxgen(),
      pdf = await openPdf(file);
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Paperplane local PDF toolkit";
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n),
        viewport = page.getViewport({ scale: 1.5 }),
        canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({
        canvas,
        canvasContext: canvas.getContext("2d"),
        viewport,
        background: "#fff",
      }).promise;
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };
      slide.addImage({
        data: canvas.toDataURL("image/png"),
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5,
      });
    }
    return new Blob([await pptx.write({ outputType: "arraybuffer" })], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  }
  if (tool === "PDF to HTML") {
    const text = await extractPdfText(file),
      pages = text.split(/--- Page (\d+) ---/);
    let html =
      '<!doctype html><html><head><meta charset="utf-8"><title>Converted PDF</title><style>body{font:16px/1.5 Arial,sans-serif;max-width:850px;margin:40px auto}section{white-space:pre-wrap;page-break-after:always}</style></head><body>';
    if (pages.length === 1) html += `<section>${escapeHtml(text)}</section>`;
    else
      for (let i = 1; i < pages.length; i += 2)
        html += `<section><h2>Page ${escapeHtml(pages[i])}</h2>${escapeHtml(pages[i + 1] || "")}</section>`;
    return new Blob([html + "</body></html>"], {
      type: "text/html;charset=utf-8",
    });
  }
  throw new Error(`Unknown conversion: ${tool}`);
}

export async function textToPdf(file) {
  const text = await file.text(),
    doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica),
    size = 11,
    margin = 48,
    leading = 15,
    pageWidth = 612,
    pageHeight = 792;
  let page = doc.addPage([pageWidth, pageHeight]),
    y = pageHeight - margin;
  for (const raw of text.replaceAll("\r\n", "\n").split("\n")) {
    const words = raw.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= pageWidth - margin * 2)
        line = candidate;
      else {
        page.drawText(line, { x: margin, y, size, font });
        y -= leading;
        line = word;
      }
      if (y < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
    }
    page.drawText(line, { x: margin, y, size, font });
    y -= leading;
    if (y < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  }
  return doc.save();
}

export function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
