import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const makePdf = async (text) => {
  const d = await PDFDocument.create();
  d.addPage().drawText(text);
  return Buffer.from(await d.save());
};
const first = {
  name: "source.pdf",
  mimeType: "application/pdf",
  buffer: await makePdf("Original text"),
};
const second = {
  name: "changed.pdf",
  mimeType: "application/pdf",
  buffer: await makePdf("Changed text"),
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
async function tabFor(tool, inputs = [first]) {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3001");
  await page.getByRole("button", { name: new RegExp(tool) }).click();
  await page.locator("input[type=file]").first().setInputFiles(inputs);
  return page;
}
async function download(page, name) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: /Process PDF/ }).click();
  const dl = await event;
  const file = path.join(os.tmpdir(), name);
  await dl.saveAs(file);
  return { file, bytes: await fs.readFile(file) };
}
try {
  for (const [tool, expected] of [
    ["Flatten PDF", "flatten"],
    ["Remove metadata", "remove-metadata"],
    ["Edit metadata", "edit-metadata"],
  ]) {
    const page = await tabFor(tool);
    if (tool === "Edit metadata")
      await page.getByLabel("Title").fill("Updated title");
    const out = await download(page, `paperplane-${expected}.pdf`);
    const parsed = await PDFDocument.load(out.bytes);
    assert.equal(parsed.getPageCount(), 1);
    if (tool === "Remove metadata") assert.equal(parsed.getTitle(), undefined);
    if (tool === "Edit metadata")
      assert.equal(parsed.getTitle(), "Updated title");
    await fs.rm(out.file, { force: true });
    await page.close();
  }
  const compare = await tabFor("Compare PDFs", [first, second]);
  const report = await download(compare, "paperplane-compare.html");
  assert.match(report.bytes.toString(), /Original text/);
  assert.match(report.bytes.toString(), /Changed text/);
  await fs.rm(report.file, { force: true });
  await compare.close();
  for (const tool of [
    "Compress PDF",
    "Repair PDF",
    "Protect PDF",
    "Unlock PDF",
  ]) {
    const page = await tabFor(tool);
    const notice = page.locator(".dependency-note");
    await notice.waitFor();
    assert.match(
      await notice.textContent(),
      /choco install (ghostscript|qpdf)/i,
    );
    await page.getByRole("button", { name: /Process PDF/ }).click();
    assert.match(
      await page.locator(".notice.error").textContent(),
      /missing|install/i,
    );
    await page.close();
  }
  const status = await fetch("http://127.0.0.1:3101/api/dependencies").then(
    (r) => r.json(),
  );
  assert.equal(status.ghostscript, false);
  assert.equal(status.qpdf, false);
  console.log(
    "Optimize & Secure browser e2e passed: flatten, remove/edit metadata, compare report, and explicit Ghostscript/qpdf dependency guidance.",
  );
} finally {
  await browser.close();
}
