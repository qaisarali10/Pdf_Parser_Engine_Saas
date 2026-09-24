import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { env } from "../config/env.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  processEntities: false
});

const MAX_ZIP_ENTRIES = 2000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

function invalidWorkbook(message) {
  const error = new Error(message);
  error.code = "INVALID_WORKBOOK";
  return error;
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnIndex(cellRef = "") {
  const letters = String(cellRef).replace(/[0-9]/g, "").toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index || 1;
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function rowNumber(cellRef = "") {
  const number = Number(String(cellRef).replace(/[A-Z]/gi, ""));
  return Number.isFinite(number) ? number : 1;
}

function richText(si) {
  if (!si) return "";
  if (si.t !== undefined) return typeof si.t === "object" ? si.t.text || "" : si.t;
  return arrayOf(si.r).map((run) => {
    if (run.t === undefined) return "";
    return typeof run.t === "object" ? run.t.text || "" : run.t;
  }).join("");
}

async function readXml(zip, filePath) {
  const file = zip.file(filePath);
  if (!file) return null;
  return parser.parse(await file.async("string"));
}

async function readSharedStrings(zip) {
  const xml = await readXml(zip, "xl/sharedStrings.xml");
  if (!xml?.sst?.si) return [];
  return arrayOf(xml.sst.si).map(richText);
}

async function firstWorksheetPath(zip) {
  const workbook = await readXml(zip, "xl/workbook.xml");
  const rels = await readXml(zip, "xl/_rels/workbook.xml.rels");
  const firstSheet = arrayOf(workbook?.workbook?.sheets?.sheet)[0];
  const relationId = firstSheet?.["r:id"];
  const relationships = arrayOf(rels?.Relationships?.Relationship);
  const relationship = relationships.find((item) => item.Id === relationId);
  const target = relationship?.Target || "worksheets/sheet1.xml";
  return `xl/${target.replace(/^\/?xl\//, "")}`;
}

function cellText(cell, sharedStrings) {
  if (!cell) return "";
  if (cell.t === "inlineStr") return richText(cell.is);
  if (cell.t === "s") return sharedStrings[Number(cell.v)] || "";
  if (cell.t === "b") return Number(cell.v) === 1;
  if (cell.v === undefined || cell.v === null) return "";
  if (cell.t === "str") return String(cell.v);
  const numeric = Number(cell.v);
  return Number.isFinite(numeric) ? numeric : String(cell.v);
}

export async function excelRowsFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw invalidWorkbook("The uploaded file is not a valid XLSX workbook.");
  }
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) throw invalidWorkbook("The workbook contains too many files.");
  const uncompressedBytes = entries.reduce((total, entry) => total + Number(entry?._data?.uncompressedSize || 0), 0);
  if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw invalidWorkbook("The workbook is too large when decompressed.");
  const [sharedStrings, worksheetPath] = await Promise.all([
    readSharedStrings(zip),
    firstWorksheetPath(zip)
  ]);
  const xml = await readXml(zip, worksheetPath);
  const sheetRows = arrayOf(xml?.worksheet?.sheetData?.row);
  if (!sheetRows.length) return [];
  if (sheetRows.length - 1 > env.maxSpreadsheetRows) {
    throw invalidWorkbook(`The workbook exceeds the ${env.maxSpreadsheetRows} row limit.`);
  }

  const parsedRows = sheetRows
    .map((row) => {
      const values = {};
      for (const cell of arrayOf(row.c)) {
        values[columnIndex(cell.r)] = cellText(cell, sharedStrings);
      }
      return { number: Number(row.r) || rowNumber(arrayOf(row.c)[0]?.r), values };
    })
    .sort((a, b) => a.number - b.number);

  const [headerRow, ...dataRows] = parsedRows;
  const headers = headerRow.values;

  return dataRows.map((row) => {
    const record = {};
    let hasValue = false;
    for (const [column, header] of Object.entries(headers)) {
      const cleanHeader = String(header || "").trim();
      if (!cleanHeader) continue;
      const value = row.values[column] ?? "";
      record[cleanHeader] = value;
      if (value !== "" && value !== null && value !== undefined) hasValue = true;
    }
    return hasValue ? record : null;
  }).filter(Boolean);
}

export function hasExcelExtension(filename = "") {
  return /\.xlsx$/i.test(filename);
}

export function normalizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value])
  );
}

export function assertRequiredColumns(rows, requiredColumns) {
  if (!rows.length) {
    return { ok: false, message: "The uploaded file has no rows." };
  }

  const availableColumns = new Set(Object.keys(normalizeRow(rows[0])));
  const missing = requiredColumns.filter((column) => !availableColumns.has(column.toLowerCase()));

  if (missing.length) {
    return { ok: false, message: `Missing columns: ${missing.join(", ")}` };
  }

  return { ok: true, message: "" };
}

function sheetXml(rows) {
  const xmlRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndexValue) => {
      const ref = `${columnName(columnIndexValue + 1)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>${xmlRows}</sheetData>
</worksheet>`;
}

export async function missingAliasesWorkbook(missingAliases) {
  const zip = new JSZip();
  const rows = [["Missing Aliases"], ...missingAliases.map((alias) => [alias])];

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.folder("docProps").file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Missing Aliases</dc:title>
  <dc:creator>SSR SaaS</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`);
  zip.folder("docProps").file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>SSR SaaS</Application>
</Properties>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Missing Aliases" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", sheetXml(rows));

  return zip.generateAsync({ type: "nodebuffer" });
}
