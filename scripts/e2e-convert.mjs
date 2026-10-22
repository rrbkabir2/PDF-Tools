import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pdf = await PDFDocument.create(),
  page = pdf.addPage([612, 792]),
  font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("Invoice line one", { x: 45, y: 700, size: 18, font });
page.drawText("Invoice line two", { x: 45, y: 660, size: 18, font });
const pdfBuffer = Buffer.from(await pdf.save()),
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
async function run(tool, input) {
  const tab = await browser.newPage();
  await tab.goto("http://127.0.0.1:3001");
  await tab.getByRole("button", { name: new RegExp(tool) }).click();
  await tab.locator("input[type=file]").first().setInputFiles(input);
  return tab;
}
async function download(tab, name) {
  const wait = tab.waitForEvent("download", { timeout: 15000 });
  await tab.getByRole("button", { name: /Process PDF/ }).click();
  let dl;
  try {
    dl = await wait;
  } catch {
    throw new Error(
      `${name} failed: ${await tab
        .locator(".notice.error")
        .textContent()
        .catch(() => "no message")}`,
    );
  }
  const dest = path.join(os.tmpdir(), name);
  await dl.saveAs(dest);
  return { dest, data: await fs.readFile(dest) };
}
const pdfFile = {
  name: "invoice.pdf",
  mimeType: "application/pdf",
  buffer: pdfBuffer,
};
try {
  const wordTab = await run("PDF to Word", pdfFile),
    word = await download(wordTab, "paperplane-e2e.docx"),
    wordZip = await JSZip.loadAsync(word.data);
  assert.ok(wordZip.file("word/document.xml"));
  assert.match(
    await wordZip.file("word/document.xml").async("text"),
    /Invoice line one/,
  );
  await fs.rm(word.dest, { force: true });
  await wordTab.close();
  const excelTab = await run("PDF to Excel", pdfFile),
    excel = await download(excelTab, "paperplane-e2e.xlsx"),
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(excel.data);
  assert.equal(wb.worksheets.length, 1);
  assert.match(wb.worksheets[0].getCell("A1").text, /Invoice line one/);
  await fs.rm(excel.dest, { force: true });
  await excelTab.close();
  const pptTab = await run("PDF to PowerPoint", pdfFile),
    ppt = await download(pptTab, "paperplane-e2e.pptx"),
    pptZip = await JSZip.loadAsync(ppt.data);
  assert.ok(pptZip.file("ppt/slides/slide1.xml"));
  assert.ok(
    Object.keys(pptZip.files).some(
      (name) => name.startsWith("ppt/media/") && name.endsWith(".png"),
    ),
  );
  await fs.rm(ppt.dest, { force: true });
  await pptTab.close();
  const htmlTab = await run("PDF to HTML", pdfFile),
    html = await download(htmlTab, "paperplane-e2e.html");
  assert.match(html.data.toString(), /Invoice line one/);
  await fs.rm(html.dest, { force: true });
  await htmlTab.close();
  const textTab = await run("Text to PDF", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Local text document\nSecond line"),
  });
  const textPdf = await download(textTab, "paperplane-text.pdf"),
    parsed = await PDFDocument.load(textPdf.data);
  assert.equal(parsed.getPageCount(), 1);
  await fs.rm(textPdf.dest, { force: true });
  await textTab.close();
  for (const [tool, input, expected] of [
    [
      "Office to PDF",
      {
        name: "source.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: Buffer.from("local fixture"),
      },
      /LibreOffice/i,
    ],
    ["PDF to PDF\/A", pdfFile, /Ghostscript/i],
  ]) {
    const tab = await run(tool, input);
    await tab.getByRole("button", { name: /Process PDF/ }).click();
    const notice = await tab.locator(".notice.error").textContent();
    assert.match(notice, expected);
    assert.match(notice, /install/i);
    await tab.close();
  }
  console.log(
    "Browser e2e passed: PDF to DOCX/XLSX/PPTX/HTML, text to PDF, and actionable missing LibreOffice/Ghostscript errors.",
  );
} finally {
  await browser.close();
}
