# Paperplane — Local PDF Toolkit

Paperplane processes files on this computer. Browser-side tools read PDFs in the browser; tools requiring OCR, Office conversion, compression, PDF/A, repair, or encryption send the selected file only to the local worker bound to `127.0.0.1:3101`. No remote service is used.

## Start

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev` and open the Vite URL printed in the terminal (normally <http://localhost:3000>; if that port is already occupied Vite selects 3001).

## System dependencies

These are optional; the rest of the toolkit works without them. The UI checks availability and gives the install command for the affected operation.

Windows (Chocolatey commands need an Administrator terminal):

```powershell
winget install -e --id Python.Python.3.11
choco install tesseract
choco install ghostscript
python -m pip install ocrmypdf
choco install qpdf
winget install -e --id TheDocumentFoundation.LibreOffice
```

Install the programs needed for your chosen tools, open a fresh terminal, and restart Paperplane. OCRmyPDF uses Python, Tesseract, and Ghostscript. Compression and PDF/A use Ghostscript. Repair, password protection, and unlocking use qpdf. Office and HTML conversion use LibreOffice. The worker detects executables through PATH.

## Implemented tools

The home page includes searchable tool cards and category tabs. Page-based tools show PDF.js previews with lazy thumbnail rendering, click/drag selection, synchronized page ranges, select all/clear all, page counts, and an enlarge preview.

- **Organize:** merge (per-file page ranges and file ordering), create from selected pages, split by ranges/page count/top-level bookmarks, delete, extract, rotate, reorder, page numbers/headers/footers, text/image watermark, crop, resize.
- **Edit:** add text and images, replace a matching text item by rasterizing the selected page, fill and flatten AcroForms, draw/type/image signatures, highlight/underline/strikeout/rectangle/comment/text/freehand annotations, redact, whiteout. Redaction rasterizes all pages to remove the underlying text and graphics.
- **Text & OCR:** extract text to TXT, copy all/one-page text, OCR searchable PDF plus TXT sidecar in a ZIP. OCR requires the dependencies above.
- **Images:** extract embedded images to ZIP, PDF pages to PNG/JPG ZIP, PNG/JPG to PDF, crop a page area to PNG/JPG.
- **Convert:** PDF to DOCX, XLSX, PPTX, HTML, PDF/A; Office and HTML to PDF; TXT to PDF. Office/HTML/PDF-A operations require LibreOffice/Ghostscript.
- **Optimize & Secure:** Ghostscript compression with before/after byte counts, qpdf repair/protect/unlock, flatten forms, remove/edit metadata, compare extractable text as an HTML line-by-line report. Compression and qpdf operations require the dependencies above.

Browser-side conversions preserve different amounts of source layout: PDF-to-PowerPoint renders each page as an image; PDF-to-Word/Excel/HTML extract selectable text and rebuild it in the target format. They do not promise editable, layout-identical reconstruction. Compare reports compare extracted text lines, not visual page pixels. Redaction is destructive and rasterized.

## Tests

```powershell
npm run build
npm run test:organize
npm run test:edit
npm run test:e2e:edit
npm run test:e2e:text
npm run test:e2e:images
npm run test:e2e:convert
npm run test:optimize
npm run test:e2e:optimize
npm run test:e2e:pages
```

The end-to-end tests use synthetic local PDFs and a locally installed Chrome browser. Dependency-dependent operations are verified for clear missing-program guidance when those programs are not installed; successful Ghostscript, LibreOffice, qpdf, and OCR execution requires installing the optional dependencies first.
