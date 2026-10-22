import express from "express";
import multer from "multer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";

const app = express(),
  uploadDir = path.join(tmpdir(), "paperplane-uploads");
await mkdir(uploadDir, { recursive: true });
const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  }),
  exec = promisify(execFile);
const WINDOWS = process.platform === "win32";
const names = {
  tesseract: WINDOWS ? "tesseract.exe" : "tesseract",
  ocrmypdf: WINDOWS ? "ocrmypdf.exe" : "ocrmypdf",
  ghostscript: WINDOWS ? "gswin64c.exe" : "gs",
  qpdf: WINDOWS ? "qpdf.exe" : "qpdf",
  libreoffice: WINDOWS ? "soffice.exe" : "soffice",
  pdftoppm: WINDOWS ? "pdftoppm.exe" : "pdftoppm",
};
async function installed(command) {
  try {
    await exec(WINDOWS ? "where.exe" : "which", [command]);
    return true;
  } catch {
    return false;
  }
}

app.get("/api/dependencies", async (_req, res) => {
  const entries = await Promise.all(
    Object.entries(names).map(async ([key, command]) => [
      key,
      await installed(command),
    ]),
  );
  res.json(Object.fromEntries(entries));
});

app.post("/api/ocr", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a PDF first." });
  const required = ["ocrmypdf", "tesseract", "ghostscript"];
  const status = Object.fromEntries(
    await Promise.all(
      required.map(async (key) => [key, await installed(names[key])]),
    ),
  );
  const missing = required.filter((key) => !status[key]);
  if (missing.length)
    return res.status(503).json({
      error: "OCR needs local system programs that are missing.",
      missing,
    });
  const folder = await mkdtemp(path.join(tmpdir(), "paperplane-ocr-"));
  const input = path.join(folder, "input.pdf"),
    output = path.join(folder, "searchable.pdf"),
    sidecar = path.join(folder, "extracted.txt");
  try {
    await writeFile(input, await readFile(req.file.path));
    await exec(
      names.ocrmypdf,
      ["--skip-text", "--deskew", "--sidecar", sidecar, input, output],
      { timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
    );
    const zip = new JSZip();
    zip.file("searchable.pdf", await readFile(output));
    zip.file(
      "extracted.txt",
      await readFile(sidecar).catch(() => Buffer.alloc(0)),
    );
    res
      .type("application/zip")
      .attachment("ocr-results.zip")
      .send(
        await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
      );
  } catch (e) {
    res
      .status(422)
      .json({ error: `OCR failed: ${e.stderr?.trim() || e.message}` });
  } finally {
    await rm(folder, { recursive: true, force: true });
    await unlink(req.file.path).catch(() => {});
  }
});

app.post("/api/system/:tool", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a file first." });
  const tool = req.params.tool;
  const needs = ["office-to-pdf", "html-to-pdf"].includes(tool)
    ? ["libreoffice"]
    : ["pdf-to-pdfa", "compress"].includes(tool)
      ? ["ghostscript"]
      : ["repair", "protect", "unlock"].includes(tool)
        ? ["qpdf"]
        : [];
  if (!needs.length) {
    await unlink(req.file.path).catch(() => {});
    return res.status(404).json({ error: "Unknown local system tool." });
  }
  const status = Object.fromEntries(
    await Promise.all(
      needs.map(async (key) => [key, await installed(names[key])]),
    ),
  );
  const missing = needs.filter((key) => !status[key]);
  if (missing.length) {
    await unlink(req.file.path).catch(() => {});
    const install = missing.includes("libreoffice")
      ? "winget install -e --id TheDocumentFoundation.LibreOffice"
      : missing.includes("qpdf")
        ? "choco install qpdf"
        : "choco install ghostscript";
    return res.status(503).json({
      error: `Required local program is missing: ${missing.join(", ")}. Install it with: ${install}. Restart Paperplane after installation.`,
      missing,
      install,
    });
  }
  const folder = await mkdtemp(path.join(tmpdir(), "paperplane-convert-"));
  try {
    const base = path.basename(req.file.originalname).replace(/[^\w.-]+/g, "_"),
      input = path.join(folder, base),
      ext = path.extname(base),
      stem = path.basename(base, ext);
    await writeFile(input, await readFile(req.file.path));
    let output, outputName;
    if (["office-to-pdf", "html-to-pdf"].includes(tool)) {
      await exec(
        names.libreoffice,
        ["--headless", "--convert-to", "pdf", "--outdir", folder, input],
        { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
      );
      output = path.join(folder, `${stem}.pdf`);
      outputName = `${stem}.pdf`;
    } else if (tool === "pdf-to-pdfa") {
      output = path.join(folder, `${stem}-pdfa.pdf`);
      outputName = `${stem}-pdfa.pdf`;
      await exec(
        names.ghostscript,
        [
          "-dPDFA=2",
          "-dBATCH",
          "-dNOPAUSE",
          "-dNOOUTERSAVE",
          "-sDEVICE=pdfwrite",
          "-dPDFACompatibilityPolicy=1",
          `-sOutputFile=${output}`,
          input,
        ],
        { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
      );
    } else if (tool === "compress") {
      output = path.join(folder, `${stem}-compressed.pdf`);
      outputName = `${stem}-compressed.pdf`;
      const presets = { low: "/prepress", medium: "/ebook", high: "/screen" },
        preset = presets[req.body.level] || presets.medium;
      await exec(
        names.ghostscript,
        [
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.4",
          `-dPDFSETTINGS=${preset}`,
          "-dNOPAUSE",
          "-dQUIET",
          "-dBATCH",
          `-sOutputFile=${output}`,
          input,
        ],
        { timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
      );
    } else if (tool === "repair") {
      output = path.join(folder, `${stem}-repaired.pdf`);
      outputName = `${stem}-repaired.pdf`;
      await exec(names.qpdf, ["--warning-exit-0", input, output], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 8 * 1024 * 1024,
      });
    } else if (tool === "protect") {
      const user = String(req.body.password || ""),
        owner = String(req.body.ownerPassword || user);
      if (!user) throw new Error("Enter a user password to protect this PDF.");
      output = path.join(folder, `${stem}-protected.pdf`);
      outputName = `${stem}-protected.pdf`;
      await exec(
        names.qpdf,
        ["--encrypt", user, owner, "256", "--", input, output],
        { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
      );
    } else if (tool === "unlock") {
      const password = String(req.body.password || "");
      if (!password)
        throw new Error("Enter the current PDF password to unlock it.");
      output = path.join(folder, `${stem}-unlocked.pdf`);
      outputName = `${stem}-unlocked.pdf`;
      await exec(
        names.qpdf,
        [`--password=${password}`, "--decrypt", input, output],
        { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
      );
    }
    const result = await readFile(output);
    res
      .set("X-Input-Size", String(req.file.size))
      .set("X-Output-Size", String(result.byteLength))
      .type("application/pdf")
      .attachment(outputName)
      .send(result);
  } catch (e) {
    res.status(422).json({
      error: `Local conversion failed: ${e.stderr?.trim() || e.message}`,
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
    await unlink(req.file.path).catch(() => {});
  }
});

app.listen(3101, "127.0.0.1", () =>
  console.log("Local PDF worker ready on http://127.0.0.1:3101"),
);
