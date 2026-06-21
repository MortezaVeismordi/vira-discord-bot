// src/infrastructure/context/storage/FileStorage.ts

import * as fs from "fs/promises";
import * as path from "path";
import type {
    IStorage,
    IContextStorage,
    IPromptStorage,
    ReadOptions,
    WriteOptions,
    ListOptions,
    StorageItemInfo,
    StorageResult,
    StorageStats,
} from "@/core/contracts/IStorage";
import {
    createStorageError,
    contextPath,
    backupPath,
} from "@/core/contracts/IStorage";

// ============================================================
// 💾 FILE STORAGE - پیاده‌سازی اصلی IStorage
// ============================================================

/**
 * پیاده‌سازی IStorage بر اساس سیستم فایل
 *
 * تمام عملیات نسبت به یک rootDir انجام می‌شود.
 * مثلاً اگر rootDir = "./runtime" باشد:
 *   storage.read("contexts/ch_123.md")
 *   → ./runtime/contexts/ch_123.md
 *
 * ویژگی‌ها:
 * - Atomic writes (temp file → rename)
 * - File locking (برای readModifyWrite)
 * - Path traversal protection
 * - Auto directory creation
 * - Backup & restore
 *
 * @example
 * ```typescript
 * const storage = new FileStorage("./runtime");
 * await storage.initialize();
 *
 * await storage.write("contexts/ch_123.md", markdownContent, {
 *   createDirectory: true,
 *   backup: true,
 * });
 *
 * const content = await storage.read("contexts/ch_123.md");
 * ```
 */
export class FileStorage implements IStorage {
    private readonly rootDir: string;

    constructor(rootDir: string) {
        this.rootDir = path.resolve(rootDir);
    }

    // ============================================================
    // 🔧 PATH RESOLUTION
    // ============================================================

    /**
     * تبدیل مسیر نسبی به مسیر مطلق امن
     * جلوگیری از path traversal attack
     */
    private resolvePath(relativePath: string): string {
        const resolved = path.resolve(this.rootDir, relativePath);

        if (!resolved.startsWith(this.rootDir)) {
            throw new Error(
                `Path traversal detected: "${relativePath}" resolves outside root directory`,
            );
        }

        return resolved;
    }

    // ============================================================
    // 📖 READ OPERATIONS
    // ============================================================

    async read(
        filePath: string,
        options?: ReadOptions,
    ): Promise<string> {
        const fullPath = this.resolvePath(filePath);
        const encoding = options?.encoding ?? "utf-8";

        try {
            return await fs.readFile(fullPath, { encoding });
        } catch (error: any) {
            if (error.code === "ENOENT" && options?.defaultValue !== undefined) {
                return options.defaultValue;
            }

            if (error.code === "ENOENT") {
                throw createStorageError("not-found", filePath, "read");
            }

            if (error.code === "EACCES") {
                throw createStorageError("permission-denied", filePath, "read");
            }

            throw createStorageError("unknown", filePath, "read", error.message);
        }
    }

    async readJSON<T = Record<string, unknown>>(
        filePath: string,
        defaultValue?: T,
    ): Promise<T> {
        try {
            const content = await this.read(filePath);
            return JSON.parse(content) as T;
        } catch (error: any) {
            if (error.type === "not-found" && defaultValue !== undefined) {
                return defaultValue;
            }

            if (error instanceof SyntaxError) {
                throw createStorageError(
                    "corrupted",
                    filePath,
                    "read",
                    `Invalid JSON: ${error.message}`,
                );
            }

            throw error;
        }
    }

    // ============================================================
    // ✏️ WRITE OPERATIONS
    // ============================================================

