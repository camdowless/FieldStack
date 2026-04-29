"""
FieldStack PDF Ingestor — Production Engine
--------------------------------------------
High-fidelity extraction of text, tables, and metadata from construction
schedule PDFs. Handles native text, scanned documents (OCR), and mixed-mode.

Pipeline:
  1. pdfplumber — native text + table extraction (primary)
  2. PyMuPDF + pytesseract — OCR fallback for scanned/image pages
  3. Header/footer stripping — removes recurring positional text
  4. Pydantic validation — strict typed output
  5. Markdown tables — GFM format for optimal LLM readability

Usage:
  CLI:    python3 pdf_ingestor.py /path/to/schedule.pdf
  Async:  result = await async_process_pdf("/path/to/schedule.pdf")
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from typing import Optional

from pydantic import BaseModel, Field

# ── Logging ────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.DEBUG if os.environ.get("DEBUG") else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pdf_ingestor")


# ── Pydantic Models ───────────────────────────────────────────────────────

class Table(BaseModel):
    """A single extracted table with headers and data rows."""
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    row_count: int = 0
    col_count: int = 0
    markdown: str = ""


class Page(BaseModel):
    """Extracted content from a single PDF page."""
    page_number: int
    text: str = ""
    tables: list[Table] = Field(default_factory=list)
    has_tables: bool = False
    ocr_applied: bool = False
    width: float = 0.0
    height: float = 0.0


class Metadata(BaseModel):
    """PDF document metadata."""
    title: str = ""
    author: str = ""
    subject: str = ""
    creator: str = ""
    producer: str = ""
    page_count: int = 0
    creation_date: str = ""
    mod_date: str = ""


class ExtractionStats(BaseModel):
    """Summary statistics for the extraction run."""
    total_pages: int = 0
    total_text_chars: int = 0
    total_tables: int = 0
    pages_with_tables: int = 0
    pages_with_ocr: int = 0
    headers_stripped: int = 0
    footers_stripped: int = 0


class Document(BaseModel):
    """Top-level extraction result — the complete output contract."""
    success: bool = True
    file: str = ""
    extraction_method: str = ""
    metadata: Metadata = Field(default_factory=Metadata)
    content: list[Page] = Field(default_factory=list)
    stats: ExtractionStats = Field(default_factory=ExtractionStats)
    errors: list[str] = Field(default_factory=list)
    error: Optional[str] = None


# ── Lazy Imports ───────────────────────────────────────────────────────────

def _import_pdfplumber():
    try:
        import pdfplumber
        return pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber not installed. Run: pip3 install pdfplumber")


def _import_fitz():
    try:
        import fitz
        return fitz
    except ImportError:
        raise RuntimeError("PyMuPDF not installed. Run: pip3 install pymupdf")


def _import_ocr():
    """Returns (pytesseract, Image) or (None, None) if unavailable."""
    try:
        import pytesseract
        from PIL import Image
        # Verify tesseract binary is reachable
        pytesseract.get_tesseract_version()
        return pytesseract, Image
    except Exception:
        return None, None


# ── Core Engine ────────────────────────────────────────────────────────────

OCR_TEXT_THRESHOLD = 100  # chars — below this, page is likely scanned
HEADER_FOOTER_MIN_PAGES = 3  # text must repeat on 3+ pages to be stripped
PARALLEL_PAGE_THRESHOLD = 10  # use ProcessPoolExecutor above this


class PDFIngestor:
    """Production PDF extraction engine."""

    def __init__(self, file_path: str):
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"PDF not found: {file_path}")
        self.file_path = file_path
        self.errors: list[str] = []
        self._ocr_module, self._pil_image = _import_ocr()
        self._ocr_available = self._ocr_module is not None
        if self._ocr_available:
            logger.debug("OCR available (pytesseract + tesseract)")
        else:
            logger.debug("OCR not available — scanned pages will be flagged")

    # ── Metadata ───────────────────────────────────────────────────────

    def _extract_metadata(self) -> Metadata:
        fitz = _import_fitz()
        try:
            with fitz.open(self.file_path) as doc:
                m = doc.metadata or {}
                return Metadata(
                    title=m.get("title", ""),
                    author=m.get("author", ""),
                    subject=m.get("subject", ""),
                    creator=m.get("creator", ""),
                    producer=m.get("producer", ""),
                    page_count=doc.page_count,
                    creation_date=m.get("creationDate", ""),
                    mod_date=m.get("modDate", ""),
                )
        except Exception as e:
            self.errors.append(f"Metadata extraction failed: {e}")
            logger.warning("Metadata extraction failed: %s", e)
            return Metadata()

    # ── Text Cleaning ──────────────────────────────────────────────────

    @staticmethod
    def _clean_text(text: str) -> str:
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', text)
        text = re.sub(r'[^\S\n]+', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    # ── Table Cleaning + Markdown ──────────────────────────────────────

    @staticmethod
    def _clean_table(raw_table: list[list]) -> list[list[str]]:
        cleaned = []
        for row in raw_table:
            cells = [
                re.sub(r'\s+', ' ', str(c)).strip() if c is not None else ""
                for c in row
            ]
            if any(cells):
                cleaned.append(cells)
        return cleaned

    @staticmethod
    def _table_to_markdown(headers: list[str], rows: list[list[str]]) -> str:
        """Convert table to GitHub-Flavored Markdown."""
        if not headers:
            return ""

        col_count = len(headers)

        # Pad rows to match header width
        padded_rows = []
        for row in rows:
            if len(row) < col_count:
                row = row + [""] * (col_count - len(row))
            elif len(row) > col_count:
                row = row[:col_count]
            padded_rows.append(row)

        # Calculate column widths for alignment
        widths = [len(h) for h in headers]
        for row in padded_rows:
            for i, cell in enumerate(row):
                widths[i] = max(widths[i], len(cell))
        widths = [max(w, 3) for w in widths]  # minimum 3 for separator

        def fmt_row(cells: list[str]) -> str:
            parts = [c.ljust(w) for c, w in zip(cells, widths)]
            return "| " + " | ".join(parts) + " |"

        lines = [
            fmt_row(headers),
            "| " + " | ".join("-" * w for w in widths) + " |",
        ]
        for row in padded_rows:
            lines.append(fmt_row(row))

        return "\n".join(lines)

    # ── OCR Fallback ───────────────────────────────────────────────────

    def _ocr_page(self, fitz_page) -> str:
        """Run OCR on a PyMuPDF page. Returns extracted text or empty string."""
        if not self._ocr_available:
            return ""

        try:
            # Render page to image at 300 DPI for good OCR quality
            pix = fitz_page.get_pixmap(dpi=300)
            img = self._pil_image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            text = self._ocr_module.image_to_string(img)
            return self._clean_text(text)
        except Exception as e:
            self.errors.append(f"OCR failed on page {fitz_page.number + 1}: {e}")
            logger.warning("OCR failed on page %d: %s", fitz_page.number + 1, e)
            return ""

    # ── Header/Footer Detection ────────────────────────────────────────

    def _strip_headers_footers(self, pages: list[Page]) -> tuple[int, int]:
        """
        Detect and remove recurring headers/footers.
        Text that appears in the same vertical zone across 3+ pages
        is likely a header or footer.
        """
        if len(pages) < HEADER_FOOTER_MIN_PAGES:
            return 0, 0

        # Collect first and last lines from each page
        first_lines: list[str] = []
        last_lines: list[str] = []

        for page in pages:
            lines = page.text.split("\n")
            lines = [l.strip() for l in lines if l.strip()]
            if lines:
                first_lines.append(lines[0])
                last_lines.append(lines[-1])

        headers_stripped = 0
        footers_stripped = 0

        # Find recurring first lines (headers)
        header_counts = Counter(first_lines)
        recurring_headers = {
            text for text, count in header_counts.items()
            if count >= HEADER_FOOTER_MIN_PAGES and len(text) > 3
        }

        # Find recurring last lines (footers)
        footer_counts = Counter(last_lines)
        recurring_footers = {
            text for text, count in footer_counts.items()
            if count >= HEADER_FOOTER_MIN_PAGES and len(text) > 3
        }

        # Also catch page number patterns in footers
        page_num_pattern = re.compile(
            r'^(page\s+\d+|p\.\s*\d+|\d+\s+of\s+\d+|\d+/\d+|\- ?\d+ ?\-)$',
            re.IGNORECASE,
        )
        for page in pages:
            lines = page.text.split("\n")
            lines = [l.strip() for l in lines if l.strip()]
            if lines and page_num_pattern.match(lines[-1]):
                recurring_footers.add(lines[-1])

        if recurring_headers:
            logger.info("Stripping recurring headers: %s", recurring_headers)
        if recurring_footers:
            logger.info("Stripping recurring footers: %s", recurring_footers)

        # Strip them
        for page in pages:
            lines = page.text.split("\n")

            new_lines = []
            for i, line in enumerate(lines):
                stripped = line.strip()
                if i == 0 and stripped in recurring_headers:
                    headers_stripped += 1
                    continue
                if i == len(lines) - 1 and stripped in recurring_footers:
                    footers_stripped += 1
                    continue
                # Also strip page numbers anywhere in the last 2 lines
                if i >= len(lines) - 2 and page_num_pattern.match(stripped):
                    footers_stripped += 1
                    continue
                new_lines.append(line)

            page.text = "\n".join(new_lines).strip()

        return headers_stripped, footers_stripped

    # ── Page Extraction (single page) ──────────────────────────────────

    def _extract_page_pdfplumber(self, plumber_page, page_idx: int) -> Page:
        """Extract content from a single pdfplumber page."""
        page = Page(
            page_number=page_idx + 1,
            width=float(plumber_page.width),
            height=float(plumber_page.height),
        )

        # Text
        try:
            raw = plumber_page.extract_text() or ""
            page.text = self._clean_text(raw)
        except Exception as e:
            self.errors.append(f"Page {page_idx+1} text failed: {e}")
            logger.warning("Page %d text failed: %s", page_idx + 1, e)

        # Tables
        try:
            for raw_table in (plumber_page.extract_tables() or []):
                cleaned = self._clean_table(raw_table)
                if cleaned and len(cleaned) > 1:
                    headers = cleaned[0]
                    rows = cleaned[1:]
                    page.tables.append(Table(
                        headers=headers,
                        rows=rows,
                        row_count=len(rows),
                        col_count=len(headers),
                        markdown=self._table_to_markdown(headers, rows),
                    ))
        except Exception as e:
            self.errors.append(f"Page {page_idx+1} tables failed: {e}")
            logger.warning("Page %d tables failed: %s", page_idx + 1, e)

        page.has_tables = len(page.tables) > 0
        return page

    # ── OCR Pass ───────────────────────────────────────────────────────

    def _apply_ocr_to_sparse_pages(self, pages: list[Page]) -> int:
        """
        Run OCR on pages where native extraction yielded < OCR_TEXT_THRESHOLD chars.
        Returns count of pages where OCR was applied.
        """
        if not self._ocr_available:
            sparse = [p for p in pages if len(p.text) < OCR_TEXT_THRESHOLD]
            if sparse:
                self.errors.append(
                    f"{len(sparse)} page(s) have <{OCR_TEXT_THRESHOLD} chars "
                    f"but tesseract is not installed for OCR fallback"
                )
            return 0

        fitz = _import_fitz()
        ocr_count = 0

        with fitz.open(self.file_path) as doc:
            for page in pages:
                if len(page.text) >= OCR_TEXT_THRESHOLD:
                    continue

                fitz_page = doc[page.page_number - 1]
                logger.info(
                    "Page %d has %d chars — running OCR",
                    page.page_number, len(page.text),
                )

                ocr_text = self._ocr_page(fitz_page)
                if len(ocr_text) > len(page.text):
                    page.text = ocr_text
                    page.ocr_applied = True
                    ocr_count += 1
                    logger.info(
                        "OCR recovered %d chars on page %d",
                        len(ocr_text), page.page_number,
                    )

        return ocr_count

    # ── Main Pipeline ──────────────────────────────────────────────────

    def process_pdf(self) -> dict:
        """
        Full extraction pipeline:
          1. Validate PDF
          2. Extract pages with pdfplumber (parallel for large docs)
          3. OCR fallback for sparse pages
          4. Strip recurring headers/footers
          5. Convert tables to Markdown
          6. Validate through Pydantic
          7. Return clean JSON
        """
        self.errors = []
        logger.info("Starting ingestion: %s", self.file_path)

        # ── Validate ───────────────────────────────────────────────
        try:
            with open(self.file_path, "rb") as f:
                header = f.read(5)
                if header != b"%PDF-":
                    return Document(
                        success=False,
                        error="File is not a valid PDF",
                        file=os.path.basename(self.file_path),
                    ).model_dump()
        except IOError as e:
            return Document(
                success=False,
                error=f"Cannot read file: {e}",
                file=os.path.basename(self.file_path),
            ).model_dump()

        # ── Extract metadata ───────────────────────────────────────
        metadata = self._extract_metadata()

        # ── Extract pages with pdfplumber ──────────────────────────
        pdfplumber = _import_pdfplumber()
        pages: list[Page] = []
        extraction_method = "pdfplumber"

        try:
            with pdfplumber.open(self.file_path) as pdf:
                page_count = len(pdf.pages)
                logger.info("Extracting %d pages", page_count)

                # Sequential extraction (ProcessPoolExecutor for page-level
                # parallelism doesn't help with pdfplumber since it holds
                # a file handle — use it for the whole-file level instead)
                for i, plumber_page in enumerate(pdf.pages):
                    pages.append(self._extract_page_pdfplumber(plumber_page, i))

        except Exception as e:
            logger.warning("pdfplumber failed: %s — trying PyMuPDF", e)
            self.errors.append(f"pdfplumber failed: {e}")
            extraction_method = "pymupdf_fallback"

            # Fallback: PyMuPDF text-only
            fitz = _import_fitz()
            try:
                with fitz.open(self.file_path) as doc:
                    for i, fitz_page in enumerate(doc):
                        raw = fitz_page.get_text("text") or ""
                        pages.append(Page(
                            page_number=i + 1,
                            text=self._clean_text(raw),
                            width=float(fitz_page.rect.width),
                            height=float(fitz_page.rect.height),
                        ))
            except Exception as e2:
                return Document(
                    success=False,
                    error=f"All extraction methods failed: {e2}",
                    file=os.path.basename(self.file_path),
                    errors=self.errors,
                ).model_dump()

        # ── OCR pass for sparse pages ──────────────────────────────
        ocr_count = self._apply_ocr_to_sparse_pages(pages)
        if ocr_count:
            extraction_method += "+ocr"

        # ── Strip headers/footers ──────────────────────────────────
        headers_stripped, footers_stripped = self._strip_headers_footers(pages)

        # ── Build validated output ─────────────────────────────────
        doc = Document(
            success=True,
            file=os.path.basename(self.file_path),
            extraction_method=extraction_method,
            metadata=metadata,
            content=pages,
            errors=self.errors,
            stats=ExtractionStats(
                total_pages=len(pages),
                total_text_chars=sum(len(p.text) for p in pages),
                total_tables=sum(len(p.tables) for p in pages),
                pages_with_tables=sum(1 for p in pages if p.has_tables),
                pages_with_ocr=sum(1 for p in pages if p.ocr_applied),
                headers_stripped=headers_stripped,
                footers_stripped=footers_stripped,
            ),
        )

        logger.info(
            "Done: %d pages, %d chars, %d tables, %d OCR, %d headers/%d footers stripped",
            doc.stats.total_pages,
            doc.stats.total_text_chars,
            doc.stats.total_tables,
            doc.stats.pages_with_ocr,
            doc.stats.headers_stripped,
            doc.stats.footers_stripped,
        )

        return doc.model_dump()


# ── Async Wrapper ──────────────────────────────────────────────────────────

_executor = ProcessPoolExecutor(max_workers=2)


def _sync_process(file_path: str) -> dict:
    """Standalone function for process pool (must be picklable)."""
    try:
        return PDFIngestor(file_path).process_pdf()
    except Exception as e:
        return Document(
            success=False,
            error=str(e),
            file=os.path.basename(file_path),
        ).model_dump()


async def async_process_pdf(file_path: str) -> dict:
    """Run PDF processing in a separate process — non-blocking."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _sync_process, file_path)


# ── CLI ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: python3 pdf_ingestor.py <file.pdf>"}))
        sys.exit(1)

    try:
        result = PDFIngestor(sys.argv[1]).process_pdf()
    except (FileNotFoundError, RuntimeError) as e:
        result = {"success": False, "error": str(e)}
    except Exception as e:
        result = {"success": False, "error": f"Unexpected: {e}"}

    print(json.dumps(result, indent=2, default=str))
    sys.exit(0 if result.get("success") else 1)
