import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright";
import JSZip from "jszip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const paint = (format) => {
  const c = createCanvas(20, 12),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#e44b53";
  ctx.fillRect(0, 0, 20, 12);
  return c.toBuffer(format);
};
const png = paint("image/png"),
  jpg = paint("image/jpeg"),
  pdf = await PDFDocument.create(),
  page = pdf.addPage([612, 792]),
  font = await pdf.embedFont(StandardFonts.Helvetica),
  embedded = await pdf.embedPng(png);
page.drawText("Image export fixture", { x: 30, y: 740, font, size: 18 });
page.drawImage(embedded, { x: 50, y: 500, width: 200, height: 120 });
pdf.addPage([300, 400]);
const pdfBuffer = Buffer.from(await pdf.save()),
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
const fixture = {
  name: "images.pdf",
  mimeType: "application/pdf",
  buffer: pdfBuffer,
};
async function toolPage(tool, files) {
  const tab = await browser.newPage();
  await tab.goto("http://127.0.0.1:3001");
  await tab.getByRole("button", { name: new RegExp(tool) }).click();
  await tab.locator("input[type=file]").first().setInputFiles(files);
  return tab;
}
async function downloaded(tab, name) {
  const wait = tab.waitForEvent("download", { timeout: 10000 });
  await tab.getByRole("button", { name: /Process PDF/ }).click();
  let dl;
  try {
    dl = await wait;
  } catch {
    throw new Error(
      `Tool failed: ${await tab
        .locator(".notice.error")
        .textContent()
        .catch(() => "no app error")}`,
    );
  }
  const dest = path.join(os.tmpdir(), name);
  await dl.saveAs(dest);
  return { dest, data: await fs.readFile(dest) };
}
try {
  const exportTab = await toolPage("PDF pages to images", fixture),
    exp = await downloaded(exportTab, "paperplane-pages-e2e.zip"),
    archive = await JSZip.loadAsync(exp.data),
    pngs = Object.values(archive.files).filter((f) => f.name.endsWith(".png"));
  assert.equal(pngs.length, 2);
  const rendered = await loadImage(
    Buffer.from(await pngs[0].async("nodebuffer")),
  );
  assert.equal(rendered.width, 918);
  assert.equal(rendered.height, 1188);
  await fs.rm(exp.dest, { force: true });
  await exportTab.close();

  const cropTab = await toolPage("Crop page to image", fixture);
  const cropInputs = cropTab.locator(".options input[type=number]");
  await cropInputs.nth(0).fill("1");
  await cropInputs.nth(1).fill("10");
  await cropInputs.nth(2).fill("20");
  await cropInputs.nth(3).fill("100");
  await cropInputs.nth(4).fill("50");
  const cropped = await downloaded(cropTab, "paperplane-crop-e2e.zip"),
    cropZip = await JSZip.loadAsync(cropped.data),
    cropImg = await loadImage(
      Buffer.from(await Object.values(cropZip.files)[0].async("nodebuffer")),
    );
  assert.equal(cropImg.width, 150);
  assert.equal(cropImg.height, 75);
  await fs.rm(cropped.dest, { force: true });
  await cropTab.close();

  const imageTab = await toolPage("Image to PDF", [
      { name: "red.png", mimeType: "image/png", buffer: png },
      { name: "red.jpg", mimeType: "image/jpeg", buffer: jpg },
    ]),
    imagePdf = await downloaded(imageTab, "paperplane-images-e2e.pdf"),
    parsed = await PDFDocument.load(imagePdf.data);
  assert.equal(parsed.getPageCount(), 2);
  await fs.rm(imagePdf.dest, { force: true });
  await imageTab.close();

  const extractTab = await toolPage("Extract images", fixture);
  const extract = await downloaded(
    extractTab,
    "paperplane-extracted-images-e2e.zip",
  );
  const extractZip = await JSZip.loadAsync(extract.data);
  assert.equal(
    Object.values(extractZip.files).filter((f) => f.name.endsWith(".png"))
      .length,
    1,
  );
  await fs.rm(extract.dest, { force: true });
  await extractTab.close();
  console.log(
    "Browser e2e passed: PDF pages to PNG, cropped page image dimensions, PNG/JPG to PDF, embedded image extraction.",
  );
} finally {
  await browser.close();
}
