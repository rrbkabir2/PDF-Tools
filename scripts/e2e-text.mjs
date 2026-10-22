import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pdf = await PDFDocument.create(),
  page = pdf.addPage([612, 792]),
  font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("First line of searchable text", {
  x: 40,
  y: 700,
  size: 15,
  font,
});
page.drawText("Second line of searchable text", {
  x: 40,
  y: 670,
  size: 15,
  font,
});
const buffer = Buffer.from(await pdf.save()),
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
const upload = (tab) =>
  tab.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles({
    name: "searchable.pdf",
    mimeType: "application/pdf",
    buffer,
  });
try {
  const tab = await browser.newPage();
  await tab.goto("http://127.0.0.1:3001");
  await tab.getByRole("button", { name: /Extract text/ }).click();
  await upload(tab);
  const wait = tab.waitForEvent("download");
  await tab.getByRole("button", { name: /Process PDF/ }).click();
  const download = await wait,
    dest = path.join(os.tmpdir(), "paperplane-extracted-e2e.txt");
  await download.saveAs(dest);
  const extracted = await fs.readFile(dest, "utf8");

  assert.match(extracted, /First line of searchable text/);
  assert.match(extracted, /Second line of searchable text/);
  await fs.rm(dest, { force: true });
  await tab.close();

  const copyTab = await browser.newPage();
  await copyTab
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"]);
  await copyTab.goto("http://127.0.0.1:3001");
  await copyTab.getByRole("button", { name: /Copy PDF text/ }).click();
  await upload(copyTab);
  await copyTab.getByRole("button", { name: /Process PDF/ }).click();
  await copyTab.locator(".notice.success").waitFor();
  const clipboard = await copyTab.evaluate(() =>
    navigator.clipboard.readText(),
  );

  assert.match(clipboard, /First line of searchable text/);
  assert.match(clipboard, /Second line of searchable text/);
  await copyTab.close();

  const ocrTab = await browser.newPage();
  await ocrTab.goto("http://127.0.0.1:3001");
  await ocrTab.getByRole("button", { name: /OCR PDF/ }).click();
  await upload(ocrTab);
  await ocrTab.getByRole("button", { name: /Process PDF/ }).click();
  const warning = await ocrTab.locator(".notice.error").textContent();
  assert.match(warning, /ocrmypdf, tesseract, ghostscript/i);
  assert.match(warning, /install/i);
  assert.match(
    await ocrTab.locator(".dependency-note code").textContent(),
    /choco install tesseract/,
  );
  console.log(
    "Browser e2e passed: TXT extraction, clipboard copy, and actionable missing OCR dependency error.",
  );
} finally {
  await browser.close();
}
