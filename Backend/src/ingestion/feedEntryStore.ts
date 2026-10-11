import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FeedEntry } from "./htmlExtractor";
import { acquireFileLock } from "./fileLock";

interface StoredFeedEntry {
  entryId: string;
  feedUrl: string;
  feedSourceId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
  entry: FeedEntry;
  inactiveAt?: string;
}

interface FeedManifest {
  version: 1;
  feedUrl: string;
  lastCompleteSnapshotAt: string;
  lastCompleteContentHash: string;
  activeEntryIds: string[];
}

export interface PersistFeedSnapshotResult {
  entryCount: number;
  newEntries: number;
  updatedEntries: number;
  unchangedEntries: number;
  markedInactive: number;
  manifestPath: string;
}

function idForFeed(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 40);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Persist a complete feed snapshot without deleting records absent from the newest snapshot. */
export async function persistFeedSnapshot(options: {
  outputDirectory: string;
  feedUrl: string;
  feedSourceId: string;
  fetchedAt: string;
  contentHash: string;
  entries: FeedEntry[];
}): Promise<PersistFeedSnapshotResult> {
  if (options.entries.length === 0) {
    throw new Error("Refusing to reconcile an empty feed snapshot");
  }

  const feedId = idForFeed(options.feedUrl);
  const feedDirectory = path.join(options.outputDirectory, "feeds", feedId);
  const releaseLock = await acquireFileLock(path.join(feedDirectory, ".writer.lock"));
  try {
  const entriesDirectory = path.join(feedDirectory, "entries");
  const manifestPath = path.join(feedDirectory, "manifest.json");
  const previousManifest = await readJson<FeedManifest>(manifestPath);
  if (previousManifest && (
    previousManifest.version !== 1 ||
    previousManifest.feedUrl !== options.feedUrl ||
    !Array.isArray(previousManifest.activeEntryIds) ||
    previousManifest.activeEntryIds.some((entryId) => !/^[a-f0-9]{64}$/u.test(entryId))
  )) {
    throw new Error(`Invalid stored feed manifest: ${manifestPath}`);
  }

  const uniqueEntries = new Map<string, FeedEntry>();
  for (const entry of options.entries) {
    if (!/^[a-f0-9]{64}$/u.test(entry.entryId)) {
      throw new Error("Feed entry is missing a valid stable SHA-256 ID");
    }
    if (uniqueEntries.has(entry.entryId)) {
      throw new Error(`Feed snapshot contains duplicate entry ID: ${entry.entryId}`);
    }
    uniqueEntries.set(entry.entryId, entry);
  }

  let newEntries = 0;
  let updatedEntries = 0;
  let unchangedEntries = 0;
  const activeIds = [...uniqueEntries.keys()].sort();
  for (const [entryId, entry] of uniqueEntries) {
    const recordPath = path.join(entriesDirectory, `${entryId}.json`);
    const existing = await readJson<StoredFeedEntry>(recordPath);
    const next: StoredFeedEntry = {
      entryId,
      feedUrl: options.feedUrl,
      feedSourceId: options.feedSourceId,
      firstSeenAt: existing?.firstSeenAt ?? options.fetchedAt,
      lastSeenAt: options.fetchedAt,
      active: true,
      entry,
    };
    const contentUnchanged = existing?.active === true &&
      JSON.stringify(existing.entry) === JSON.stringify(entry) &&
      existing.feedSourceId === options.feedSourceId;
    if (contentUnchanged) unchangedEntries += 1;
    else if (!existing) newEntries += 1;
    else updatedEntries += 1;
    await writeAtomic(recordPath, next);
  }

  const currentIds = new Set(activeIds);
  let markedInactive = 0;
  for (const entryId of previousManifest?.activeEntryIds ?? []) {
    if (currentIds.has(entryId)) continue;
    const recordPath = path.join(entriesDirectory, `${entryId}.json`);
    const existing = await readJson<StoredFeedEntry>(recordPath);
    if (!existing || !existing.active) continue;
    await writeAtomic(recordPath, { ...existing, active: false, inactiveAt: options.fetchedAt });
    markedInactive += 1;
  }

  await writeAtomic(manifestPath, {
    version: 1,
    feedUrl: options.feedUrl,
    lastCompleteSnapshotAt: options.fetchedAt,
    lastCompleteContentHash: options.contentHash,
    activeEntryIds: activeIds,
  } satisfies FeedManifest);

  return {
    entryCount: activeIds.length,
    newEntries,
    updatedEntries,
    unchangedEntries,
    markedInactive,
    manifestPath,
  };
  } finally {
    await releaseLock();
  }
}
