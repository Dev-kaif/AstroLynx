import { load } from "cheerio";

export type MosdacCatalogKind = "satellite" | "radar";
export type MosdacCatalogStatus =
  | "catalog_rows_extracted"
  | "catalog_empty"
  | "catalog_schema_unrecognized"
  | "not_catalog_page";

export interface MosdacCatalogRow {
  productName: string | null;
  description: string | null;
  processingLevel: string | null;
  temporalResolution: string | null;
  startDate: string | null;
  endDate: string | null;
  processingStatus: string | null;
  doi: string | null;
  cells: Record<string, string>;
}

export interface MosdacCatalogExtraction {
  kind: MosdacCatalogKind | null;
  status: MosdacCatalogStatus;
  tableIndex: number | null;
  headers: string[];
  rows: MosdacCatalogRow[];
  ignoredRows: number;
  signals: string[];
}

const HEADER_ALIASES: Record<keyof Omit<MosdacCatalogRow, "cells">, string[]> = {
  productName: ["product", "product name", "product acq calendar", "product/acq calendar", "product / acq calendar", "product name acq calendar version", "name"],
  description: ["product description", "description"],
  processingLevel: ["processing level", "process level", "level"],
  temporalResolution: ["temporal resolution", "frequency", "temporal frequency"],
  startDate: ["start date", "startdate", "from date"],
  endDate: ["end date", "enddate", "to date"],
  processingStatus: ["processing status", "status"],
  doi: ["doi", "digital object identifier"],
};

function normalizeHeader(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function catalogKind(url: URL): MosdacCatalogKind | null {
  const pathname = url.pathname.toLowerCase();
  if (pathname.includes("satellite")) return "satellite";
  if (pathname.includes("radar")) return "radar";
  return null;
}

/** Extract catalog rows only when recognizable headers provide schema evidence. */
export function extractMosdacCatalog(
  html: string,
  sourceUrl: string
): MosdacCatalogExtraction {
  const kind = catalogKind(new URL(sourceUrl));
  if (!kind) {
    return {
      kind: null,
      status: "not_catalog_page",
      tableIndex: null,
      headers: [],
      rows: [],
      ignoredRows: 0,
      signals: [],
    };
  }

  const $ = load(html);
  let best: {
    index: number;
    headers: string[];
    headerCells: ReturnType<typeof $>[];
    rowElements: ReturnType<typeof $>[];
    recognized: number;
  } | null = null;

  $("table").each((index, table) => {
    const rows = $(table).find("tr").toArray();
    if (!rows.length) return;
    const headerRow = rows.find((row) => $(row).find("th").length > 0) ?? rows[0];
    const headerElements = $(headerRow).find("th, td").toArray();
    const headers = headerElements.map((cell) => normalizeHeader($(cell).text()));
    const recognized = headers.filter((header) =>
      Object.values(HEADER_ALIASES).some((aliases) => aliases.includes(header))
    ).length;
    if (!best || recognized > best.recognized) {
      const dataRows = rows.filter((row) => row !== headerRow && $(row).find("td").length > 0);
      best = {
        index,
        headers,
        headerCells: headerElements.map((cell) => $(cell)),
        rowElements: dataRows.map((row) => $(row)),
        recognized,
      };
    }
  });

  const productNameHeader = best?.headers.some((header) =>
    HEADER_ALIASES.productName.includes(header)
  ) ?? false;
  if (!best || !productNameHeader || best.recognized < 3) {
    return {
      kind,
      status: "catalog_schema_unrecognized",
      tableIndex: best?.index ?? null,
      headers: best?.headers ?? [],
      rows: [],
      ignoredRows: best?.rowElements.length ?? 0,
      signals: ["catalog_headers_not_recognized"],
    };
  }

  const headerNames = best.headers;
  const candidates = best.rowElements.map((row) => {
    const values = row.find("td").toArray().map((cell) => $(cell).text().trim());
    const cells: Record<string, string> = {};
    headerNames.forEach((header, index) => {
      if (header) cells[header] = values[index] ?? "";
    });

    const read = (field: keyof Omit<MosdacCatalogRow, "cells">): string | null => {
      const columnIndex = headerNames.findIndex((header) =>
        HEADER_ALIASES[field].includes(header)
      );
      const value = columnIndex >= 0 ? values[columnIndex]?.trim() : "";
      return value || null;
    };

    return {
      productName: read("productName"),
      description: read("description"),
      processingLevel: read("processingLevel"),
      temporalResolution: read("temporalResolution"),
      startDate: read("startDate"),
      endDate: read("endDate"),
      processingStatus: read("processingStatus"),
      doi: read("doi"),
      cells,
    };
  }).filter((row) => Object.values(row.cells).some((value) => value.trim().length > 0));

  const ignoredRows = candidates.filter((row) => {
    const combined = Object.values(row.cells).join(" ").trim();
    return !combined ||
      /no (?:data|products|records|results) available|no results found|loading(?:\.\.\.)?/iu.test(combined) ||
      /\{\{[^{}]{1,160}\}\}/u.test(combined);
  }).length;
  const rows = candidates.filter((row) => {
    const combined = Object.values(row.cells).join(" ").trim();
    return combined.length > 0 &&
      !/no (?:data|products|records|results) available|no results found|loading(?:\.\.\.)?/iu.test(combined) &&
      !/\{\{[^{}]{1,160}\}\}/u.test(combined);
  });

  const signals: string[] = [];
  if (best.recognized < 4) signals.push("partial_catalog_schema");
  if (rows.some((row) => !row.productName)) signals.push("row_missing_product_name");
  if (ignoredRows > 0) signals.push("empty_or_unresolved_rows_ignored");
  if (candidates.some((row) => row.productName?.includes("{{"))) {
    signals.push("unresolved_template_row");
  }

  return {
    kind,
    status: rows.length > 0 ? "catalog_rows_extracted" : "catalog_empty",
    tableIndex: best.index,
    headers: best.headers,
    rows,
    ignoredRows,
    signals,
  };
}
