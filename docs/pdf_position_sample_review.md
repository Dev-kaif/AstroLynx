# Positional PDF sample: excerpt review

Date: 2026-10-11  
Input: `/tmp/astrolynx-pdf-position-sample-2026-10-11.json` (56 local PDFs; first, middle, and last page; 167 extracted pages).  
Purpose: inspect examples behind the provisional page-quality decisions and identify calibration work. This is an exploratory reviewer pass over extracted excerpts, not a representative gold set or OCR/visual PDF review.

## Cases reviewed

| Source file | Page | Heuristic | Excerpt-level assessment | Ingestion implication |
|---|---:|---|---|---|
| `downloaded_docs/10-1752058902635.pdf` | 1 | review, score 1.0 | Readable cover; sparse text and OCR-like spacing (`SA tellite`, `M arine`). | Keep in review. A cover may provide title/context but should not be treated as a substantive evidence passage by itself. |
| `downloaded_docs/10-1752058902635.pdf` | 38 | reject, empty | No text layer in extracted output. | Quarantine from text chunks; candidate for page-targeted OCR. |
| `downloaded_docs/12-1752058974176.pdf` | 1 | reject, empty | No text layer. | Quarantine; inspect page image/OCR before any indexing. |
| `downloaded_docs/12-1752058974176.pdf` | 92 | review, `very_short_text` | Only page number `77` was extracted. | Reject as a standalone retrieval chunk or pair with adjacent page only through a structure-aware parser; do not embed the number alone. |
| `downloaded_docs/13109-1752058978296.pdf` | 2 | review, `private_use_glyphs` | Scientific correspondence prose and figure description are readable despite glyph noise. | Review is appropriate; do not reject solely on private-use glyph presence. Compare alternate parser output for these glyphs. |
| `downloaded_docs/13111-1752058970137.pdf` | 12 | review, `very_short_text` | Short but readable figure caption. | Keep out of standalone chunks unless associated with its figure/table or neighboring explanatory text. |
| `downloaded_docs/13125-1752058981486.pdf` | 23 | review, no signals | Figure labels/caption and equation-free surrounding content are legible but structurally sparse. | Preserve as caption/table metadata; review is safer than calling it a full prose passage. |
| `downloaded_docs/52-1752059045623.pdf` | 1 | review, `repeated_line_noise` | A report cover repeats its title/metadata around a date list. | Repetition signal is a useful review warning, but this example is not gibberish. Do not auto-reject on this signal alone. |
| `downloaded_docs/53-1752059021300.pdf` | 1 | review, `repeated_line_noise` | Readable cover/title block repeated by page layout. | Same: preserve as review/metadata, not standalone evidence. |
| `downloaded_docs/9-1752059087105.pdf` | 78 | review, no signals | Readable figure caption and surrounding text with poor spacing and scientific coordinates. | Current gate correctly avoids hard rejection; a layout-aware parser could improve usefulness. |
| `downloaded_docs/9-1752059087105.pdf` | 156 | review, `very_short_text` | Photo source and coordinates only. | Metadata/caption, not standalone retrieval evidence. |
| `downloaded_docs/ATBD-for-saphir-rain-ver2-1752238807619.pdf` | 27 | review, `private_use_glyphs` | Flowchart labels are readable, but displayed equations are severely damaged with NULs and replacement-like glyphs. | Do not embed as ordinary text. Route to alternate PDF extraction or page image/OCR review; OCR may not recover equations faithfully. |
| `downloaded_docs/Incremental-ATBD-12Feb2020-1752019399297.pdf` | 114 | reject, `control_character_noise` | Surrounding prose is readable, while equation symbols are replaced by NULs. | Reject the extracted page under text policy; investigate alternate parser and preserve page-level quarantine. Similar duplicate file has the same issue. |
| `downloaded_docs/INSAT_Product_Version_information_V01-1752238722925.pdf` | 1, 4, 7 | reject, empty | All three positional samples have no text layer. | Strong scanned/image-only candidate; inspect the file's actual page count/images before selecting OCR language/DPI. |
| `downloaded_docs/INSAT-3DS_Operational_Products_V1-1752238808651.pdf` | 1 | review, no signals | Readable title and document identifier, sparse cover metadata. | Keep as metadata; not enough to support product-detail answers. |
| `downloaded_docs/INSAT3D_COTS-1752238795625.pdf` | 1, 6 | review, `very_short_text` | Product-format title and a short list of software names. | Structured metadata/list; avoid treating the short-text signal as proof of gibberish. |

## Findings

- The inspected excerpts show no clear case where a page marked `usable` is obviously gibberish. This small, selected sample cannot establish a low false-accept rate.
- `reject` is currently a mixed bucket: some pages are truly empty at the text layer; others contain prose but have damaged equation glyphs. Both must be excluded from ordinary text embedding, but they need different remediation paths (OCR/image review versus alternate parser/equation-aware handling).
- `review` includes legitimate sparse covers, captions, tables, and figure labels. It is appropriate as a quarantine/review status, but short content should be typed as metadata/caption/table where possible rather than promoted automatically into standalone chunks.
- `private_use_glyphs` alone should not cause rejection: at least one sampled page contains readable scientific prose. The current policy correctly routes this to review.
- Duplicate source PDFs in the corpus can repeat the same quality examples; evaluation and aggregate reports should deduplicate by content hash or group duplicates before counting evidence.

## Next calibration steps

1. Visually inspect the PDF pages for the empty and equation-corrupted cases; excerpt review cannot establish whether a page is scanned or whether a parser lost an embedded text layer.
2. Add a targeted alternate-parser comparison for pages with control/private-use glyphs and record source hash, page, parser version, and text-quality signals.
3. Label more pages from several positions and document types, including known-good and known-bad examples from the historical crawl, before changing thresholds.
4. Keep `usable`/`review`/`reject` as provisional policy outcomes until that labeled comparison exists. No bulk embedding is approved by this review.
