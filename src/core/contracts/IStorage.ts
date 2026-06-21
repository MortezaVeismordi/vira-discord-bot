// src/core/contracts/IStorage.ts

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * آپشن‌های نوشتن
 */
export interface WriteOptions {
    /** اگر وجود داشت، بازنویسی کن؟ */
    readonly overwrite?: boolean;

    /** encoding فایل */
    readonly encoding?: BufferEncoding;

    /** ساخت دایرکتوری اگر وجود نداشت */
    readonly createDirectory?: boolean;

    /** بعد از نوشتن، backup بگیر؟ */
    readonly backup?: boolean;
}

/**
 * آپشن‌های خواندن
 */
export interface ReadOptions {
    /** encoding فایل */
    readonly encoding?: BufferEncoding;

    /** اگر وجود نداشت، مقدار پیش‌فرض */
    readonly defaultValue?: string;
}

/**
 * آپشن‌های لیست کردن
 */
export interface ListOptions {
    /** فیلتر بر اساس پسوند */
    readonly extension?: string;

    /** فیلتر بر اساس pattern */
    readonly pattern?: RegExp;

    /** recursive باشه؟ */
    readonly recursive?: boolean;

    /** مرتب‌سازی */
    readonly sortBy?: "name" | "modified" | "size";

    /** ترتیب */
    readonly sortOrder?: "asc" | "desc";
}

/**
 * اطلاعات یک فایل/آیتم
 */
export interface StorageItemInfo {
    /** نام فایل */
    readonly name: string;

    /** مسیر کامل */
    readonly path: string;

    /** حجم به بایت */
    readonly size: number;

    /** زمان ساخت */
    readonly createdAt: Date;

    /** زمان آخرین تغییر */
    readonly modifiedAt: Date;

    /** آیا دایرکتوری است */
    readonly isDirectory: boolean;
}

/**
 * نتیجه عملیات ذخیره‌سازی
 */
export interface StorageResult {
    readonly success: boolean;
    readonly path: string;
    readonly bytesWritten?: number;
    readonly error?: string;
}

/**
 * آمار storage
 */
export interface StorageStats {
    readonly totalFiles: number;
    readonly totalSize: number;
    readonly oldestFile: Date | null;
    readonly newestFile: Date | null;
    readonly averageFileSize: number;
}

// ============================================================
// 💾 MAIN INTERFACE - IStorage
// ============================================================

/**
 * Interface اصلی ذخیره‌سازی
 *
 * این interface تنها راه ارتباط Core با سیستم فایل/دیتابیس است.
 * Core هرگز مستقیماً fs.readFile یا fs.writeFile نمی‌زند.
 *
 * ```
 * Core Layer
 *    │
 *    ├── ContextManager
 *    ├── MemoryIndex
 *    └── Logger
 *         │
 *         ▼
 *    ┌──────────┐
 *    │ IStorage │  ← Contract
 *    └────┬─────┘
 *         │
 *    ┌────▼──────────┐
 *    │ FileStorage   │  ← ./runtime/contexts/
 *    │ DatabaseStorage│ ← PostgreSQL (آینده)
 *    └───────────────┘
 * ```
 *
 * @example
 * ```typescript
 * // ContextManager
 * class ContextManager {
 *   constructor(private storage: IStorage) {}
 *
 *   async loadContext(channelId: string): Promise<string> {
 *     return this.storage.read(`contexts/${channelId}.md`);
 *   }
 *
 *   async saveContext(channelId: string, content: string): Promise<void> {
 *     await this.storage.write(`contexts/${channelId}.md`, content, {
 *       backup: true,
 *     });
 *   }
 * }
 * ```
 */
export interface IStorage {
    // ─── CRUD Operations ──────────────────────────────────

    /**
     * خواندن محتوای یک فایل/آیتم
     *
     * @throws StorageNotFoundError اگر وجود نداشت و defaultValue نداشت
     *
     * @example
     * ```typescript
     * const content = await storage.read("contexts/ch_123.md");
     *
     * // با مقدار پیش‌فرض
     * const content = await storage.read("contexts/ch_999.md", {
     *   defaultValue: "# Empty Context\n",
     * });
     * ```
     */
    read(path: string, options?: ReadOptions): Promise<string>;

    /**
     * نوشتن محتوا
     *
     * @example
     * ```typescript
     * await storage.write("contexts/ch_123.md", markdownContent, {
     *   overwrite: true,
     *   createDirectory: true,
     *   backup: true,
     * });
     * ```
     */
    write(
        path: string,
        content: string,
        options?: WriteOptions,
    ): Promise<StorageResult>;

    /**
     * حذف یک فایل/آیتم
     *
     * @example
     * ```typescript
     * await storage.delete("contexts/ch_123.md");
     * ```
     */
    delete(path: string): Promise<boolean>;

    /**
     * آیا فایل/آیتم وجود دارد؟
     *
     * @example
     * ```typescript
     * if (await storage.exists("contexts/ch_123.md")) {
     *   // load context
     * }
     * ```
     */
    exists(path: string): Promise<boolean>;

    // ─── Advanced Read/Write ──────────────────────────────

