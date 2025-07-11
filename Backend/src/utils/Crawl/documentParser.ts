// src/documentParser.ts

import axios from "axios";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { URL } from "url";

// Directories
const TEMP_DOWNLOAD_DIR = path.join(__dirname, "..", "temp_downloads");
export const PERMANENT_DOWNLOAD_DIR = path.join(__dirname, "..", "downloaded_docs");

async function ensureDirExists(dirPath: string): Promise<void> {
    await fsp.mkdir(dirPath, { recursive: true });
}

export async function downloadFile(url: string, filePath: string): Promise<string | null> {
    try {
        const response = await axios({
            url,
            method: "GET",
            responseType: "stream",
            timeout: 90000,
        });

        if (response.status !== 200) {
            console.error(`[Doc Parser] Failed to download ${url}. Status: ${response.status}`);
            return null;
        }

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on("finish", () => resolve(filePath));
            writer.on("error", err => {
                console.error(`[Doc Parser ERROR] Error writing ${filePath} from ${url}:`, err);
                reject(null);
            });
        });
    } catch (error: any) {
        console.error(`[Doc Parser ERROR] Error downloading ${url}: ${error.message || error}`);
        return null;
    }
}

export async function extractTextFromPdf(filePath: string): Promise<string | null> {
    try {
        console.log(`[Doc Parser] Extracting text from PDF: ${filePath}`);
        const dataBuffer = await fsp.readFile(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text;
    } catch (error: any) {
        console.error(`[Doc Parser ERROR] PDF extract error ${filePath}: ${error.message || error}`);
        return null;
    }
}

export async function extractTextFromDocx(filePath: string): Promise<string | null> {
    try {
        console.log(`[Doc Parser] Extracting text from DOCX: ${filePath}`);
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value || null;
    } catch (error: any) {
        console.error(`[Doc Parser ERROR] DOCX extract error ${filePath}: ${error.message || error}`);
        return null;
    }
}

export async function extractTextFromXlsx(filePath: string): Promise<string | null> {
    try {
        console.log(`[Doc Parser] Extracting text from XLSX: ${filePath}`);
        const workbook = XLSX.readFile(filePath);
        return workbook.SheetNames.map(sheetName => {
            const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
            return `--- ${sheetName} ---\n${csv}`;
        }).join("\n\n");
    } catch (error: any) {
        console.error(`[Doc Parser ERROR] XLSX extract error ${filePath}: ${error.message || error}`);
        return null;
    }
}

export async function processDocumentLink(
    docUrl: string,
    docType: "pdf" | "docx" | "xlsx" | "unknown",
    maxParseSizeBytes: number,
    onComplete?: () => void
): Promise<{ text: string | null; downloadedPath: string | null } | null> {
    try {
        await ensureDirExists(TEMP_DOWNLOAD_DIR);
        await ensureDirExists(PERMANENT_DOWNLOAD_DIR);

        const urlParts = new URL(docUrl);
        const baseFileName = path.basename(urlParts.pathname).split(".")[0] || "downloaded_file";
        const extension = docType;
        const tempFileName = `${baseFileName}-${Date.now()}-temp.${extension}`;
        const tempFilePath = path.join(TEMP_DOWNLOAD_DIR, tempFileName);

        console.log(`[Doc Parser] Processing ${docType.toUpperCase()} document: ${docUrl}`);
        console.log(`[Doc Parser] Downloading to: ${tempFilePath}`);

        const downloadedPath = await downloadFile(docUrl, tempFilePath);
        if (!downloadedPath) {
            onComplete?.();
            return null;
        }

        const { size } = await fsp.stat(downloadedPath);
        console.log(`[Doc Parser] Downloaded file size: ${size} bytes`);

        if (size > maxParseSizeBytes) {
            const permanentFileName = `${baseFileName}-${Date.now()}.${extension}`;
            const permanentFilePath = path.join(PERMANENT_DOWNLOAD_DIR, permanentFileName);

            await fsp.rename(downloadedPath, permanentFilePath);
            console.log(`[Doc Parser] Saved large document to: ${permanentFilePath}`);

            onComplete?.(); // ✅ Ensure decrement on skip
            return { text: null, downloadedPath: permanentFilePath };
        }

        console.log(`[Doc Parser] File within parse limit (${size} bytes). Extracting text.`);
        let extractedText: string | null = null;

        switch (docType) {
            case "pdf":
                extractedText = await extractTextFromPdf(downloadedPath);
                break;
            case "docx":
                extractedText = await extractTextFromDocx(downloadedPath);
                break;
            case "xlsx":
                extractedText = await extractTextFromXlsx(downloadedPath);
                break;
            default:
                console.warn(`[Doc Parser WARN] Unsupported type: ${docType} (${docUrl})`);
                break;
        }

        await fsp.unlink(downloadedPath).catch(() => {});

        onComplete?.(); // ✅ Ensure decrement after parsing
        return { text: extractedText, downloadedPath: null };
    } catch (error: any) {
        console.error(`[Doc Parser ERROR] Unexpected error processing ${docUrl}: ${error.message || error}`);
        onComplete?.(); // ✅ Ensure decrement even on error
        return null;
    }
}
