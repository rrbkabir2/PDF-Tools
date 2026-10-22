import { openPdf } from "./pdfjs.js";

export async function extractPdfText(file, onlyPage = null) {
  const pdf = await openPdf(file),
    pages = onlyPage
      ? [Number(onlyPage)]
      : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const parts = [];
  for (const n of pages) {
    if (!Number.isInteger(n) || n < 1 || n > pdf.numPages)
      throw new Error(`Page number must be between 1 and ${pdf.numPages}.`);
    const content = await (await pdf.getPage(n)).getTextContent();
    const items = content.items.filter((item) => "str" in item),
      rows = [];
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push(item);
    }
    const text = rows
      .sort((a, b) => b.y - a.y)
      .map((row) =>
        row.items
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((item) => item.str)
          .join(" "),
      )
      .join("\n");
    parts.push(pages.length > 1 ? `--- Page ${n} ---\n${text}` : text);
  }
  return parts.join("\n\n");
}