    /**
     * خواندن و پارس JSON
     *
     * @example
     * ```typescript
     * const config = await storage.readJSON<Config>("settings.json");
     * ```
     */
    readJSON<T = Record<string, unknown>>(
        path: string,
        defaultValue?: T,
    ): Promise<T>;

    /**
     * نوشتن به فرمت JSON
     *
     * @example
     * ```typescript
     * await storage.writeJSON("metrics/daily.json", metricsData);
     * ```
     */
    writeJSON(
        path: string,
        data: unknown,
        pretty?: boolean,
    ): Promise<StorageResult>;

    /**
     * اضافه کردن محتوا به انتهای فایل
     *
     * @example
     * ```typescript
     * await storage.append("logs/vira.log", logLine + "\n");
     * ```
     */
    append(path: string, content: string): Promise<StorageResult>;

    // ─── Directory Operations ─────────────────────────────

    /**
     * لیست فایل‌ها/آیتم‌ها
     *
     * @example
     * ```typescript
     * // تمام context fileها
     * const files = await storage.list("contexts/", {
     *   extension: ".md",
     *   sortBy: "modified",
     *   sortOrder: "desc",
     * });
     *
     * // فایل‌های یک کاربر خاص
     * const userFiles = await storage.list("contexts/", {
     *   pattern: /usr_456/,
     * });
     * ```
     */
    list(
        directory: string,
        options?: ListOptions,
    ): Promise<StorageItemInfo[]>;

    /**
     * ساخت دایرکتوری
     *
     * @example
     * ```typescript
     * await storage.createDirectory("contexts/archive");
     * ```
     */
    createDirectory(path: string): Promise<boolean>;

    /**
     * آیا دایرکتوری وجود دارد؟
     */
    directoryExists(path: string): Promise<boolean>;

    // ─── File Info ────────────────────────────────────────

    /**
     * اطلاعات یک فایل
     *
     * @example
     * ```typescript
     * const info = await storage.info("contexts/ch_123.md");
     * console.log(`Size: ${info.size} bytes`);
     * console.log(`Modified: ${info.modifiedAt}`);
     * ```
     */
    info(path: string): Promise<StorageItemInfo>;

    /**
     * حجم یک فایل به بایت
     */
    size(path: string): Promise<number>;

    // ─── Backup & Recovery ────────────────────────────────

    /**
     * ساخت backup از یک فایل
     *
     * @returns مسیر فایل backup
     *
     * @example
     * ```typescript
     * const backupPath = await storage.backup("contexts/ch_123.md");
     * // → "contexts/backups/ch_123_2024-01-15T14-30-00.md"
     * ```
     */
    backup(path: string): Promise<string>;

    /**
     * بازیابی از آخرین backup
     *
     * @example
     * ```typescript
     * const restored = await storage.restore("contexts/ch_123.md");
     * ```
     */
    restore(path: string): Promise<boolean>;

    /**
     * لیست backupهای موجود
     */
    listBackups(path: string): Promise<StorageItemInfo[]>;

    // ─── Atomic Operations ────────────────────────────────

    /**
     * خواندن و نوشتن اتمیک
     *
     * تضمین می‌کنه بین read و write کسی دیگه فایل رو تغییر نمیده
     *
     * @example
     * ```typescript
     * await storage.readModifyWrite(
     *   "contexts/ch_123.md",
     *   (content) => {
     *     // تغییرات روی content
     *     return content + "\n- خاطره جدید";
     *   },
     * );
     * ```
     */
    readModifyWrite(
        path: string,
        modifier: (content: string) => string | Promise<string>,
    ): Promise<StorageResult>;

    // ─── Maintenance ──────────────────────────────────────

    /**
     * آمار storage
     *
     * @example
     * ```typescript
     * const stats = await storage.stats("contexts/");
     * console.log(`${stats.totalFiles} context files`);
     * console.log(`${stats.totalSize} bytes total`);
     * ```
     */
    stats(directory: string): Promise<StorageStats>;

    /**
     * پاکسازی فایل‌های قدیمی
     *
     * @example
     * ```typescript
     * // حذف backupهای بیشتر از ۷ روز
     * const deleted = await storage.cleanup("contexts/backups/", {
     *   olderThan: 7 * 24 * 60 * 60 * 1000,
     * });
     * ```
     */
    cleanup(
        directory: string,
        options: {
            olderThan?: number;    // ms
            maxFiles?: number;
            maxSize?: number;      // bytes
        },
    ): Promise<number>;
}

// ============================================================
// 💾 SPECIALIZED INTERFACES
// ============================================================

/**
 * Storage مخصوص Context Files
 *
 * یک نسخه تخصصی‌تر برای مدیریت فایل‌های حافظه مارک‌داون
 *
 * @example
 * ```typescript
 * class ContextManager {
 *   constructor(private contextStorage: IContextStorage) {}
 *
 *   async load(channelId: string, userId: string) {
 *     return this.contextStorage.loadContext(channelId, userId);
 *   }
 * }
 * ```
 */
export interface IContextStorage {
    /**
     * بارگذاری context یک کانال
     */
    loadContext(
        channelId: string,
        userId: string,
    ): Promise<string | null>;

