import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { processOrganize } from "../src/pdf/organize.js";

const fixture = async (name, widths) => {
  const doc = await PDFDocument.create();
  widths.forEach((width, i) => doc.addPage([width, 700 + i]));
  const bytes = await doc.save();
  return {
    name,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
};
const fileA = await fixture("alpha.pdf", [400, 500, 600]);
const fileB = await fixture("beta.pdf", [700, 800]);
const bookmarkedDoc = await PDFDocument.create(),
  markedPages = [300, 400, 500].map((w) => bookmarkedDoc.addPage([w, 700]));
const context = bookmarkedDoc.context,
  rootRef = context.nextRef(),
  firstRef = context.nextRef(),
  secondRef = context.nextRef();
context.assign(
  rootRef,
  context.obj({
    Type: PDFName.of("Outlines"),
    First: firstRef,
    Last: secondRef,
    Count: 2,
  }),
);
context.assign(
  firstRef,
  context.obj({
    Title: PDFString.of("Part One"),
    Parent: rootRef,
    Next: secondRef,
    Dest: context.obj([markedPages[0].ref, PDFName.of("Fit")]),
  }),
);
context.assign(
  secondRef,
  context.obj({
    Title: PDFString.of("Part Two"),
    Parent: rootRef,
    Prev: firstRef,
    Dest: context.obj([markedPages[2].ref, PDFName.of("Fit")]),
  }),
);
bookmarkedDoc.catalog.set(PDFName.of("Outlines"), rootRef);
const bookmarkBytes = await bookmarkedDoc.save();
const bookmarked = {
  name: "bookmarked.pdf",
  arrayBuffer: async () =>
    bookmarkBytes.buffer.slice(
      bookmarkBytes.byteOffset,
      bookmarkBytes.byteOffset + bookmarkBytes.byteLength,
    ),
};
const read = async (result) => PDFDocument.load(result.bytes);
const checkPages = async (tool, files, options, counts) => {
  const outputs = await processOrganize(tool, files, options);
  assert.deepEqual(
    await Promise.all(outputs.map(async (r) => (await read(r)).getPageCount())),
    counts,
    `${tool} page counts`,
  );
  return outputs;
};

await checkPages("Merge PDFs", [fileA, fileB], {}, [5]);
await checkPages(
  "Merge PDFs",
  [fileA, fileB],
  { ranges: ["2, 1", "1-2"] },
  [4],
);
await checkPages(
  "Create from pages",
  [fileA, fileB],
  { ranges: ["1,3", "1"] },
  [3],
);
await checkPages("Split PDF", [fileA], { splitN: 2 }, [2, 1]);
await checkPages(
  "Split PDF",
  [fileA],
  { splitMode: "range", range: "2-3" },
  [2],
);
await checkPages("Split PDF", [bookmarked], { splitMode: "bookmarks" }, [2, 1]);
await checkPages("Delete pages", [fileA], { range: "2" }, [2]);
await checkPages("Extract pages", [fileA], { range: "1,3" }, [2]);
const rotated = await read(
  (
    await checkPages("Rotate pages", [fileA], { angle: 90, range: "2" }, [3])
  )[0],
);
assert.equal(rotated.getPages()[1].getRotation().angle, 90);
const reordered = await read(
  (await checkPages("Reorder pages", [fileA], { order: "3,1,2" }, [3]))[0],
);
assert.equal(reordered.getPages()[0].getWidth(), 600);
await checkPages(
  "Page numbers, headers & footers",
  [fileA],
  { text: "Page {page} of {pages}" },
  [3],
);
await checkPages("Watermark", [fileA], { text: "PRIVATE" }, [3]);
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const image = {
  name: "mark.png",
  type: "image/png",
  arrayBuffer: async () => png.buffer,
};
await checkPages("Watermark", [fileA], { image }, [3]);
const cropped = await read(
  (await checkPages("Crop PDF", [fileA], { margin: 20 }, [3]))[0],
);
assert.equal(cropped.getPages()[0].getCropBox().width, 360);
const resized = await read(
  (
    await checkPages("Resize pages", [fileA], { width: 612, height: 792 }, [3])
  )[0],
);
assert.deepEqual(
  [resized.getPages()[0].getWidth(), resized.getPages()[0].getHeight()],
  [612, 792],
);
for (const [tool, options] of [
  ["Delete pages", {}],
  ["Reorder pages", { order: "1,1,2" }],
  ["Split PDF", { splitN: 0 }],
]) {
  await assert.rejects(() => processOrganize(tool, [fileA], options));
}
console.log(
  "Organize PDF verification passed: 11 operations, ranges, ordering, rotation, crop, resize, watermark, split outputs, and invalid inputs.",
);
