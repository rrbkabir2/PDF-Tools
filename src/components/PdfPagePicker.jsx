import { useEffect, useRef, useState } from "react";
import { ZoomIn, X } from "lucide-react";
import { openPdf } from "../pdf/pdfjs.js";

function PdfCanvas({ pdf, pageNumber, scale, lazy = false }) {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (!lazy || !hostRef.current) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [lazy]);

  useEffect(() => {
    if (!visible || !pdf || !canvasRef.current) return;
    let task;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        task = page.render({ canvasContext: context, viewport });
        await task.promise;
      } catch (error) {
        if (error?.name !== "RenderingCancelledException") console.error(error);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, scale, visible]);

  return (
    <div ref={hostRef} className="page-canvas-host">
      {visible && <canvas ref={canvasRef} />}
    </div>
  );
}

export default function PdfPagePicker({
  file,
  count,
  selectedPages,
  onSelectionChange,
  label,
}) {
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState("");
  const [zoomPage, setZoomPage] = useState(null);
  const anchor = useRef(null);
  const selected = new Set(selectedPages);

  useEffect(() => {
    let live = true;
    let loaded;
    setPdf(null);
    setError("");
    openPdf(file)
      .then((document) => {
        loaded = document;
        if (live) setPdf(document);
        else document.destroy();
      })
      .catch(
        () => live && setError("Could not render page previews for this PDF."),
      );
    return () => {
      live = false;
      loaded?.destroy();
    };
  }, [file]);

  const all = Array.from({ length: count }, (_, index) => index);
  const chooseRange = (start, end, value) => {
    const next = new Set(selectedPages);
    for (
      let index = Math.min(start, end);
      index <= Math.max(start, end);
      index++
    ) {
      if (value) next.add(index);
      else next.delete(index);
    }
    onSelectionChange([...next].sort((a, b) => a - b));
  };

  return (
    <section className="page-picker" aria-label={`Pages in ${file.name}`}>
      <div className="page-picker-heading">
        <div>
          <h3>{label || file.name}</h3>
          <p>
            {selectedPages.length} of {count} pages selected
          </p>
        </div>
        <div className="page-picker-actions">
          <button type="button" onClick={() => onSelectionChange(all)}>
            Select all
          </button>
          <button type="button" onClick={() => onSelectionChange([])}>
            Clear all
          </button>
        </div>
      </div>
      {error ? (
        <p className="page-picker-error">{error}</p>
      ) : !pdf ? (
        <p className="page-picker-loading">Loading page previews…</p>
      ) : (
        <div className="page-thumbnail-grid">
          {all.map((index) => {
            const isSelected = selected.has(index);
            return (
              <div
                className={`page-thumbnail${isSelected ? " selected" : ""}`}
                key={`${file.name}-${index}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  anchor.current = { page: index, selected: !isSelected };
                  chooseRange(index, index, !isSelected);
                }}
                onPointerEnter={(event) => {
                  if (anchor.current && event.buttons === 1)
                    chooseRange(
                      anchor.current.page,
                      index,
                      anchor.current.selected,
                    );
                }}
                onPointerUp={() => {
                  anchor.current = null;
                }}
              >
                <button
                  type="button"
                  className="page-thumbnail-select"
                  aria-label={`Page ${index + 1}${isSelected ? ", selected" : ", not selected"}`}
                  aria-pressed={isSelected}
                  onClick={(event) => {
                    if (event.detail === 0)
                      chooseRange(index, index, !isSelected);
                  }}
                >
                  <PdfCanvas
                    pdf={pdf}
                    pageNumber={index + 1}
                    scale={0.32}
                    lazy
                  />
                  <span className="page-number">{index + 1}</span>
                  <span className="page-selected-mark" aria-hidden="true">
                    ✓
                  </span>
                </button>
                <button
                  type="button"
                  className="page-zoom"
                  aria-label={`Enlarge page ${index + 1}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setZoomPage(index + 1)}
                >
                  <ZoomIn size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {zoomPage && pdf && (
        <div
          className="page-zoom-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Page ${zoomPage} preview`}
          onClick={() => setZoomPage(null)}
        >
          <div
            className="page-zoom-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <b>Page {zoomPage}</b>
              <button
                type="button"
                aria-label="Close enlarged preview"
                onClick={() => setZoomPage(null)}
              >
                <X size={18} />
              </button>
            </div>
            <PdfCanvas pdf={pdf} pageNumber={zoomPage} scale={1.35} />
          </div>
        </div>
      )}
    </section>
  );
}