    /**
     * ذخیره context
     */
    saveContext(
        channelId: string,
        userId: string,
        content: string,
    ): Promise<StorageResult>;

    /**
     * حذف context
     */
    deleteContext(
        channelId: string,
        userId: string,
    ): Promise<boolean>;

    /**
     * آیا context وجود دارد؟
     */
    contextExists(
        channelId: string,
        userId: string,
    ): Promise<boolean>;

    /**
     * لیست تمام contextها
     */
    listContexts(): Promise<Array<{
        channelId: string;
        userId: string;
        size: number;
        modifiedAt: Date;
    }>>;

    /**
     * backup گرفتن از context
     */
    backupContext(
        channelId: string,
        userId: string,
    ): Promise<string>;

    /**
     * بازیابی context از backup
     */
    restoreContext(
        channelId: string,
        userId: string,
    ): Promise<boolean>;
}

/**
 * Storage مخصوص Metrics
 *
 * @example
 * ```typescript
 * class MetricsCollector {
 *   constructor(private metricsStorage: IMetricsStorage) {}
 *
 *   async flush(metrics: MetricEntry[]) {
 *     await this.metricsStorage.writeMetrics(metrics);
 *   }
 * }
 * ```
 */
export interface IMetricsStorage {
    /**
     * نوشتن متریک‌ها
     */
    writeMetrics(metrics: MetricEntry[]): Promise<void>;

    /**
     * خواندن متریک‌ها
     */
    readMetrics(options: {
        from?: Date;
        to?: Date;
        type?: string;
        limit?: number;
    }): Promise<MetricEntry[]>;

    /**
     * پاکسازی متریک‌های قدیمی
     */
    cleanupMetrics(olderThan: Date): Promise<number>;
}

/**
 * یک ورودی متریک
 */
export interface MetricEntry {
    readonly name: string;
    readonly value: number;
    readonly unit: string;
    readonly tags: Record<string, string>;
    readonly timestamp: Date;
}

/**
 * Storage مخصوص Prompts
 *
 * @example
 * ```typescript
 * class DevAgent {
 *   constructor(private prompts: IPromptStorage) {}
 *
 *   async getSystemPrompt() {
 *     return this.prompts.loadPrompt("agents/dev/system.md");
 *   }
 * }
 * ```
 */
export interface IPromptStorage {
    /**
     * بارگذاری یک فایل prompt
     */
    loadPrompt(path: string): Promise<string>;

    /**
     * بارگذاری با جایگزینی متغیرها
     *
     * @example
     * ```typescript
     * const prompt = await prompts.loadPromptWithVars(
     *   "agents/companion/system.md",
     *   {
     *     userName: "علی",
     *     mood: "energetic",
     *     teasingLevel: "6",
     *   },
     * );
     * // {{userName}} → علی
     * // {{mood}} → energetic
     * ```
     */
    loadPromptWithVars(
        path: string,
        variables: Record<string, string>,
    ): Promise<string>;

    /**
     * آیا prompt وجود دارد؟
     */
    promptExists(path: string): Promise<boolean>;

    /**
     * لیست تمام promptها
     */
    listPrompts(directory?: string): Promise<string[]>;

    /**
     * بارگذاری مجدد (cache invalidation)
     */
    reload(path?: string): Promise<void>;
}

// ============================================================
// 🛠️ HELPER TYPES
// ============================================================

/**
 * خطاهای Storage
 */
export type StorageErrorType =
    | "not-found"
    | "permission-denied"
    | "disk-full"
    | "corrupted"
    | "locked"
    | "unknown";

/**
 * خطای Storage
 */
export interface StorageError {
    readonly type: StorageErrorType;
    readonly message: string;
    readonly path: string;
    readonly operation: "read" | "write" | "delete" | "list";
}

/**
 * ساخت StorageError
 */
export function createStorageError(
    type: StorageErrorType,
    path: string,
    operation: "read" | "write" | "delete" | "list",
    message?: string,
): StorageError {
    const defaultMessages: Record<StorageErrorType, string> = {
        "not-found": `File not found: ${path}`,
        "permission-denied": `Permission denied: ${path}`,
        "disk-full": `Disk full, cannot write: ${path}`,
        "corrupted": `File corrupted: ${path}`,
        "locked": `File is locked: ${path}`,
        "unknown": `Unknown storage error: ${path}`,
    };

    return {
        type,
        message: message ?? defaultMessages[type],
        path,
        operation,
    };
}

/**
 * ساخت مسیر context file
 */
export function contextPath(
    channelId: string,
    userId: string,
): string {
    return `contexts/${channelId}_${userId}.md`;
}

/**
 * ساخت مسیر backup
 */
export function backupPath(
    originalPath: string,
    timestamp?: Date,
): string {
    const ts = (timestamp ?? new Date())
        .toISOString()
        .replace(/[:.]/g, "-");

    const parts = originalPath.split("/");
    const fileName = parts.pop()!;
    const dir = parts.join("/");
    const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
    const ext = fileName.slice(nameWithoutExt.length);

    return `${dir}/backups/${nameWithoutExt}_${ts}${ext}`;
}