import React, { useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { processOrganize } from "./pdf/organize.js";
import { processEdit, readFormFields } from "./pdf/edit.js";
import { extractPdfText } from "./pdf/text.js";
import {
  pdfPagesToImages,
  imagesToPdf,
  extractEmbeddedImages,
} from "./pdf/images.js";
import { convertPdf, textToPdf } from "./pdf/convert.js";
import { processOptimize } from "./pdf/optimize.js";
import PdfPagePicker from "./components/PdfPagePicker.jsx";
import {
  Search,
  Sun,
  Moon,
  ShieldCheck,
  ArrowUpRight,
  Files,
  Scissors,
  PenLine,
  ScanText,
  Image,
  RefreshCw,
  LockKeyhole,
  CloudOff,
  ArrowLeft,
  Upload,
  Check,
  Menu,
  X,
  FileText,
  Layers,
  RotateCw,
  Hash,
  Stamp,
  Crop,
  FileOutput,
  FileInput,
  Minimize2,
  Wrench,
  KeyRound,
  GitCompare,
  Type,
  Signature,
  Highlighter,
  Shapes,
  Eye,
  Trash2,
  MoveUp,
  MoveDown,
} from "lucide-react";

const groups = [
  {
    name: "Organize PDF",
    icon: Layers,
    color: "violet",
    items: [
      ["Merge PDFs", "Combine files and optional page ranges", Files],
      ["Create from pages", "Pick pages across multiple PDFs", FileInput],
      ["Split PDF", "Split by range or every N pages", Scissors],
      ["Delete pages", "Remove pages by number or range", Trash2],
      ["Extract pages", "Save selected pages as a new PDF", FileOutput],
      ["Rotate pages", "Rotate all or selected pages", RotateCw],
      ["Reorder pages", "Set a custom page order", Layers],
      [
        "Page numbers, headers & footers",
        "Add running text to each page",
        Hash,
      ],
      ["Watermark", "Stamp text on every page", Stamp],
      ["Crop PDF", "Trim page margins", Crop],
      ["Resize pages", "Change page dimensions", FileText],
    ],
  },
  {
    name: "Edit PDF",
    icon: PenLine,
    color: "blue",
    items: [
      ["Edit PDF", "Add text, images and annotations", PenLine],
      ["Fill forms", "Fill interactive form fields", FileText],
      ["Add signature", "Draw, type or place a signature", Signature],
      ["Annotate PDF", "Highlight, draw and comment", Highlighter],
      ["Redact PDF", "Permanently remove selected content", Eye],
      ["Whiteout PDF", "Cover an area on a page", Shapes],
    ],
  },
  {
    name: "Text & OCR",
    icon: ScanText,
    color: "green",
    items: [
      ["Extract text", "Save document text to TXT", Type],
      ["OCR PDF", "Make scanned pages searchable", ScanText],
      ["Copy PDF text", "Copy text from a document", FileText],
    ],
  },
  {
    name: "Images",
    icon: Image,
    color: "amber",
    items: [
      ["Extract images", "Save embedded images from a PDF", Image],
      ["PDF pages to images", "Export pages as PNG or JPG", Image],
      ["Image to PDF", "Create a PDF from images", FileInput],
      ["Crop page to image", "Export a selected page area", Crop],
    ],
  },
  {
    name: "Convert",
    icon: RefreshCw,
    color: "orange",
    items: [
      ["PDF to Word", "Convert PDF pages to DOCX", FileOutput],
      ["PDF to Excel", "Extract tables to XLSX", FileOutput],
      ["PDF to PowerPoint", "Create a PPTX from pages", FileOutput],
      ["PDF to HTML", "Export as HTML", FileOutput],
      ["PDF to PDF/A", "Create an archival PDF", FileOutput],
      ["Office to PDF", "Convert Office documents to PDF", FileInput],
      ["HTML to PDF", "Print a local HTML file to PDF", FileInput],
      ["Text to PDF", "Create a PDF from a text file", FileInput],
    ],
  },
  {
    name: "Optimize & Secure",
    icon: LockKeyhole,
    color: "rose",
    items: [
      ["Compress PDF", "Reduce PDF file size", Minimize2],
      ["Repair PDF", "Try to recover damaged files", Wrench],
      ["Protect PDF", "Encrypt with a password", KeyRound],
      ["Unlock PDF", "Remove password protection", KeyRound],
      ["Flatten PDF", "Flatten form fields and annotations", Layers],
      ["Remove metadata", "Clear document properties", FileText],
      ["Edit metadata", "Update document properties", FileText],
      ["Compare PDFs", "Compare two documents", GitCompare],
    ],
  },
];
const READY = new Set([
  "Merge PDFs",
  "Create from pages",
  "Split PDF",
  "Delete pages",
  "Extract pages",
  "Rotate pages",
  "Reorder pages",
  "Page numbers, headers & footers",
  "Watermark",
  "Crop PDF",
  "Resize pages",
  "Edit PDF",
  "Fill forms",
  "Add signature",
  "Annotate PDF",
  "Redact PDF",
  "Whiteout PDF",
  "Extract text",
  "Copy PDF text",
  "OCR PDF",
  "Extract images",
  "PDF pages to images",
  "Image to PDF",
  "Crop page to image",
  "PDF to Word",
  "PDF to Excel",
  "PDF to PowerPoint",
  "PDF to HTML",
  "PDF to PDF/A",
  "Office to PDF",
  "HTML to PDF",
  "Text to PDF",
  "Compress PDF",
  "Repair PDF",
  "Protect PDF",
  "Unlock PDF",
  "Flatten PDF",
  "Remove metadata",
  "Edit metadata",
  "Compare PDFs",
]);
const parsePages = (raw, count) => {
  if (!raw.trim()) return Array.from({ length: count }, (_, i) => i);
  const out = new Set();
  for (const part of raw.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*[-:]\s*(\d+))?$/);
    if (!m) throw Error("Enter pages like 1, 3-5.");
    const a = Number(m[1]),
      b = Number(m[2] || m[1]);
    if (a < 1 || b < a || b > count)
      throw Error(`Page range ${part.trim()} is outside 1–${count}.`);
    for (let n = a; n <= b; n++) out.add(n - 1);
  }
  return [...out].sort((a, b) => a - b);
};
const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};
const safeName = (s) => s.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_");
const SYSTEM_TOOLS = new Set([
  "PDF to PDF/A",
  "Office to PDF",
  "HTML to PDF",
  "Compress PDF",
  "Repair PDF",
  "Protect PDF",
  "Unlock PDF",
]);
const PAGE_PICKER_TOOLS = new Set([
  "Merge PDFs",
  "Create from pages",
  "Split PDF",
  "Delete pages",
  "Extract pages",
  "Rotate pages",
  "Reorder pages",
]);
const NONE_SELECTED = "__none__";
function App() {
  const [dark, setDark] = useState(false),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("All tools"),
    [active, setActive] = useState(null),
    [files, setFiles] = useState([]),
    [counts, setCounts] = useState([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false),
    [dependencies, setDependencies] = useState(null);
  const [imageFormat, setImageFormat] = useState("png"),
    [imageScale, setImageScale] = useState(1.5);
  const [compressionLevel, setCompressionLevel] = useState("medium"),
    [password, setPassword] = useState(""),
    [ownerPassword, setOwnerPassword] = useState(""),
    [metadataTitle, setMetadataTitle] = useState(""),
    [metadataAuthor, setMetadataAuthor] = useState(""),
    [metadataSubject, setMetadataSubject] = useState(""),
    [metadataKeywords, setMetadataKeywords] = useState("");
  const [sizeReport, setSizeReport] = useState(null);
  const input = useRef(null),
    imageInput = useRef(null),
    signatureCanvas = useRef(null),
    signatureDrawing = useRef(false);
  const all = useMemo(
      () =>
        groups.flatMap((g) =>
          g.items.map((i) => ({ ...i, group: g.name, color: g.color })),
        ),
      [],
    ),
    filtered = useMemo(
      () =>
        all.filter((i) =>
          (i[0] + " " + i[1] + " " + i.group)
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
      [all, query],
    );
  useEffect(() => {
    fetch("/api/dependencies")
      .then((r) => r.json())
      .then(setDependencies)
      .catch(() => setDependencies({}));
  }, []);
  const [range, setRange] = useState(""),
    [ranges, setRanges] = useState([]),
    [splitN, setSplitN] = useState(2),
    [splitMode, setSplitMode] = useState("pages"),
    [angle, setAngle] = useState(90),
    [order, setOrder] = useState(""),
    [text, setText] = useState(""),
    [fontSize, setFontSize] = useState(12),
    [position, setPosition] = useState("footer"),
    [margin, setMargin] = useState(36),
    [pageWidth, setPageWidth] = useState(612),
    [pageHeight, setPageHeight] = useState(792),
    [image, setImage] = useState(null);
  const [page, setPage] = useState(1),
    [x, setX] = useState(48),
    [y, setY] = useState(48),
    [boxWidth, setBoxWidth] = useState(160),
    [boxHeight, setBoxHeight] = useState(28),
    [font, setFont] = useState("Helvetica"),
    [colorValue, setColorValue] = useState("#252536"),
    [annotation, setAnnotation] = useState("highlight"),
    [findText, setFindText] = useState(""),
    [replacement, setReplacement] = useState(""),
    [freehandPoints, setFreehandPoints] = useState(""),
    [signaturePoints, setSignaturePoints] = useState([]),
    [textPage, setTextPage] = useState(""),
    [formFields, setFormFields] = useState([]),
    [formValues, setFormValues] = useState({});
  const reset = () => {
    setFiles([]);
    setCounts([]);
    setRange("");
    setRanges([]);
    setOrder("");
    setText("");
    setImage(null);
    setFormFields([]);
    setFormValues({});
    setFindText("");
    setReplacement("");
    setFreehandPoints("");
    setSignaturePoints([]);
    setTextPage("");
    setPassword("");
    setOwnerPassword("");
    setMetadataTitle("");
    setMetadataAuthor("");
    setMetadataSubject("");
    setMetadataKeywords("");
    setSizeReport(null);
    setMessage("");
    setError("");
  };
  const choose = (t) => {
    setActive(t);
    reset();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const addFiles = async (list) => {
    const chosen = Array.from(list || []);
    if (["Office to PDF", "HTML to PDF", "Text to PDF"].includes(active[0])) {
      const valid = chosen.every((f) =>
        active[0] === "Office to PDF"
          ? /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i.test(f.name)
          : active[0] === "HTML to PDF"
            ? /\.html?$/i.test(f.name)
            : /\.txt$/i.test(f.name),
      );
      if (!valid) {
        setError(
          active[0] === "Office to PDF"
            ? "Choose DOC, DOCX, XLS, XLSX, PPT, PPTX, ODT, ODS, ODP or RTF."
            : active[0] === "HTML to PDF"
              ? "Choose an HTML file."
              : "Choose a TXT file.",
        );
        return;
      }
      setFiles((v) => [...v, ...chosen]);
      setCounts((v) => [...v, ...chosen.map(() => 1)]);
      setError("");
      setMessage("");
      return;
    }
    if (active[0] === "Image to PDF") {
      if (chosen.some((f) => !["image/png", "image/jpeg"].includes(f.type))) {
        setError("Choose PNG or JPG images only.");
        return;
      }
      setFiles((v) => [...v, ...chosen]);
      setCounts((v) => [...v, ...chosen.map(() => 1)]);
      setError("");
      setMessage("");
      return;
    }
    if (chosen.some((f) => !f.name.toLowerCase().endsWith(".pdf"))) {
      setError("This tool accepts PDF files only.");
      return;
    }
    if (!chosen.length) return;
    try {
      const nums = await Promise.all(
        chosen.map(async (f) =>
          (
            await PDFDocument.load(await f.arrayBuffer(), {
              ignoreEncryption: false,
            })
          ).getPageCount(),
        ),
      );
      setFiles((v) => [...v, ...chosen]);
      setCounts((v) => [...v, ...nums]);
      setRanges((v) => [...v, ...nums.map(() => "")]);
      if (active[0] === "Fill forms") {
        const fields = await readFormFields(chosen[0]);
        setFormFields(fields);
        setFormValues(
          Object.fromEntries(fields.map((field) => [field.name, ""])),
        );
      }
      setError("");
      setMessage("");
    } catch (e) {
      setError("Could not open this PDF. It may be encrypted or damaged.");
    }
  };
  const selectedPages = (idx) => parsePages(range, counts[idx] || 1);
  const selectionForPicker = (idx) => {
    const tool = active[0];
    const raw =
      tool === "Merge PDFs" || tool === "Create from pages"
        ? ranges[idx] || ""
        : tool === "Reorder pages"
          ? range
          : range;
    if (raw === NONE_SELECTED) return [];
    if (!raw.trim()) {
      if (["Delete pages", "Split PDF"].includes(tool)) return [];
      return Array.from(
        { length: counts[idx] || 0 },
        (_, pageIndex) => pageIndex,
      );
    }
    try {
      return parsePages(raw, counts[idx] || 1);
    } catch {
      return [];
    }
  };
  const setPickerSelection = (idx, pages) => {
    const sorted = [...pages].sort((a, b) => a - b);
    const compact = [];
    for (let cursor = 0; cursor < sorted.length;) {
      let end = cursor;
      while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1)
        end++;
      compact.push(
        end === cursor
          ? String(sorted[cursor] + 1)
          : `${sorted[cursor] + 1}-${sorted[end] + 1}`,
      );
      cursor = end + 1;
    }
    const value = compact.join(", ") || NONE_SELECTED;
    if (active[0] === "Merge PDFs" || active[0] === "Create from pages") {
      setRanges((current) =>
        current.map((item, index) => (index === idx ? value : item)),
      );
    } else {
      setRange(value);
      if (active[0] === "Split PDF") setSplitMode("range");
      if (active[0] === "Reorder pages") {
        const rest = Array.from(
          { length: counts[idx] || 0 },
          (_, index) => index,
        ).filter((index) => !sorted.includes(index));
        setOrder([...sorted, ...rest].map((index) => index + 1).join(","));
      }
    }
  };
  const run = async () => {
    if (!files.length) return;
    if (
      (range === NONE_SELECTED && active[0] !== "Reorder pages") ||
      ranges.includes(NONE_SELECTED)
    ) {
      setError(
        "Select at least one page, or use Select all before processing.",
      );
      return;
    }
    if (!READY.has(active[0])) {
      setError("No processing handler is registered for this operation.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (["Extract text", "Copy PDF text"].includes(active[0])) {
        const extracted = await extractPdfText(files[0], textPage || null);
        if (!extracted.trim())
          throw new Error(
            "No selectable text was found. Use OCR PDF for scanned pages.",
          );
        if (active[0] === "Copy PDF text") {
          await navigator.clipboard.writeText(extracted);
          setMessage("Document text copied to the clipboard.");
        } else {
          saveBlob(
            new Blob([extracted], { type: "text/plain;charset=utf-8" }),
            `${safeName(files[0].name)}.txt`,
          );
          setMessage("Extracted text downloaded as a TXT file.");
        }
        return;
      }
      if (
        [
          "Image to PDF",
          "Extract images",
          "PDF pages to images",
          "Crop page to image",
        ].includes(active[0])
      ) {
        if (active[0] === "Image to PDF") {
          const bytes = await imagesToPdf(files);
          saveBlob(
            new Blob([bytes], { type: "application/pdf" }),
            "images.pdf",
          );
        } else if (active[0] === "Extract images") {
          saveBlob(
            await extractEmbeddedImages(files[0]),
            `${safeName(files[0].name)}_images.zip`,
          );
        } else {
          const crop =
            active[0] === "Crop page to image"
              ? { x, y, width: boxWidth, height: boxHeight }
              : null;
          const blob = await pdfPagesToImages(files[0], {
            format: imageFormat,
            scale: imageScale,
            pages: active[0] === "Crop page to image" ? String(page) : range,
            crop,
          });
          saveBlob(blob, `${safeName(files[0].name)}_images.zip`);
        }
        setMessage("Images processed locally and downloaded.");
        return;
      }
      if (active[0] === "OCR PDF") {
        const body = new FormData();
        body.append("file", files[0], files[0].name);
        const response = await fetch("/api/ocr", { method: "POST", body });
        if (!response.ok) {
          const info = await response.json();
          if (info.missing)
            throw new Error(
              `OCR cannot run because these local programs are missing: ${info.missing.join(", ")}. Install 64-bit Python, Tesseract, and Ghostscript, then run: python -m pip install ocrmypdf. Restart npm run dev after installation. Windows steps: winget install -e --id Python.Python.3.11; choco install tesseract; choco install ghostscript. Open an Administrator terminal for Chocolatey installs.`,
            );
          throw new Error(info.error || "Local OCR failed.");
        }
        saveBlob(await response.blob(), `${safeName(files[0].name)}_ocr.zip`);
        setMessage(
          "Downloaded a searchable PDF and extracted text in a ZIP file.",
        );
        return;
      }
      if (
        [
          "Edit PDF",
          "Fill forms",
          "Add signature",
          "Annotate PDF",
          "Redact PDF",
          "Whiteout PDF",
        ].includes(active[0])
      ) {
        const bytes = await processEdit(active[0], files[0], {
          page,
          x,
          y,
          width: boxWidth,
          height: boxHeight,
          font,
          fontSize,
          color: colorValue,
          text,
          find: findText,
          replacement,
          annotation,
          points:
            active[0] === "Add signature"
              ? signaturePoints
              : freehandPoints
                  .split(";")
                  .map((point) => {
                    const [px, py] = point.split(",").map(Number);
                    return { x: px, y: py };
                  })
                  .filter(
                    (point) =>
                      Number.isFinite(point.x) && Number.isFinite(point.y),
                  ),
          fields: formValues,
          image,
        });
        saveBlob(
          new Blob([bytes], { type: "application/pdf" }),
          `${safeName(files[0].name)}_${active[0].toLowerCase().replaceAll(" ", "-")}.pdf`,
        );
        setMessage("Processed locally. Your PDF download is ready.");
        return;
      }
      if (
        [
          "PDF to Word",
          "PDF to Excel",
          "PDF to PowerPoint",
          "PDF to HTML",
        ].includes(active[0])
      ) {
        const blob = await convertPdf(active[0], files[0]);
        const ext = {
          "PDF to Word": "docx",
          "PDF to Excel": "xlsx",
          "PDF to PowerPoint": "pptx",
          "PDF to HTML": "html",
        }[active[0]];
        saveBlob(blob, `${safeName(files[0].name)}.${ext}`);
        setMessage("Converted locally and downloaded.");
        return;
      }
      if (active[0] === "Text to PDF") {
        const bytes = await textToPdf(files[0]);
        saveBlob(
          new Blob([bytes], { type: "application/pdf" }),
          `${safeName(files[0].name)}.pdf`,
        );
        setMessage("Created a PDF locally and downloaded it.");
        return;
      }
      if (SYSTEM_TOOLS.has(active[0])) {
        const key = {
          "PDF to PDF/A": "pdf-to-pdfa",
          "HTML to PDF": "html-to-pdf",
          "Office to PDF": "office-to-pdf",
          "Compress PDF": "compress",
          "Repair PDF": "repair",
          "Protect PDF": "protect",
          "Unlock PDF": "unlock",
        }[active[0]];
        const body = new FormData();
        body.append("file", files[0], files[0].name);
        if (active[0] === "Compress PDF")
          body.append("level", compressionLevel);
        if (["Protect PDF", "Unlock PDF"].includes(active[0]))
          body.append("password", password);
        if (active[0] === "Protect PDF")
          body.append("ownerPassword", ownerPassword || password);
        const response = await fetch(`/api/system/${key}`, {
          method: "POST",
          body,
        });
        if (!response.ok) {
          const info = await response.json();
          throw new Error(info.error || "Local conversion failed.");
        }
        saveBlob(
          await response.blob(),
          `${safeName(files[0].name)}${active[0] === "PDF to PDF/A" ? "-pdfa" : active[0] === "Compress PDF" ? "-compressed" : `-${key}`}.pdf`,
        );
        if (active[0] === "Compress PDF")
          setSizeReport({
            before: Number(response.headers.get("X-Input-Size")),
            after: Number(response.headers.get("X-Output-Size")),
          });
        setMessage(
          active[0] === "Compress PDF"
            ? "Compressed PDF downloaded."
            : "Processed locally and downloaded.",
        );
        return;
      }
      if (
        [
          "Flatten PDF",
          "Remove metadata",
          "Edit metadata",
          "Compare PDFs",
        ].includes(active[0])
      ) {
        const result = await processOptimize(active[0], files, {
          title: metadataTitle,
          author: metadataAuthor,
          subject: metadataSubject,
          keywords: metadataKeywords,
        });
        const blob =
          result.bytes instanceof Blob
            ? result.bytes
            : new Blob([result.bytes], {
                type:
                  active[0] === "Compare PDFs"
                    ? "text/html;charset=utf-8"
                    : "application/pdf",
              });
        saveBlob(blob, result.name);
        setMessage("Processed locally and downloaded.");
        return;
      }
      const outputs = await processOrganize(active[0], files, {
        range,
        ranges,
        splitN,
        splitMode,
        angle,
        order,
        text,
        fontSize,
        position,
        margin,
        width: pageWidth,
        height: pageHeight,
        image,
      });
      for (const item of outputs)
        saveBlob(
          new Blob([item.bytes], { type: "application/pdf" }),
          item.name,
        );
      setMessage(
        outputs.length === 1
          ? "Processed locally. Your PDF download is ready."
          : "Downloaded " + outputs.length + " split PDF files.",
      );
    } catch (e) {
      setError(e.message || "Could not process this PDF.");
    } finally {
      setBusy(false);
    }
  };
  const move = (idx, delta) => {
    const fs = [...files],
      cs = [...counts],
      rs = [...ranges],
      n = idx + delta;
    if (n < 0 || n >= fs.length) return;
    [fs[idx], fs[n]] = [fs[n], fs[idx]];
    [cs[idx], cs[n]] = [cs[n], cs[idx]];
    [rs[idx], rs[n]] = [rs[n], rs[idx]];
    setFiles(fs);
    setCounts(cs);
    setRanges(rs);
  };
  const missingOcr = ["ocrmypdf", "tesseract", "ghostscript"].filter(
    (dep) => !dependencies?.[dep],
  );
  const dependencyFor = {
    "PDF to PDF/A": "ghostscript",
    "Compress PDF": "ghostscript",
    "Repair PDF": "qpdf",
    "Protect PDF": "qpdf",
    "Unlock PDF": "qpdf",
    "Office to PDF": "libreoffice",
    "HTML to PDF": "libreoffice",
  }[active?.[0]];
  const missingToolDependency = dependencyFor && !dependencies?.[dependencyFor];
  const visibleGroups = groups.filter(
    (group) => category === "All tools" || group.name === category,
  );
  return (
    <div className={dark ? "app dark" : "app"}>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={() => {
            setActive(null);
            reset();
          }}
        >
          <span className="brand-mark">
            <FileText size={19} />
          </span>
          <span>
            paperplane<span className="brand-dot">.</span>
          </span>
          <span className="local-pill">
            <span />
            LOCAL
          </span>
        </a>
        <div className="top-right">
          <span className="privacy">
            <ShieldCheck size={15} /> Files stay on this device
          </span>
          <button
            className="icon-btn"
            aria-label="Toggle color theme"
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button className="menu-btn" aria-label="Menu">
            <Menu size={17} />
          </button>
        </div>
      </header>
      {active ? (
        <main className="tool-page">
          <button className="back" onClick={() => setActive(null)}>
            <ArrowLeft size={16} /> All tools
          </button>
          <div className="tool-heading">
            <div className={"tool-icon " + active.color}>
              {React.createElement(active[2], { size: 24 })}
            </div>
            <div>
              <div className="eyebrow">{active.group}</div>
              <h1>{active[0]}</h1>
              <p>{active[1]}</p>
            </div>
          </div>
          <div className="work-card">
            <div
              className="upload-zone"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles(e.dataTransfer.files);
              }}
              style={{
                borderColor: drag ? "var(--accent)" : undefined,
                background: drag ? "var(--drop)" : undefined,
              }}
            >
              <input
                ref={input}
                type="file"
                accept={
                  active[0] === "Image to PDF"
                    ? "image/png,image/jpeg"
                    : active[0] === "Office to PDF"
                      ? ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf"
                      : active[0] === "HTML to PDF"
                        ? ".html,.htm"
                        : active[0] === "Text to PDF"
                          ? ".txt,text/plain"
                          : "application/pdf,.pdf"
                }
                multiple={[
                  "Merge PDFs",
                  "Create from pages",
                  "Image to PDF",
                  "Compare PDFs",
                ].includes(active[0])}
                hidden
                onChange={(e) => addFiles(e.target.files)}
              />
              <div className="upload-icon">
                <Upload size={24} />
              </div>
              <h2>
                {files.length
                  ? "Add files"
                  : active[0] === "Image to PDF"
                    ? "Drop your images here"
                    : ["Office to PDF", "HTML to PDF", "Text to PDF"].includes(
                          active[0],
                        )
                      ? `Drop your ${active[0] === "Office to PDF" ? "Office" : active[0] === "HTML to PDF" ? "HTML" : "text"} file here`
                      : "Drop your PDF here"}
              </h2>
              <p>
                or{" "}
                <button
                  className="text-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    input.current?.click();
                  }}
                >
                  browse files
                </button>{" "}
                from your device
              </p>
              <span className="upload-note">
                <ShieldCheck size={14} /> Private by design · Files never leave
                your device
              </span>
            </div>
            {files.length > 0 && (
              <div className="file-list">
                {files.map((f, i) => (
                  <div className="file-row" key={`${f.name}-${i}`}>
                    <span className="pdf-badge">
                      {active[0] === "Image to PDF"
                        ? "IMG"
                        : [
                              "Office to PDF",
                              "HTML to PDF",
                              "Text to PDF",
                            ].includes(active[0])
                          ? "FILE"
                          : "PDF"}
                    </span>
                    <span className="file-name">
                      {f.name}{" "}
                      <small>
                        ·{" "}
                        {![
                          "Image to PDF",
                          "Office to PDF",
                          "HTML to PDF",
                          "Text to PDF",
                        ].includes(active[0]) && `${counts[i]} pages`}
                      </small>
                    </span>
                    {["Merge PDFs", "Create from pages"].includes(
                      active[0],
                    ) && (
                      <input
                        className="file-range"
                        aria-label={`Pages to use from ${f.name}`}
                        value={
                          ranges[i] === NONE_SELECTED ? "" : ranges[i] || ""
                        }
                        onChange={(e) =>
                          setRanges((v) =>
                            v.map((r, n) => (n === i ? e.target.value : r)),
                          )
                        }
                        placeholder="All pages"
                      />
                    )}
                    <span className="file-size">
                      {(f.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    {[
                      "Merge PDFs",
                      "Create from pages",
                      "Image to PDF",
                      "Compare PDFs",
                    ].includes(active[0]) && (
                      <span className="reorder-buttons">
                        <button title="Move up" onClick={() => move(i, -1)}>
                          <MoveUp size={15} />
                        </button>
                        <button title="Move down" onClick={() => move(i, 1)}>
                          <MoveDown size={15} />
                        </button>
                      </span>
                    )}
                    <button
                      className="remove-file"
                      aria-label="Remove file"
                      onClick={() => {
                        setFiles(files.filter((_, n) => n !== i));
                        setCounts(counts.filter((_, n) => n !== i));
                        setRanges(ranges.filter((_, n) => n !== i));
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {files.length > 0 && PAGE_PICKER_TOOLS.has(active[0]) && (
              <div className="page-pickers">
                {(active[0] === "Merge PDFs" ||
                active[0] === "Create from pages"
                  ? files.map((file, index) => ({ file, index }))
                  : [{ file: files[0], index: 0 }]
                ).map(({ file, index }) => (
                  <PdfPagePicker
                    key={`${file.name}-${index}-${active[0]}`}
                    file={file}
                    count={counts[index] || 0}
                    label={
                      files.length > 1
                        ? `${index + 1}. ${file.name}`
                        : undefined
                    }
                    selectedPages={selectionForPicker(index)}
                    onSelectionChange={(pages) =>
                      setPickerSelection(index, pages)
                    }
                  />
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="options">
                {["Extract pages", "Delete pages", "Rotate pages"].includes(
                  active[0],
                ) && (
                  <label>
                    {active[0] === "Delete pages"
                      ? "Pages to delete"
                      : "Page selection (optional)"}
                    <input
                      value={range === NONE_SELECTED ? "" : range}
                      onChange={(e) => setRange(e.target.value)}
                      placeholder={
                        active[0] === "Delete pages"
                          ? "2, 4-6"
                          : "1-3, 5 (leave blank for all pages)"
                      }
                    />
                    <small>
                      Page numbers are 1-based. Use commas and ranges, e.g. 1,
                      3-5.
                    </small>
                  </label>
                )}
                {active[0] === "Reorder pages" && (
                  <>
                    <label>
                      Pages to move to the front
                      <input
                        value={range === NONE_SELECTED ? "" : range}
                        onChange={(e) => {
                          const value = e.target.value;
                          setRange(value);
                          try {
                            const chosen = value.trim()
                              ? parsePages(value, counts[0] || 1)
                              : [];
                            const rest = Array.from(
                              { length: counts[0] || 0 },
                              (_, index) => index,
                            ).filter((index) => !chosen.includes(index));
                            setOrder(
                              [...chosen, ...rest]
                                .map((index) => index + 1)
                                .join(","),
                            );
                          } catch {
                            /* Keep the current order while an incomplete range is being typed. */
                          }
                        }}
                        placeholder="1-3, 5"
                      />
                      <small>
                        Choose pages in the preview or type a range. Unselected
                        pages follow in their current order.
                      </small>
                    </label>
                    <label>
                      Final page order (optional)
                      <input
                        value={order}
                        onChange={(e) => setOrder(e.target.value)}
                        placeholder="3,1,2"
                      />
                      <small>
                        For a custom order, enter every page number exactly
                        once.
                      </small>
                    </label>
                  </>
                )}
                {active[0] === "Split PDF" && (
                  <>
                    <label>
                      Split mode
                      <select
                        value={splitMode}
                        onChange={(e) => setSplitMode(e.target.value)}
                      >
                        <option value="pages">Every N pages</option>
                        <option value="range">Selected page range</option>
                        <option value="bookmarks">Top-level bookmarks</option>
                      </select>
                    </label>
                    {splitMode === "pages" && (
                      <label>
                        Pages per output file
                        <input
                          type="number"
                          min="1"
                          value={splitN}
                          onChange={(e) => setSplitN(e.target.value)}
                        />
                        <small>The final part can contain fewer pages.</small>
                      </label>
                    )}
                    {splitMode === "range" && (
                      <label>
                        Pages to split into a new PDF
                        <input
                          value={range === NONE_SELECTED ? "" : range}
                          onChange={(e) => setRange(e.target.value)}
                          placeholder="1-3, 5"
                        />
                        <small>
                          Choose pages in the preview or enter a page range.
                        </small>
                      </label>
                    )}
                    {splitMode === "bookmarks" && (
                      <small className="wide-note">
                        Creates one PDF per top-level bookmark with a page
                        destination.
                      </small>
                    )}
                  </>
                )}
                {active[0] === "Rotate pages" && (
                  <label>
                    Rotation
                    <select
                      value={angle}
                      onChange={(e) => setAngle(e.target.value)}
                    >
                      <option value="90">90° clockwise</option>
                      <option value="180">180°</option>
                      <option value="270">270° clockwise</option>
                    </select>
                  </label>
                )}
                {active[0] === "Page numbers, headers & footers" && (
                  <>
                    <label>
                      Header/footer text
                      <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Page {page} of {pages}"
                      />
                    </label>
                    <label>
                      Position
                      <select
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                      >
                        <option value="footer">Footer</option>
                        <option value="header">Header</option>
                        <option value="both">Header and footer</option>
                      </select>
                    </label>
                    <label>
                      Font size
                      <input
                        type="number"
                        min="6"
                        max="72"
                        value={fontSize}
                        onChange={(e) => setFontSize(e.target.value)}
                      />
                    </label>
                  </>
                )}
                {active[0] === "Watermark" && (
                  <>
                    <label>
                      Watermark text
                      <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="CONFIDENTIAL"
                      />
                    </label>
                    <label>
                      Font size
                      <input
                        type="number"
                        min="6"
                        max="100"
                        value={fontSize}
                        onChange={(e) => setFontSize(e.target.value)}
                      />
                    </label>
                    <label>
                      Or use a PNG/JPG image
                      <input
                        ref={imageInput}
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(e) => setImage(e.target.files?.[0] || null)}
                      />
                    </label>
                  </>
                )}
                {active[0] === "Crop PDF" && (
                  <label>
                    Crop margin (PDF points)
                    <input
                      type="number"
                      min="0"
                      value={margin}
                      onChange={(e) => setMargin(e.target.value)}
                    />
                    <small>
                      Applies the same inset on each edge of every page.
                    </small>
                  </label>
                )}
                {active[0] === "Resize pages" && (
                  <div className="two-inputs">
                    <label>
                      Width (points)
                      <input
                        type="number"
                        min="1"
                        value={pageWidth}
                        onChange={(e) => setPageWidth(e.target.value)}
                      />
                    </label>
                    <label>
                      Height (points)
                      <input
                        type="number"
                        min="1"
                        value={pageHeight}
                        onChange={(e) => setPageHeight(e.target.value)}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
            {files.length > 0 &&
              ["PDF pages to images", "Crop page to image"].includes(
                active[0],
              ) && (
                <div className="options">
                  {active[0] === "PDF pages to images" && (
                    <label>
                      Pages to export (optional)
                      <input
                        value={range}
                        onChange={(e) => setRange(e.target.value)}
                        placeholder="All pages, or 1, 3-5"
                      />
                    </label>
                  )}
                  {active[0] === "Crop page to image" && (
                    <>
                      <label>
                        Page number
                        <input
                          type="number"
                          min="1"
                          max={counts[0] || 1}
                          value={page}
                          onChange={(e) => setPage(e.target.value)}
                        />
                      </label>
                      <label>
                        X from left (points)
                        <input
                          type="number"
                          value={x}
                          onChange={(e) => setX(e.target.value)}
                        />
                      </label>
                      <label>
                        Y from bottom (points)
                        <input
                          type="number"
                          value={y}
                          onChange={(e) => setY(e.target.value)}
                        />
                      </label>
                      <label>
                        Crop width (points)
                        <input
                          type="number"
                          min="1"
                          value={boxWidth}
                          onChange={(e) => setBoxWidth(e.target.value)}
                        />
                      </label>
                      <label>
                        Crop height (points)
                        <input
                          type="number"
                          min="1"
                          value={boxHeight}
                          onChange={(e) => setBoxHeight(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  <label>
                    Image format
                    <select
                      value={imageFormat}
                      onChange={(e) => setImageFormat(e.target.value)}
                    >
                      <option value="png">PNG</option>
                      <option value="jpg">JPG</option>
                    </select>
                  </label>
                  <label>
                    Render scale
                    <select
                      value={imageScale}
                      onChange={(e) => setImageScale(Number(e.target.value))}
                    >
                      <option value="1">1× (standard)</option>
                      <option value="1.5">1.5× (recommended)</option>
                      <option value="2">2× (high resolution)</option>
                    </select>
                  </label>
                </div>
              )}
            {files.length > 0 && active.group === "Edit PDF" && (
              <div className="options editor-options">
                {active[0] === "Edit PDF" && (
                  <>
                    <label>
                      Existing text to replace (optional)
                      <input
                        value={findText}
                        onChange={(e) => setFindText(e.target.value)}
                        placeholder="Exact text item on the selected page"
                      />
                    </label>
                    {findText ? (
                      <label>
                        Replacement text
                        <input
                          value={replacement}
                          onChange={(e) => setReplacement(e.target.value)}
                        />
                      </label>
                    ) : (
                      <label>
                        New text
                        <input
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder="Text to place on the PDF"
                        />
                      </label>
                    )}
                    {!findText && (
                      <label>
                        Add image (PNG/JPG)
                        <input
                          ref={imageInput}
                          type="file"
                          accept="image/png,image/jpeg"
                          onChange={(e) =>
                            setImage(e.target.files?.[0] || null)
                          }
                        />
                      </label>
                    )}
                  </>
                )}
                {active[0] === "Fill forms" &&
                  (formFields.length ? (
                    formFields.map((field) => (
                      <label key={field.name}>
                        {field.name}
                        <input
                          value={formValues[field.name] ?? ""}
                          onChange={(e) =>
                            setFormValues((v) => ({
                              ...v,
                              [field.name]: e.target.value,
                            }))
                          }
                          placeholder={field.type}
                        />
                      </label>
                    ))
                  ) : (
                    <p className="wide-note">
                      This PDF has no AcroForm fields to fill.
                    </p>
                  ))}
                {active[0] === "Add signature" && (
                  <>
                    <label className="signature-pad-label">
                      Draw signature (mouse or touch)
                      <canvas
                        ref={signatureCanvas}
                        className="signature-pad"
                        width="320"
                        height="96"
                        onPointerDown={(e) => {
                          const canvas = e.currentTarget,
                            rect = canvas.getBoundingClientRect(),
                            px =
                              ((e.clientX - rect.left) * canvas.width) /
                              rect.width,
                            py =
                              ((e.clientY - rect.top) * canvas.height) /
                              rect.height,
                            ctx = canvas.getContext("2d");
                          signatureDrawing.current = true;
                          ctx.beginPath();
                          ctx.moveTo(px, py);
                          setSignaturePoints([
                            {
                              x: Number(x) + px * 0.75,
                              y: Number(y) + (canvas.height - py) * 0.75,
                            },
                          ]);
                          canvas.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (!signatureDrawing.current) return;
                          const canvas = e.currentTarget,
                            rect = canvas.getBoundingClientRect(),
                            px =
                              ((e.clientX - rect.left) * canvas.width) /
                              rect.width,
                            py =
                              ((e.clientY - rect.top) * canvas.height) /
                              rect.height,
                            ctx = canvas.getContext("2d");
                          ctx.strokeStyle = colorValue;
                          ctx.lineWidth = 2.5;
                          ctx.lineCap = "round";
                          ctx.lineTo(px, py);
                          ctx.stroke();
                          setSignaturePoints((points) => [
                            ...points,
                            {
                              x: Number(x) + px * 0.75,
                              y: Number(y) + (canvas.height - py) * 0.75,
                            },
                          ]);
                        }}
                        onPointerUp={() => {
                          signatureDrawing.current = false;
                        }}
                      />
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          const canvas = signatureCanvas.current;
                          canvas
                            ?.getContext("2d")
                            .clearRect(0, 0, canvas.width, canvas.height);
                          setSignaturePoints([]);
                        }}
                      >
                        Clear drawing
                      </button>
                    </label>
                    <label>
                      Typed signature
                      <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Type your name"
                      />
                    </label>
                    <label>
                      Or select a PNG/JPG signature image
                      <input
                        ref={imageInput}
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(e) => setImage(e.target.files?.[0] || null)}
                      />
                    </label>
                  </>
                )}
                {active[0] === "Annotate PDF" && (
                  <>
                    <label>
                      Annotation type
                      <select
                        value={annotation}
                        onChange={(e) => setAnnotation(e.target.value)}
                      >
                        <option value="highlight">Highlight</option>
                        <option value="underline">Underline</option>
                        <option value="strikeout">Strikeout</option>
                        <option value="rectangle">Rectangle</option>
                        <option value="comment">Comment</option>
                        <option value="text">Text note</option>
                        <option value="freehand">Freehand line</option>
                      </select>
                    </label>
                    {["comment", "text"].includes(annotation) && (
                      <label>
                        Comment text
                        <input
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                        />
                      </label>
                    )}
                    {annotation === "freehand" && (
                      <label>
                        Points (x,y; x,y) in page points
                        <input
                          value={freehandPoints}
                          onChange={(e) => setFreehandPoints(e.target.value)}
                          placeholder="40,40; 70,60; 100,40"
                        />
                      </label>
                    )}
                  </>
                )}
                {[
                  "Edit PDF",
                  "Fill forms",
                  "Add signature",
                  "Annotate PDF",
                  "Redact PDF",
                  "Whiteout PDF",
                ].includes(active[0]) && (
                  <>
                    <label>
                      Page number
                      <input
                        type="number"
                        min="1"
                        max={counts[0] || 1}
                        value={page}
                        onChange={(e) => setPage(e.target.value)}
                      />
                    </label>
                    <label>
                      X position from left (points)
                      <input
                        type="number"
                        value={x}
                        onChange={(e) => setX(e.target.value)}
                      />
                    </label>
                    <label>
                      Y position from bottom (points)
                      <input
                        type="number"
                        value={y}
                        onChange={(e) => setY(e.target.value)}
                      />
                    </label>
                    {!["Fill forms", "Redact PDF", "Whiteout PDF"].includes(
                      active[0],
                    ) && (
                      <>
                        <label>
                          Font size
                          <input
                            type="number"
                            min="6"
                            max="96"
                            value={fontSize}
                            onChange={(e) => setFontSize(e.target.value)}
                          />
                        </label>
                        <label>
                          Font
                          <select
                            value={font}
                            onChange={(e) => setFont(e.target.value)}
                          >
                            <option>Helvetica</option>
                            <option>HelveticaBold</option>
                            <option>TimesRoman</option>
                            <option>TimesItalic</option>
                            <option>Courier</option>
                          </select>
                        </label>
                        <label>
                          Color
                          <input
                            type="color"
                            value={colorValue}
                            onChange={(e) => setColorValue(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                    {["Redact PDF", "Whiteout PDF", "Annotate PDF"].includes(
                      active[0],
                    ) && (
                      <>
                        <label>
                          Area width (points)
                          <input
                            type="number"
                            min="1"
                            value={boxWidth}
                            onChange={(e) => setBoxWidth(e.target.value)}
                          />
                        </label>
                        <label>
                          Area height (points)
                          <input
                            type="number"
                            min="1"
                            value={boxHeight}
                            onChange={(e) => setBoxHeight(e.target.value)}
                          />
                        </label>
                        <small className="wide-note">
                          Coordinates use PDF points from the lower-left corner.
                          Redaction rasterizes every page to permanently remove
                          underlying content and searchable text.
                        </small>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
            {files.length > 0 &&
              ["Extract text", "Copy PDF text", "OCR PDF"].includes(
                active[0],
              ) && (
                <div className="options">
                  {active[0] !== "OCR PDF" && (
                    <label>
                      Page number (leave blank for all pages)
                      <input
                        type="number"
                        min="1"
                        max={counts[0] || 1}
                        value={textPage}
                        onChange={(e) => setTextPage(e.target.value)}
                        placeholder="All pages"
                      />
                    </label>
                  )}
                  {active[0] === "OCR PDF" &&
                    (missingOcr.length ? (
                      <div className="dependency-note">
                        <b>Local OCR requirements</b>
                        <p>
                          Missing programs: {missingOcr.join(", ")}. Install
                          Python 64-bit, Tesseract 64-bit, Ghostscript 64-bit,
                          and OCRmyPDF.
                        </p>
                        <code>
                          winget install -e --id Python.Python.3.11
                          <br />
                          choco install tesseract
                          <br />
                          choco install ghostscript
                          <br />
                          python -m pip install ocrmypdf
                        </code>
                        <small>
                          Run Chocolatey commands in an Administrator terminal.
                          Open a fresh terminal and restart Paperplane after
                          installation.
                        </small>
                      </div>
                    ) : (
                      <p className="wide-note">
                        OCRmyPDF, Tesseract, and Ghostscript are available. OCR
                        will create a ZIP containing a searchable PDF and a TXT
                        sidecar.
                      </p>
                    ))}
                </div>
              )}
            {files.length > 0 &&
              (SYSTEM_TOOLS.has(active[0]) ||
                [
                  "Flatten PDF",
                  "Remove metadata",
                  "Edit metadata",
                  "Compare PDFs",
                ].includes(active[0])) && (
                <div className="options">
                  {active[0] === "Compress PDF" && (
                    <label>
                      Compression level
                      <select
                        value={compressionLevel}
                        onChange={(e) => setCompressionLevel(e.target.value)}
                      >
                        <option value="low">Low (best quality)</option>
                        <option value="medium">Medium</option>
                        <option value="high">High (smallest file)</option>
                      </select>
                    </label>
                  )}
                  {active[0] === "Protect PDF" && (
                    <>
                      <label>
                        User password
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                      <label>
                        Owner password (optional)
                        <input
                          type="password"
                          value={ownerPassword}
                          onChange={(e) => setOwnerPassword(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  {active[0] === "Unlock PDF" && (
                    <label>
                      Current PDF password
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                  )}
                  {active[0] === "Edit metadata" && (
                    <>
                      <label>
                        Title
                        <input
                          value={metadataTitle}
                          onChange={(e) => setMetadataTitle(e.target.value)}
                        />
                      </label>
                      <label>
                        Author
                        <input
                          value={metadataAuthor}
                          onChange={(e) => setMetadataAuthor(e.target.value)}
                        />
                      </label>
                      <label>
                        Subject
                        <input
                          value={metadataSubject}
                          onChange={(e) => setMetadataSubject(e.target.value)}
                        />
                      </label>
                      <label>
                        Keywords (comma separated)
                        <input
                          value={metadataKeywords}
                          onChange={(e) => setMetadataKeywords(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  {active[0] === "Compare PDFs" && (
                    <p className="wide-note">
                      Add exactly two PDFs. The downloaded HTML report compares
                      their extractable text line by line.
                    </p>
                  )}
                  {missingToolDependency && (
                    <div className="dependency-note">
                      <b>Required local program is missing: {dependencyFor}</b>
                      <p>
                        Install it on this machine, then restart Paperplane.
                      </p>
                      <code>
                        {dependencyFor === "libreoffice"
                          ? "winget install -e --id TheDocumentFoundation.LibreOffice"
                          : dependencyFor === "qpdf"
                            ? "choco install qpdf"
                            : "choco install ghostscript"}
                      </code>
                      <small>
                        Run Chocolatey commands in an Administrator terminal.
                        Install steps are also in README.md.
                      </small>
                    </div>
                  )}
                  {active[0] === "Compress PDF" && sizeReport && (
                    <p className="wide-note">
                      Size: {(sizeReport.before / 1024 / 1024).toFixed(2)} MB →{" "}
                      {(sizeReport.after / 1024 / 1024).toFixed(2)} MB (
                      {sizeReport.before
                        ? (
                            100 *
                            (1 - sizeReport.after / sizeReport.before)
                          ).toFixed(1)
                        : 0}
                      % reduction).
                    </p>
                  )}
                </div>
              )}
            {error && <div className="notice error">{error}</div>}
            {message && (
              <div className="notice success">
                <Check size={17} />
                {message}
              </div>
            )}
            <div className="work-footer">
              <span>
                <ShieldCheck size={15} /> Processing happens in your browser
              </span>
              <button
                className="primary"
                disabled={!files.length || busy}
                onClick={run}
              >
                {busy ? (
                  "Processing…"
                ) : (
                  <>
                    Process PDF <ArrowUpRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        </main>
      ) : (
        <>
          <main className="hero">
            <div className="hero-copy">
              <div className="hero-kicker">
                <span className="kicker-icon">
                  <ShieldCheck size={14} />
                </span>{" "}
                YOUR FILES NEVER LEAVE YOUR DEVICE
              </div>
              <h1>
                Everything you need
                <br />
                to work with <span>PDFs.</span>
              </h1>
              <p className="hero-sub">
                A thoughtfully simple PDF toolkit. All the tools you need, right
                here on your computer.
              </p>
              <div className="search-wrap">
                <Search size={19} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="What would you like to do?"
                  aria-label="Search PDF tools"
                />
                <kbd>⌘ K</kbd>
              </div>
              <div className="hero-foot">
                <span>
                  <Check size={15} /> No uploads
                </span>
                <span>
                  <Check size={15} /> No account needed
                </span>
                <span>
                  <Check size={15} /> Free, always
                </span>
              </div>
            </div>
            <div className="hero-art">
              <div className="art-glow" />
              <div className="paper paper-back" />
              <div className="paper paper-front">
                <span className="paper-label">PDF</span>
                <span className="paper-title">
                  Your work,
                  <br />
                  well sorted.
                </span>
                <span className="paper-rule" />
                <span className="paper-mini-lines" />
                <span className="paper-page">01 / 08</span>
              </div>
              <div className="float-chip chip-lock">
                <ShieldCheck size={15} /> Private & local
              </div>
              <div className="float-chip chip-merge">
                <Files size={16} />
                <span>Merge PDFs</span>
                <Check size={14} />
              </div>
              <div className="art-orbit orbit-a" />
              <div className="art-orbit orbit-b" />
            </div>
          </main>
          <div className="catalog">
            <div className="catalog-head">
              <div>
                <div className="eyebrow">THE TOOLBOX</div>
                <h2>
                  {query ? `Results for “${query}”` : "A tool for every task."}
                </h2>
                <p>Everything you need to make your PDFs work better.</p>
              </div>
              <div className="catalog-count">
                <span>{filtered.length}</span> tools
              </div>
            </div>
            {!query && (
              <nav className="category-tabs" aria-label="Tool categories">
                {["All tools", ...groups.map((group) => group.name)].map(
                  (name) => (
                    <button
                      key={name}
                      type="button"
                      className={category === name ? "active" : ""}
                      aria-pressed={category === name}
                      onClick={() => setCategory(name)}
                    >
                      {name}
                    </button>
                  ),
                )}
              </nav>
            )}
            {query ? (
              <div className="search-results">
                {filtered.map((item, i) => (
                  <ToolCard key={i} item={item} onClick={choose} />
                ))}
              </div>
            ) : (
              visibleGroups.map((group) => (
                <section className="group" key={group.name}>
                  <div className="group-title">
                    <span className={"group-icon " + group.color}>
                      <group.icon size={17} />
                    </span>
                    <h3>{group.name}</h3>
                    <span className="group-line" />
                  </div>
                  <div className="tool-grid">
                    {group.items.map((item, i) => (
                      <ToolCard
                        key={i}
                        item={{
                          ...item,
                          group: group.name,
                          color: group.color,
                        }}
                        onClick={choose}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
            <div className="privacy-banner">
              <div className="privacy-symbol">
                <ShieldCheck size={23} />
              </div>
              <div>
                <b>Your documents are yours. Full stop.</b>
                <p>
                  Files are processed in your browser or by the local worker on
                  this computer. Nothing is sent to an external service.
                </p>
              </div>
              <div className="local-stamp">
                <CloudOff size={15} /> 100% LOCAL
              </div>
            </div>
          </div>
        </>
      )}
      <footer>
        <a className="brand footer-brand" href="#">
          <span className="brand-mark">
            <FileText size={16} />
          </span>
          <span>
            paperplane<span className="brand-dot">.</span>
          </span>
        </a>
        <span>PDF tools, made local.</span>
        <span className="footer-secure">
          <ShieldCheck size={14} /> Your files stay yours
        </span>
      </footer>
    </div>
  );
}
function ToolCard({ item, onClick }) {
  const Icon = item[2],
    dependency = SYSTEM_TOOLS.has(item[0]);
  return (
    <button className="tool-card" onClick={() => onClick(item)}>
      <span className={"card-icon " + item.color}>
        <Icon size={19} />
      </span>
      <span className="card-copy">
        <b>{item[0]}</b>
        <small>{item[1]}</small>
      </span>
      {dependency ? (
        <span className="dependency-status">SYSTEM</span>
      ) : (
        <span className="available">READY</span>
      )}
      <ArrowUpRight className="card-arrow" size={15} />
    </button>
  );
}
export default App;
