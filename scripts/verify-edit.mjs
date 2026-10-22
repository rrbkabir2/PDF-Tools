import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { processEdit, readFormFields } from '../src/pdf/edit.js';

const source = await PDFDocument.create();
source.addPage([612, 792]).drawText('Sample', { x: 50, y: 700 });
source.addPage([612, 792]);
const bytes = await source.save();
const file = { name: 'sample.pdf', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
const check = async (tool, opts = {}) => {
  const result = await processEdit(tool, file, opts);
  assert.equal((await PDFDocument.load(result)).getPageCount(), 2, tool);
};

await check('Edit PDF', { text: 'New content', page: 1, x: 50, y: 600, font: 'HelveticaBold', fontSize: 14, color: '#2844aa' });
for (const annotation of ['highlight', 'underline', 'strikeout', 'rectangle', 'comment', 'text', 'freehand']) {
  await check('Annotate PDF', { annotation, text: 'review', points: [{ x: 10, y: 10 }, { x: 30, y: 40 }], page: 1 });
}
await check('Add signature', { text: 'A. Example', page: 2 });
await check('Add signature', { points: [{ x: 30, y: 30 }, { x: 40, y: 42 }, { x: 55, y: 35 }], page: 1 });
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII='), c => c.charCodeAt(0));
await check('Add signature', { image: { name: 'sign.png', type: 'image/png', arrayBuffer: async () => png.buffer }, page: 1 });
const formPdf = await PDFDocument.create(), formPage = formPdf.addPage([612, 792]), form = formPdf.getForm();
const textField = form.createTextField('person.name'); textField.addToPage(formPage, { x: 40, y: 700, width: 200, height: 24 });
const checkbox = form.createCheckBox('person.accepted'); checkbox.addToPage(formPage, { x: 40, y: 650, width: 16, height: 16 });
const formBytes = await formPdf.save(), formFile = { name: 'form.pdf', arrayBuffer: async () => formBytes.buffer.slice(formBytes.byteOffset, formBytes.byteOffset + formBytes.byteLength) };
assert.equal((await readFormFields(formFile)).length, 2);
const filledBytes = await processEdit('Fill forms', formFile, { fields: { 'person.name': 'Ada Example', 'person.accepted': 'true' } });
assert.equal((await PDFDocument.load(filledBytes)).getForm().getFields().length, 0, 'form is flattened after filling');
for (const tool of ['Redact PDF', 'Whiteout PDF']) {
  await assert.rejects(() => processEdit(tool, file, { page: 1, x: 40, y: 40, width: 0, height: 20 }));
}
await assert.rejects(() => processEdit('Edit PDF', file, { find: 'missing', replacement: 'replacement' }), /document|canvas|DOM/i);
console.log('Edit PDF verification passed: text overlay, seven annotation types, typed/image signature, interactive field fill and flatten, and invalid geometry.');
