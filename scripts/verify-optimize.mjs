import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { processOptimize } from "../src/pdf/optimize.js";

const make = async (text, title = "Secret title") => {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("Secret author");
  doc.addPage().drawText(text);
  return new File([await doc.save()], `${text.replace(/\W/g, "")}.pdf`, {
    type: "application/pdf",
  });
};
const first = await make("original words");
const second = await make("changed words");
const removed = await processOptimize("Remove metadata", [first]);
const clean = await PDFDocument.load(removed.bytes);
assert.equal(clean.getTitle(), undefined);
assert.equal(clean.getAuthor(), undefined);
const updated = await processOptimize("Edit metadata", [first], {
  title: "Updated",
  author: "Editor",
  subject: "Test",
  keywords: "one, two",
});
const edited = await PDFDocument.load(updated.bytes);
assert.equal(edited.getTitle(), "Updated");
assert.equal(edited.getAuthor(), "Editor");
const flattened = await processOptimize("Flatten PDF", [first]);
assert.equal((await PDFDocument.load(flattened.bytes)).getPageCount(), 1);
const comparison = await processOptimize("Compare PDFs", [first, second]);
assert.match(await comparison.bytes.text(), /changed text lines/);
await assert.rejects(
  () => processOptimize("Compare PDFs", [first]),
  /exactly two/,
);
console.log(
  "Optimize operations passed: flatten, metadata removal/edit, compare, validation.",
);
