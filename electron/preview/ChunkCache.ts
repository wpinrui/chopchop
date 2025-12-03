/**
 * Chunk Cache Manager
 *
 * Manages persistent storage of pre-rendered preview chunks.
 * Handles cache validation, invalidation, and cleanup.
 *
 * Cache identification uses both:
 * - Project file mtime (quick check)
 * - Content hash per chunk (accuracy)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';
import type {
  ChunkInfo,
  ChunkStatus,
  CacheManifest,
  ChunkManifestEntry,
  Timeline,
  MediaItem,
  Clip,
  ProjectSettings,
} from './types';
import { analyzeSegmentComplexity } from './complexityDetector';

const MANIFEST_VERSION = 1;
const MANIFEST_FILENAME = 'manifest.json';

export class ChunkCache {
  private cacheDir: string;
  private manifest: CacheManifest | null = null;
  private chunkDuration: number;

  constructor(chunkDuration: number = 2) {
    this.chunkDuration = chunkDuration;
    this.cacheDir = this.getDefaultCacheDir();
  }

  /**
   * Get the default cache directory
   */
  private getDefaultCacheDir(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'chunk-cache');
  }

  /**
   * Initialize the cache for a project
   */
  async initialize(
    timeline: Timeline,
    media: MediaItem[],
    settings: ProjectSettings,
    duration: number,
    projectPath: string | null
  ): Promise<ChunkInfo[]> {
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    const projectHash = this.computeProjectHash(projectPath);
    const projectMtime = projectPath ? this.getFileMtime(projectPath) : Date.now();

    // Try to load existing manifest
    const existingManifest = this.loadManifest();

    // Check if we can reuse existing cache
    if (existingManifest && this.canReuseCache(existingManifest, projectHash, projectMtime, settings, duration)) {
      this.manifest = existingManifest;
      return this.validateChunks(timeline, media, duration);
    }

    // Create new manifest
    this.manifest = {
      version: MANIFEST_VERSION,
      projectHash,
      projectMtime,
      chunkDuration: this.chunkDuration,
      totalDuration: duration,
      resolution: settings.resolution,
      frameRate: settings.frameRate,
      chunks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Build chunk info
    const chunks = this.buildChunkInfo(timeline, media, duration);

    // Save manifest
    this.saveManifest();

    return chunks;
  }

  /**
   * Build chunk info for the timeline
   */
  private buildChunkInfo(
    timeline: Timeline,
    media: MediaItem[],
    duration: number
  ): ChunkInfo[] {
    const numChunks = Math.ceil(duration / this.chunkDuration);
    const chunks: ChunkInfo[] = [];

    for (let i = 0; i < numChunks; i++) {
      const startTime = i * this.chunkDuration;
      const endTime = Math.min((i + 1) * this.chunkDuration, duration);

      const complexity = analyzeSegmentComplexity(timeline, startTime, endTime);
      const contentHash = this.computeChunkHash(timeline, media, startTime, endTime);

      // Check if we have a cached file for this hash
      const existingEntry = this.manifest?.chunks.find(
        (c) => c.index === i && c.contentHash === contentHash
      );

      let status: ChunkStatus = 'missing';
      let filePath: string | null = null;

      if (existingEntry) {
        const cachedPath = path.join(this.cacheDir, existingEntry.fileName);
        if (fs.existsSync(cachedPath)) {
          status = 'valid';
          filePath = cachedPath;
        }
      }

      chunks.push({
        index: i,
        startTime,
        endTime,
        status,
        filePath,
        contentHash,
        isComplex: complexity.isComplex,
      });
    }

    return chunks;
  }

  /**
   * Validate existing chunks against current timeline state
   */
  private validateChunks(
    timeline: Timeline,
    media: MediaItem[],
    duration: number
  ): ChunkInfo[] {
    const numChunks = Math.ceil(duration / this.chunkDuration);
    const chunks: ChunkInfo[] = [];

    for (let i = 0; i < numChunks; i++) {
      const startTime = i * this.chunkDuration;
      const endTime = Math.min((i + 1) * this.chunkDuration, duration);

      const complexity = analyzeSegmentComplexity(timeline, startTime, endTime);
      const contentHash = this.computeChunkHash(timeline, media, startTime, endTime);

      // Find existing manifest entry
      const existingEntry = this.manifest?.chunks.find((c) => c.index === i);

      let status: ChunkStatus = 'missing';
      let filePath: string | null = null;

      if (existingEntry) {
        const cachedPath = path.join(this.cacheDir, existingEntry.fileName);

        if (existingEntry.contentHash === contentHash && fs.existsSync(cachedPath)) {
          // Hash matches and file exists - valid
          status = 'valid';
          filePath = cachedPath;
        } else if (fs.existsSync(cachedPath)) {
          // Hash changed but file exists - stale
          status = 'stale';
          // Delete the stale file
          try {
            fs.unlinkSync(cachedPath);
          } catch {
            // Ignore deletion errors
          }
        }
      }

      chunks.push({
        index: i,
        startTime,
        endTime,
        status,
        filePath,
        contentHash,
        isComplex: complexity.isComplex,
      });
    }

    return chunks;
  }

  /**
   * Check if we can reuse an existing cache
   */
  private canReuseCache(
    manifest: CacheManifest,
    projectHash: string,
    projectMtime: number,
    settings: ProjectSettings,
    duration: number
  ): boolean {
    // Version must match
    if (manifest.version !== MANIFEST_VERSION) {
      return false;
    }

    // Project hash must match
    if (manifest.projectHash !== projectHash) {
      return false;
    }

    // Settings must match
    if (
      manifest.resolution[0] !== settings.resolution[0] ||
      manifest.resolution[1] !== settings.resolution[1] ||
      manifest.frameRate !== settings.frameRate
    ) {
      return false;
    }

    // Chunk duration must match
    if (manifest.chunkDuration !== this.chunkDuration) {
      return false;
    }

    // Quick mtime check - if project hasn't changed, likely valid
    // But we still need to validate individual chunk hashes
    return true;
  }

  /**
   * Compute a hash for the entire project (for quick identification)
   * For unsaved projects, use a stable identifier so cache can be reused across sessions
   */
  private computeProjectHash(projectPath: string | null): string {
    if (!projectPath) {
      // Use a stable identifier for unsaved projects
      // The actual content validation happens via chunk content hashes
      return 'unsaved-project';
    }
    return crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 16);
  }

  /**
   * Compute content hash for a specific chunk
   * Hash includes all clips that overlap with the chunk
   */
  private computeChunkHash(
    timeline: Timeline,
    media: MediaItem[],
    startTime: number,
    endTime: number
  ): string {
    const hashData: string[] = [
      `${startTime.toFixed(3)}`,
      `${endTime.toFixed(3)}`,
    ];

    // Add all clips that overlap with this chunk
    for (const track of timeline.tracks) {
      if (track.type !== 'video' || track.visible === false) continue;

      for (const clip of track.clips) {
        if (!clip.enabled) continue;

        const clipEnd = clip.timelineStart + clip.duration;
        if (clip.timelineStart < endTime && clipEnd > startTime) {
          // This clip overlaps with the chunk
          const mediaItem = media.find((m) => m.id === clip.mediaId);
          // Use proxy path only if the file exists
          const mediaPath = mediaItem?.proxyPath && fs.existsSync(mediaItem.proxyPath)
            ? mediaItem.proxyPath
            : (mediaItem?.path || '');

          hashData.push(
            `${clip.mediaId}|${clip.mediaIn.toFixed(3)}|${clip.mediaOut.toFixed(3)}|` +
            `${clip.timelineStart.toFixed(3)}|${clip.duration.toFixed(3)}|` +
            `${mediaPath}|${JSON.stringify(clip.effects || [])}`
          );
        }
      }
    }

    // Also include audio clips for audio-related changes
    for (const track of timeline.tracks) {
      if (track.type !== 'audio' || track.muted) continue;

      for (const clip of track.clips) {
        if (!clip.enabled) continue;

        const clipEnd = clip.timelineStart + clip.duration;
        if (clip.timelineStart < endTime && clipEnd > startTime) {
          const mediaItem = media.find((m) => m.id === clip.mediaId);
          // Use proxy path only if the file exists
          const mediaPath = mediaItem?.proxyPath && fs.existsSync(mediaItem.proxyPath)
            ? mediaItem.proxyPath
            : (mediaItem?.path || '');

          hashData.push(
            `audio:${clip.mediaId}|${clip.mediaIn.toFixed(3)}|${clip.mediaOut.toFixed(3)}|` +
            `${clip.timelineStart.toFixed(3)}|${mediaPath}`
          );
        }
      }
    }

    return crypto.createHash('md5').update(hashData.join('\n')).digest('hex');
  }

  /**
   * Get file modification time
   */
  private getFileMtime(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      return stats.mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * Load manifest from disk
   */
  private loadManifest(): CacheManifest | null {
    const manifestPath = path.join(this.cacheDir, MANIFEST_FILENAME);

    try {
      if (fs.existsSync(manifestPath)) {
        const data = fs.readFileSync(manifestPath, 'utf-8');
        return JSON.parse(data) as CacheManifest;
      }
    } catch (error) {
      console.error('[ChunkCache] Failed to load manifest:', error);
    }

    return null;
  }

  /**
   * Save manifest to disk
   */
  private saveManifest(): void {
    if (!this.manifest) return;

    const manifestPath = path.join(this.cacheDir, MANIFEST_FILENAME);

    try {
      this.manifest.updatedAt = Date.now();
      fs.writeFileSync(manifestPath, JSON.stringify(this.manifest, null, 2));
    } catch (error) {
      console.error('[ChunkCache] Failed to save manifest:', error);
    }
  }

  /**
   * Register a newly rendered chunk
   */
  registerChunk(chunkIndex: number, contentHash: string, filePath: string, isComplex: boolean): void {
    if (!this.manifest) return;

    const fileName = path.basename(filePath);

    // Remove any existing entry for this index
    this.manifest.chunks = this.manifest.chunks.filter((c) => c.index !== chunkIndex);

    // Add new entry
    this.manifest.chunks.push({
      index: chunkIndex,
      contentHash,
      fileName,
      isComplex,
    });

    this.saveManifest();
  }

  /**
   * Get the output path for a new chunk
   */
  getChunkOutputPath(chunkIndex: number, contentHash: string): string {
    const fileName = `chunk-${chunkIndex}-${contentHash.slice(0, 8)}.mp4`;
    return path.join(this.cacheDir, fileName);
  }

  /**
   * Invalidate chunks in a time range
   */
  invalidateRange(startTime: number, endTime: number): number[] {
    if (!this.manifest) return [];

    const invalidatedIndices: number[] = [];

    for (const entry of this.manifest.chunks) {
      const chunkStart = entry.index * this.chunkDuration;
      const chunkEnd = (entry.index + 1) * this.chunkDuration;

      // Check if this chunk overlaps with the invalidation range
      if (chunkStart < endTime && chunkEnd > startTime) {
        invalidatedIndices.push(entry.index);

        // Delete the cached file
        const cachedPath = path.join(this.cacheDir, entry.fileName);
        try {
          if (fs.existsSync(cachedPath)) {
            fs.unlinkSync(cachedPath);
          }
        } catch {
          // Ignore deletion errors
        }
      }
    }

    // Remove invalidated entries from manifest
    this.manifest.chunks = this.manifest.chunks.filter(
      (c) => !invalidatedIndices.includes(c.index)
    );

    this.saveManifest();

    return invalidatedIndices;
  }

  /**
   * Clear all cached chunks
   */
  async clearAll(): Promise<void> {
    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);

        for (const file of files) {
          const filePath = path.join(this.cacheDir, file);
          try {
            fs.unlinkSync(filePath);
          } catch {
            // Ignore individual file deletion errors
          }
        }
      }

      this.manifest = null;
    } catch (error) {
      console.error('[ChunkCache] Failed to clear cache:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { totalChunks: number; cachedChunks: number; totalSize: number } {
    let cachedChunks = 0;
    let totalSize = 0;

    if (this.manifest) {
      for (const entry of this.manifest.chunks) {
        const cachedPath = path.join(this.cacheDir, entry.fileName);
        if (fs.existsSync(cachedPath)) {
          cachedChunks++;
          try {
            const stats = fs.statSync(cachedPath);
            totalSize += stats.size;
          } catch {
            // Ignore stat errors
          }
        }
      }
    }

    const totalChunks = this.manifest
      ? Math.ceil(this.manifest.totalDuration / this.manifest.chunkDuration)
      : 0;

    return { totalChunks, cachedChunks, totalSize };
  }

  /**
   * Get the cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }
}