    async write(
        filePath: string,
        content: string,
        options?: WriteOptions,
    ): Promise<StorageResult> {
        const fullPath = this.resolvePath(filePath);
        const encoding = options?.encoding ?? "utf-8";

        try {
            // چک overwrite
            if (options?.overwrite === false) {
                const fileExists = await this.exists(filePath);
                if (fileExists) {
                    return {
                        success: false,
                        path: filePath,
                        error: "File already exists and overwrite is disabled",
                    };
                }
            }

            // ساخت دایرکتوری
            if (options?.createDirectory !== false) {
                const dir = path.dirname(fullPath);
                await fs.mkdir(dir, { recursive: true });
            }

            // backup قبل از نوشتن
            if (options?.backup) {
                const fileExists = await this.exists(filePath);
                if (fileExists) {
                    await this.backup(filePath);
                }
            }

            // نوشتن اتمیک: temp file → rename
            const tempPath = `${fullPath}.tmp.${Date.now()}`;

            try {
                await fs.writeFile(tempPath, content, { encoding });
                await fs.rename(tempPath, fullPath);
            } catch (writeError) {
                // پاکسازی temp file
                await fs.unlink(tempPath).catch(() => { });
                throw writeError;
            }

            const stats = await fs.stat(fullPath);

            return {
                success: true,
                path: filePath,
                bytesWritten: stats.size,
            };
        } catch (error: any) {
            if (error.code === "ENOSPC") {
                throw createStorageError("disk-full", filePath, "write");
            }

            if (error.code === "EACCES") {
                throw createStorageError("permission-denied", filePath, "write");
            }

            return {
                success: false,
                path: filePath,
                error: error.message,
            };
        }
    }

    async writeJSON(
        filePath: string,
        data: unknown,
        pretty: boolean = true,
    ): Promise<StorageResult> {
        const content = pretty
            ? JSON.stringify(data, null, 2)
            : JSON.stringify(data);

        return this.write(filePath, content, { createDirectory: true });
    }

    async append(
        filePath: string,
        content: string,
    ): Promise<StorageResult> {
        const fullPath = this.resolvePath(filePath);

        try {
            const dir = path.dirname(fullPath);
            await fs.mkdir(dir, { recursive: true });

            await fs.appendFile(fullPath, content, { encoding: "utf-8" });

            const stats = await fs.stat(fullPath);

            return {
                success: true,
                path: filePath,
                bytesWritten: stats.size,
            };
        } catch (error: any) {
            return {
                success: false,
                path: filePath,
                error: error.message,
            };
        }
    }

    // ============================================================
    // 🗑️ DELETE
    // ============================================================

    async delete(filePath: string): Promise<boolean> {
        const fullPath = this.resolvePath(filePath);

        try {
            await fs.unlink(fullPath);
            return true;
        } catch (error: any) {
            if (error.code === "ENOENT") return false;
            throw createStorageError("unknown", filePath, "delete", error.message);
        }
    }

    // ============================================================
    // ❓ EXISTS & INFO
    // ============================================================

