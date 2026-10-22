import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sample = await PDFDocument.create(),
  page = sample.addPage([612, 792]),
  font = await sample.embedFont(StandardFonts.Helvetica);
page.drawText("SECRET TEXT", { x: 50, y: 700, size: 20, font });
page.drawText("VISIBLE TEXT", { x: 50, y: 600, size: 20, font });
const sampleBytes = await sample.save(),
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
try {
  for (const tool of ["Redact PDF", "Whiteout PDF", "Edit PDF"]) {
    const tab = await browser.newPage(),
      errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await tab.goto("http://127.0.0.1:3001");
    await tab.getByRole("button", { name: new RegExp(tool) }).click();
    await tab
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles({
        name: "sample.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(sampleBytes),
      });
    const nums = tab.locator(".editor-options input[type=number]");
    if (tool !== "Edit PDF") {
      await nums.nth(0).fill("1");
      await nums.nth(1).fill("40");
      await nums.nth(2).fill("680");
      await nums.nth(3).fill("170");
      await nums.nth(4).fill("42");
    } else {
      const textInputs = tab.locator(
        ".editor-options input:not([type=number]):not([type=color])",
      );
      await textInputs.nth(0).fill("SECRET TEXT");
      await textInputs.nth(1).fill("REPLACED TEXT");
      await nums.nth(0).fill("1");
    }
    const downloadWait = tab.waitForEvent("download", { timeout: 15000 });
    await tab.getByRole("button", { name: /Process PDF/ }).click();
    let download;
    try {
      download = await downloadWait;
    } catch {
      throw new Error(
        `${tool}: no download. App error: ${await tab
          .locator(".notice.error")
          .textContent()
          .catch(() => "none")}; browser errors: ${errors.join("; ")}`,
      );
    }
    const dest = path.join(
      os.tmpdir(),
      `paperplane-${tool.toLowerCase().replaceAll(" ", "-")}-e2e.pdf`,
    );
    await download.saveAs(dest);
    const result = await fs.readFile(dest),
      parsed = await PDFDocument.load(result);
    assert.equal(parsed.getPageCount(), 1);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
      loaded = await pdfjs.getDocument({
        data: new Uint8Array(result),
        isEvalSupported: false,
      }).promise;
    const extracted = await (await loaded.getPage(1)).getTextContent();
    assert.equal(
      extracted.items.filter((item) => item.str).length,
      0,
      `${tool} output must not retain extractable source text`,
    );
    if (tool !== "Edit PDF") {
      const pixel = await tab.evaluate(
        async ({ b64, x, y }) => {
          const pdfjs =
            await import("/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
          pdfjs.GlobalWorkerOptions.workerSrc =
            "/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs";
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const doc = await pdfjs.getDocument({
            data: bytes,
            isEvalSupported: false,
          }).promise;
          const pg = await doc.getPage(1),
            viewport = pg.getViewport({ scale: 1.5 }),
            canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await pg.render({
            canvas,
            canvasContext: canvas.getContext("2d"),
            viewport,
          }).promise;
          return [
            ...canvas.getContext("2d").getImageData(x, y, 1, 1).data,
          ].slice(0, 3);
        },
        { b64: Buffer.from(result).toString("base64"), x: 180, y: 136 },
      );
      assert.deepEqual(
        pixel,
        tool === "Redact PDF" ? [0, 0, 0] : [255, 255, 255],
        `${tool} area color is burned into the raster page`,
      );
    }
    assert.equal(errors.length, 0, `browser errors: ${errors.join("; ")}`);
    await fs.rm(dest, { force: true });
    await tab.close();
    console.log(
      `Browser end-to-end ${tool} passed: output opens and source text is no longer extractable.`,
    );
  }
} finally {
  await browser.close();
}
