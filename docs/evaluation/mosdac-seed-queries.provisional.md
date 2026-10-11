# Provisional MOSDAC retrieval seed set

`mosdac-seed-queries.provisional.json` is a diagnostic seed set, not a gold evaluation set. I created the queries and source/page labels after inspecting extracted text from the cited local PDF pages. The labels have not been independently adjudicated by a MOSDAC domain expert, and they do not claim exhaustive relevance judgments.

The ten questions cover three documents and only a small part of the 56-PDF inventory:

- `downloaded_docs/10-1752058902635.pdf` — `Eyes on Waves from Space`, pages 2 and 4.
- `downloaded_docs/13082-1752059060377.pdf` — 38th Indian Scientific Expedition to Antarctica report, page 2.
- `downloaded_docs/13088-1752059091450.pdf` — airborne L-band polarimetric calibration report, pages 2 and 3.
- `downloaded_docs/13090-1752058939294.pdf` — INSAT-3D visible-channel calibration report, page 2.

Source IDs are SHA-256 hashes from the PDF chunk plan. Labels target the page containing the relevant text; two page labels are assigned for the wave-atlas question because the title and summary are on different pages. Query wording includes paraphrases, but this is a small and selectively chosen set with lexical overlap and limited topic diversity. Use it to catch obvious regressions only.

To compare BM25 against dense or hybrid RRF, first add broader and independently reviewed question coverage: exact product identifiers, satellite/instrument specifications, table questions, multilingual paraphrases, multi-page synthesis, and unanswerable questions. Do not tune thresholds solely to this seed set.