    async exists(filePath: string): Promise<boolean> {
        const fullPath = this.resolvePath(filePath);

        try {
            await fs.access(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    async info(filePath: string): Promise<StorageItemInfo> {
        const fullPath = this.resolvePath(filePath);

        try {
            const stats = await fs.stat(fullPath);

            return {
                name: path.basename(fullPath),
                path: filePath,
                size: stats.size,
                createdAt: stats.birthtime,
                modifiedAt: stats.mtime,
                isDirectory: stats.isDirectory(),
            };
        } catch (error: any) {
            if (error.code === "ENOENT") {
                throw createStorageError("not-found", filePath, "read");
            }
            throw error;
        }
    }

    async size(filePath: string): Promise<number> {
        const fileInfo = await this.info(filePath);
        return fileInfo.size;
    }

    // ============================================================
    // 📂 DIRECTORY OPERATIONS
    // ============================================================

    async list(
        directory: string,
        options?: ListOptions,
    ): Promise<StorageItemInfo[]> {
        const fullDir = this.resolvePath(directory);

        try {
            const entries = await fs.readdir(fullDir, { withFileTypes: true });
            let items: StorageItemInfo[] = [];

            for (const entry of entries) {
                const entryPath = path.join(directory, entry.name);
                const fullEntryPath = path.join(fullDir, entry.name);

                // دایرکتوری recursive
                if (entry.isDirectory() && options?.recursive) {
                    const subItems = await this.list(entryPath, options);
                    items.push(...subItems);
                    continue;
                }

                if (entry.isDirectory()) continue;

                // فیلتر extension
                if (options?.extension && !entry.name.endsWith(options.extension)) {
                    continue;
                }

                // فیلتر pattern
                if (options?.pattern && !options.pattern.test(entry.name)) {
                    continue;
                }

                try {
                    const stats = await fs.stat(fullEntryPath);
                    items.push({
                        name: entry.name,
                        path: entryPath,
                        size: stats.size,
                        createdAt: stats.birthtime,
                        modifiedAt: stats.mtime,
                        isDirectory: false,
                    });
                } catch {
                    // فایل بین readdir و stat حذف شده
                    continue;
                }
            }

            // مرتب‌سازی
            if (options?.sortBy) {
                const order = options.sortOrder === "desc" ? -1 : 1;

                items.sort((a, b) => {
                    switch (options.sortBy) {
                        case "name":
                            return a.name.localeCompare(b.name) * order;
                        case "modified":
                            return (a.modifiedAt.getTime() - b.modifiedAt.getTime()) * order;
                        case "size":
                            return (a.size - b.size) * order;
                        default:
                            return 0;
                    }
                });
            }

            return items;
        } catch (error: any) {
            if (error.code === "ENOENT") return [];
            throw createStorageError("unknown", directory, "list", error.message);
        }
    }

    async createDirectory(dirPath: string): Promise<boolean> {
        const fullPath = this.resolvePath(dirPath);

        try {
            await fs.mkdir(fullPath, { recursive: true });
            return true;
        } catch {
            return false;
        }
    }

    async directoryExists(dirPath: string): Promise<boolean> {
        const fullPath = this.resolvePath(dirPath);

        try {
            const stats = await fs.stat(fullPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    // ============================================================
    // 💾 BACKUP & RECOVERY
    // ============================================================

    async backup(filePath: string): Promise<string> {
        const fileExists = await this.exists(filePath);
        if (!fileExists) {
            throw createStorageError("not-found", filePath, "read");
        }

        const bkPath = backupPath(filePath);
        const content = await this.read(filePath);

        await this.write(bkPath, content, {
            createDirectory: true,
            overwrite: true,
        });

        return bkPath;
    }

    async restore(filePath: string): Promise<boolean> {
        const backups = await this.listBackups(filePath);
        if (backups.length === 0) return false;

        // جدیدترین backup
        const latest = backups[0]; // قبلاً sort شده

        const content = await this.read(latest.path);
        await this.write(filePath, content, { overwrite: true });

        return true;
    }

    async listBackups(filePath: string): Promise<StorageItemInfo[]> {
        const dir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
        const backupDir = path.join(dir, "backups");

        const dirExists = await this.directoryExists(backupDir);
        if (!dirExists) return [];

        return this.list(backupDir, {
            pattern: new RegExp(`^${this.escapeRegex(nameWithoutExt)}_`),
            sortBy: "modified",
            sortOrder: "desc",
        });
    }

    // ============================================================
    // 🔄 ATOMIC OPERATIONS
    // ============================================================

    async readModifyWrite(
        filePath: string,
        modifier: (content: string) => string | Promise<string>,
    ): Promise<StorageResult> {
        const fullPath = this.resolvePath(filePath);
        const lockPath = `${fullPath}.lock`;

        try {
            await this.acquireLock(lockPath);

            // خواندن
            let content: string;
            try {
                content = await this.read(filePath);
            } catch {
                content = "";
            }

            // تغییر
            const modified = await modifier(content);

            // نوشتن
            return await this.write(filePath, modified, {
                overwrite: true,
                createDirectory: true,
            });
        } finally {
            await this.releaseLock(lockPath);
        }
    }

    // ============================================================
    // 🧹 MAINTENANCE
    // ============================================================

    async stats(directory: string): Promise<StorageStats> {
        const files = await this.list(directory, { recursive: true });

        if (files.length === 0) {
            return {
                totalFiles: 0,
                totalSize: 0,
                oldestFile: null,
                newestFile: null,
                averageFileSize: 0,
            };
        }

        let totalSize = 0;
        let oldestFile: Date | null = null;
        let newestFile: Date | null = null;

        for (const file of files) {
            totalSize += file.size;

            if (!oldestFile || file.modifiedAt < oldestFile) {
                oldestFile = file.modifiedAt;
            }
            if (!newestFile || file.modifiedAt > newestFile) {
                newestFile = file.modifiedAt;
            }
        }

        return {
            totalFiles: files.length,
            totalSize,
            oldestFile,
            newestFile,
            averageFileSize: Math.round(totalSize / files.length),
        };
    }

    async cleanup(
        directory: string,
        options: {
            olderThan?: number;
            maxFiles?: number;
            maxSize?: number;
        },
    ): Promise<number> {
        let deletedCount = 0;
        const now = Date.now();

        // حذف فایل‌های قدیمی
        if (options.olderThan) {
            const files = await this.list(directory, {
                sortBy: "modified",
                sortOrder: "asc",
            });

            for (const file of files) {
                const age = now - file.modifiedAt.getTime();
                if (age > options.olderThan) {
                    await this.delete(file.path);
                    deletedCount++;
                }
            }
        }

        // محدودیت تعداد
        if (options.maxFiles) {
            const remaining = await this.list(directory, {
                sortBy: "modified",
                sortOrder: "desc",
            });

            if (remaining.length > options.maxFiles) {
                const toDelete = remaining.slice(options.maxFiles);
                for (const file of toDelete) {
                    await this.delete(file.path);
                    deletedCount++;
                }
            }
        }

        // محدودیت حجم
        if (options.maxSize) {
            const remaining = await this.list(directory, {
                sortBy: "modified",
                sortOrder: "desc",
            });

            let currentSize = remaining.reduce((sum, f) => sum + f.size, 0);

            for (
                let i = remaining.length - 1;
                i >= 0 && currentSize > options.maxSize;
                i--
            ) {
                await this.delete(remaining[i].path);
                currentSize -= remaining[i].size;
                deletedCount++;
            }
        }

        return deletedCount;
    }

    // ============================================================
    // 🔒 LOCK HELPERS
    // ============================================================

    private async acquireLock(
        lockPath: string,
        timeoutMs: number = 5000,
    ): Promise<void> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            try {
                const dir = path.dirname(lockPath);
                await fs.mkdir(dir, { recursive: true });

                // O_EXCL: فقط اگر وجود نداشت بساز
                await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
                return;
            } catch (error: any) {
                if (error.code === "EEXIST") {
                    const isStale = await this.isLockStale(lockPath);
                    if (isStale) {
                        await fs.unlink(lockPath).catch(() => { });
                        continue;
                    }
                    await this.sleep(50);
                    continue;
                }
                throw error;
            }
        }

        throw createStorageError(
            "locked",
            lockPath,
            "write",
            `Could not acquire lock within ${timeoutMs}ms`,
        );
    }

    private async releaseLock(lockPath: string): Promise<void> {
        await fs.unlink(lockPath).catch(() => { });
    }

    private async isLockStale(
        lockPath: string,
        maxAgeMs: number = 30_000,
    ): Promise<boolean> {
        try {
            const stats = await fs.stat(lockPath);
            return Date.now() - stats.mtimeMs > maxAgeMs;
        } catch {
            return true;
        }
    }

    // ============================================================
    // 🛠️ UTILITY
    // ============================================================

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * مسیر root
     */
    getRootDir(): string {
        return this.rootDir;
    }

    /**
     * مقداردهی اولیه
     */
    async initialize(): Promise<void> {
        const requiredDirs = [
            "contexts",
            "contexts/backups",
            "logs",
            "metrics",
            "voice-cache",
        ];

        for (const dir of requiredDirs) {
            await this.createDirectory(dir);
        }
    }
}

// ============================================================
// 📝 CONTEXT FILE STORAGE
// ============================================================

/**
 * Storage تخصصی برای Context/Memory Files
 *
 * @example
 * ```typescript
 * const contextStorage = new ContextFileStorage(fileStorage);
 *
 * await contextStorage.saveContext("ch_123", "usr_456", markdownContent);
 * const content = await contextStorage.loadContext("ch_123", "usr_456");
 * ```
 */
export class ContextFileStorage implements IContextStorage {
    constructor(private readonly storage: FileStorage) { }

    private getPath(channelId: string, userId: string): string {
        return contextPath(channelId, userId);
    }

    async loadContext(
        channelId: string,
        userId: string,
    ): Promise<string | null> {
        const filePath = this.getPath(channelId, userId);

        try {
            return await this.storage.read(filePath);
        } catch {
            return null;
        }
    }

    async saveContext(
        channelId: string,
        userId: string,
        content: string,
    ): Promise<StorageResult> {
        return this.storage.write(
            this.getPath(channelId, userId),
            content,
            { overwrite: true, createDirectory: true },
        );
    }

    async deleteContext(
        channelId: string,
        userId: string,
    ): Promise<boolean> {
        return this.storage.delete(this.getPath(channelId, userId));
    }

    async contextExists(
        channelId: string,
        userId: string,
    ): Promise<boolean> {
        return this.storage.exists(this.getPath(channelId, userId));
    }

    async listContexts(): Promise<Array<{
        channelId: string;
        userId: string;
        size: number;
        modifiedAt: Date;
    }>> {
        const files = await this.storage.list("contexts", {
            extension: ".md",
            sortBy: "modified",
            sortOrder: "desc",
        });

        return files
            .map((file) => {
                const name = file.name.replace(".md", "");
                const parts = name.split("_");

                if (parts.length < 2) return null;

                return {
                    channelId: parts[0],
                    userId: parts.slice(1).join("_"),
                    size: file.size,
                    modifiedAt: file.modifiedAt,
                };
            })
            .filter(Boolean) as Array<{
                channelId: string;
                userId: string;
                size: number;
                modifiedAt: Date;
            }>;
    }

    async backupContext(
        channelId: string,
        userId: string,
    ): Promise<string> {
        return this.storage.backup(this.getPath(channelId, userId));
    }

    async restoreContext(
        channelId: string,
        userId: string,
    ): Promise<boolean> {
        return this.storage.restore(this.getPath(channelId, userId));
    }
}

// ============================================================
// 📋 PROMPT FILE STORAGE
// ============================================================

/**
 * Storage تخصصی برای Prompt Files
 *
 * شامل caching و variable substitution
 *
 * @example
 * ```typescript
 * const prompts = new PromptFileStorage("./prompts");
 *
 * const prompt = await prompts.loadPromptWithVars(
 *   "agents/companion/system.md",
 *   { userName: "علی", mood: "energetic" },
 * );
 * ```
 */
export class PromptFileStorage implements IPromptStorage {
    private readonly storage: FileStorage;
    private readonly cache: Map<string, {
        content: string;
        loadedAt: number;
    }>;
    private readonly cacheTTL: number;

    constructor(
        promptsDir: string,
        cacheTTL: number = 5 * 60 * 1000,
    ) {
        this.storage = new FileStorage(promptsDir);
        this.cache = new Map();
        this.cacheTTL = cacheTTL;
    }

    async loadPrompt(promptPath: string): Promise<string> {
        const cached = this.cache.get(promptPath);
        if (cached && Date.now() - cached.loadedAt < this.cacheTTL) {
            return cached.content;
        }

        const content = await this.storage.read(promptPath);

        this.cache.set(promptPath, {
            content,
            loadedAt: Date.now(),
        });

        return content;
    }

    async loadPromptWithVars(
        promptPath: string,
        variables: Record<string, string>,
    ): Promise<string> {
        let content = await this.loadPrompt(promptPath);

        for (const [key, value] of Object.entries(variables)) {
            const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
            content = content.replace(pattern, value);
        }

        const unreplaced = content.match(/\{\{[^}]+\}\}/g);
        if (unreplaced) {
            console.warn(
                `[PromptStorage] Unreplaced variables in "${promptPath}": ${unreplaced.join(", ")}`,
            );
        }

        return content;
    }

    async promptExists(promptPath: string): Promise<boolean> {
        return this.storage.exists(promptPath);
    }

    async listPrompts(directory?: string): Promise<string[]> {
        const files = await this.storage.list(directory ?? "", {
            extension: ".md",
            recursive: true,
            sortBy: "name",
        });

        return files.map((f) => f.path);
    }

    async reload(promptPath?: string): Promise<void> {
        if (promptPath) {
            this.cache.delete(promptPath);
        } else {
            this.cache.clear();
        }
    }

    getCacheStats(): { size: number; entries: string[] } {
        return {
            size: this.cache.size,
            entries: [...this.cache.keys()],
        };
    }
}

// ============================================================
// 📊 METRICS FILE STORAGE
// ============================================================

/**
 * Storage تخصصی برای Metrics (JSONL format)
 *
 * @example
 * ```typescript
 * const metrics = new MetricsFileStorage(fileStorage);
 *
 * await metrics.writeMetrics([{
 *   name: "llm.latency",
 *   value: 1200,
 *   unit: "ms",
 *   tags: { provider: "ollama" },
 *   timestamp: new Date(),
 * }]);
 * ```
 */
export class MetricsFileStorage {
    constructor(private readonly storage: FileStorage) { }

    async writeMetrics(
        metrics: Array<{
            name: string;
            value: number;
            unit: string;
            tags: Record<string, string>;
            timestamp: Date;
        }>,
    ): Promise<void> {
        const date = new Date().toISOString().split("T")[0];
        const filePath = `metrics/${date}.jsonl`;

        const lines = metrics
            .map((m) => JSON.stringify(m))
            .join("\n") + "\n";

        await this.storage.append(filePath, lines);
    }

    async readMetrics(date: string): Promise<Array<{
        name: string;
        value: number;
        unit: string;
        tags: Record<string, string>;
        timestamp: string;
    }>> {
        const filePath = `metrics/${date}.jsonl`;

        try {
            const content = await this.storage.read(filePath);
            return content
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));
        } catch {
            return [];
        }
    }

    async cleanupMetrics(maxAgeDays: number = 30): Promise<number> {
        return this.storage.cleanup("metrics", {
            olderThan: maxAgeDays * 24 * 60 * 60 * 1000,
        });
    }
}

// ============================================================
// 🏭 FACTORY
// ============================================================

/**
 * ساخت تمام Storage instanceها
 *
 * @example
 * ```typescript
 * const storages = createStorageInstances({
 *   runtimeDir: "./runtime",
 *   promptsDir: "./prompts",
 * });
 *
 * const context = await storages.contexts.loadContext("ch_123", "usr_456");
 * const prompt = await storages.prompts.loadPrompt("agents/dev/system.md");
 * ```
 */
export function createStorageInstances(config: {
    runtimeDir: string;
    promptsDir: string;
    promptCacheTTL?: number;
}): {
    fileStorage: FileStorage;
    contexts: ContextFileStorage;
    prompts: PromptFileStorage;
    metrics: MetricsFileStorage;
} {
    const fileStorage = new FileStorage(config.runtimeDir);
    const contexts = new ContextFileStorage(fileStorage);
    const prompts = new PromptFileStorage(
        config.promptsDir,
        config.promptCacheTTL,
    );
    const metrics = new MetricsFileStorage(fileStorage);

    return { fileStorage, contexts, prompts, metrics };
}