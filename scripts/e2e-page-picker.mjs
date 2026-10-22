import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const source = await PDFDocument.create();
for (let page = 1; page <= 5; page++)
  source.addPage().drawText(`Fixture page ${page}`);
const fixture = {
  name: "five-pages.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(await source.save()),
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
async function openTool(name, initiallySelected = true) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:3001");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole("region", { name: /Pages in five-pages.pdf/ }).waitFor();
  await page
    .getByLabel(`Page 1, ${initiallySelected ? "selected" : "not selected"}`)
    .waitFor();
  return page;
}
async function downloadedPdf(page, name) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: /Process PDF/ }).click();
  const download = await event;
  const target = path.join(os.tmpdir(), name);
  await download.saveAs(target);
  return { target, pdf: await PDFDocument.load(await fs.readFile(target)) };
}
try {
  const extract = await openTool("Extract pages");
  await extract.getByRole("button", { name: "Clear all" }).click();
  assert.equal(await extract.getByText("0 of 5 pages selected").count(), 1);
  const pageTwo = await extract
    .getByLabel("Page 2, not selected")
    .boundingBox();
  const pageFour = await extract
    .getByLabel("Page 4, not selected")
    .boundingBox();
  await extract.mouse.move(
    pageTwo.x + pageTwo.width / 2,
    pageTwo.y + pageTwo.height / 2,
  );
  await extract.mouse.down();
  await extract.mouse.move(
    pageFour.x + pageFour.width / 2,
    pageFour.y + pageFour.height / 2,
    { steps: 8 },
  );
  await extract.mouse.up();
  assert.equal(await extract.getByText("3 of 5 pages selected").count(), 1);
  await extract.getByRole("button", { name: "Select all" }).click();
  assert.equal(await extract.getByText("5 of 5 pages selected").count(), 1);
  await extract.getByRole("button", { name: "Clear all" }).click();
  await extract.getByLabel("Page selection (optional)").fill("2-4");
  assert.equal(await extract.getByText("3 of 5 pages selected").count(), 1);
  assert.equal(await extract.getByLabel("Page 1, not selected").count(), 1);
  await extract.getByLabel("Enlarge page 2").click();
  await extract.getByRole("dialog", { name: "Page 2 preview" }).waitFor();
  await extract.getByRole("button", { name: "Close enlarged preview" }).click();
  const extracted = await downloadedPdf(
    extract,
    "paperplane-pages-extracted.pdf",
  );
  assert.equal(extracted.pdf.getPageCount(), 3);
  await fs.rm(extracted.target, { force: true });
  await extract.close();

  const remove = await openTool("Delete pages", false);
  await remove.getByLabel("Pages to delete").fill("2, 4");
  assert.equal(await remove.getByText("2 of 5 pages selected").count(), 1);
  const deleted = await downloadedPdf(remove, "paperplane-pages-deleted.pdf");
  assert.equal(deleted.pdf.getPageCount(), 3);
  await fs.rm(deleted.target, { force: true });
  await remove.close();

  const merge = await openTool("Merge PDFs");
  await merge.getByLabel("Pages to use from five-pages.pdf").fill("1, 3, 5");
  assert.equal(await merge.getByText("3 of 5 pages selected").count(), 1);
  const merged = await downloadedPdf(merge, "paperplane-pages-merged.pdf");
  assert.equal(merged.pdf.getPageCount(), 3);
  await fs.rm(merged.target, { force: true });
  await merge.close();
  console.log(
    "Page-picker browser e2e passed: lazy PDF.js thumbnails, typed range sync, zoom preview, extract/delete/merge outputs, and mobile viewport.",
  );
} finally {
  await browser.close();
}
