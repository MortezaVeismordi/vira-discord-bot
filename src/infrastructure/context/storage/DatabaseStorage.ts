// src/infrastructure/context/storage/DatabaseStorage.ts

import type {
    IContextStorage,
    StorageResult,
} from "@/core/contracts/IStorage";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * تنظیمات اتصال دیتابیس
 */
export interface DatabaseConfig {
    /** نوع دیتابیس */
    readonly type: "postgres" | "sqlite";

    /** آدرس اتصال */
    readonly connectionString: string;

    /** حداکثر اتصالات همزمان */
    readonly maxConnections?: number;

    /** timeout اتصال (ms) */
    readonly connectionTimeout?: number;

    /** retry */
    readonly maxRetries?: number;

    /** فعال‌سازی SSL */
    readonly ssl?: boolean;
}

/**
 * یک رکورد context در دیتابیس
 */
export interface ContextRecord {
    readonly id: string;
    readonly channelId: string;
    readonly userId: string;
    readonly content: string;
    readonly version: number;
    readonly size: number;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly checksum: string;
}

/**
 * وضعیت اتصال
 */
export type ConnectionState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "error";

/**
 * آمار دیتابیس
 */
export interface DatabaseStats {
    readonly totalRecords: number;
    readonly totalSize: number;
    readonly connectionState: ConnectionState;
    readonly activeConnections: number;
    readonly avgQueryTimeMs: number;
    readonly lastError: string | null;
}

// ============================================================
// 💽 DATABASE STORAGE
// ============================================================

/**
 * پیاده‌سازی IContextStorage با دیتابیس
 *
 * این کلاس فعلاً یک **placeholder** هست.
 * وقتی پروژه از فاز فایل‌محور خارج شد، پیاده‌سازی واقعی اضافه می‌شه.
 *
 * مزایای دیتابیس نسبت به فایل:
 * - Concurrent access بدون lock
 * - Query و Search بهتر
 * - Backup/Restore ساده‌تر
 * - Scalability بالاتر
 * - Transaction support
 *
 * ```
 * Phase 1: FileStorage ← الان اینجاییم
 * Phase 2: DatabaseStorage (PostgreSQL)
 * Phase 3: Hybrid (hot: DB, cold: File)
 * ```
 *
 * Schema پیشنهادی:
 *
 * ```sql
 * CREATE TABLE contexts (
 *   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   channel_id  VARCHAR(64) NOT NULL,
 *   user_id     VARCHAR(64) NOT NULL,
 *   content     TEXT NOT NULL,
 *   version     INTEGER DEFAULT 1,
 *   size        INTEGER NOT NULL,
 *   checksum    VARCHAR(64) NOT NULL,
 *   created_at  TIMESTAMP DEFAULT NOW(),
 *   updated_at  TIMESTAMP DEFAULT NOW(),
 *
 *   UNIQUE(channel_id, user_id)
 * );
 *
 * CREATE TABLE memory_entries (
 *   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   context_id  UUID REFERENCES contexts(id),
 *   content     TEXT NOT NULL,
 *   type        VARCHAR(32) NOT NULL,
 *   importance  VARCHAR(16) NOT NULL,
 *   domains     VARCHAR(32)[] DEFAULT '{}',
 *   tags        VARCHAR(64)[] DEFAULT '{}',
 *   source      VARCHAR(32) NOT NULL,
 *   pinned      BOOLEAN DEFAULT FALSE,
 *   recall_count INTEGER DEFAULT 0,
 *   expires_at  TIMESTAMP,
 *   created_at  TIMESTAMP DEFAULT NOW(),
 *   updated_at  TIMESTAMP DEFAULT NOW()
 * );
 *
 * CREATE TABLE context_backups (
 *   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   context_id  UUID REFERENCES contexts(id),
 *   content     TEXT NOT NULL,
 *   version     INTEGER NOT NULL,
 *   created_at  TIMESTAMP DEFAULT NOW()
 * );
 *
 * -- Indexes
 * CREATE INDEX idx_memory_type ON memory_entries(type);
 * CREATE INDEX idx_memory_domains ON memory_entries USING GIN(domains);
 * CREATE INDEX idx_memory_tags ON memory_entries USING GIN(tags);
 * CREATE INDEX idx_memory_pinned ON memory_entries(pinned) WHERE pinned = TRUE;
 * CREATE INDEX idx_memory_expires ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;
 * ```
 *
 * @example
 * ```typescript
 * // آینده:
 * const dbStorage = new DatabaseStorage({
 *   type: "postgres",
 *   connectionString: process.env.DATABASE_URL!,
 *   maxConnections: 10,
 * });
 *
 * await dbStorage.connect();
 * await dbStorage.migrate();
 *
 * await dbStorage.saveContext("ch_123", "usr_456", markdownContent);
 * ```
 */
export class DatabaseStorage implements IContextStorage {
    private config: DatabaseConfig;
    private state: ConnectionState = "disconnected";
    private queryCount: number = 0;
    private totalQueryTime: number = 0;
    private lastError: string | null = null;

    constructor(config: DatabaseConfig) {
        this.config = config;
    }

    // ============================================================
    // 🔌 CONNECTION LIFECYCLE
    // ============================================================

    /**
     * اتصال به دیتابیس
     */
    async connect(): Promise<void> {
        this.state = "connecting";

        try {
            // TODO: پیاده‌سازی واقعی با pg یا better-sqlite3
            // const pool = new Pool({ connectionString: this.config.connectionString });
            // await pool.query("SELECT 1");

            this.state = "connected";
            console.log(`[DatabaseStorage] Connected to ${this.config.type}`);
        } catch (error: any) {
            this.state = "error";
            this.lastError = error.message;
            throw new Error(`Database connection failed: ${error.message}`);
        }
    }

    /**
     * قطع اتصال
     */
    async disconnect(): Promise<void> {
        // TODO: pool.end()
        this.state = "disconnected";
        console.log("[DatabaseStorage] Disconnected");
    }

    /**
     * اجرای migrations
     */
    async migrate(): Promise<void> {
        this.ensureConnected();

        // TODO: اجرای SQL schema بالا
        console.log("[DatabaseStorage] Migrations applied");
    }

    /**
     * آیا متصل هست؟
     */
    isConnected(): boolean {
        return this.state === "connected";
    }

    // ============================================================
    // 📝 IContextStorage IMPLEMENTATION
    // ============================================================

    async loadContext(
        channelId: string,
        userId: string,
    ): Promise<string | null> {
        this.ensureConnected();

        // TODO: پیاده‌سازی واقعی
        // const result = await pool.query(
        //   "SELECT content FROM contexts WHERE channel_id = $1 AND user_id = $2",
        //   [channelId, userId],
        // );
        // return result.rows[0]?.content ?? null;

        this.notImplemented("loadContext");
        return null;
    }

    async saveContext(
        channelId: string,
        userId: string,
        content: string,
    ): Promise<StorageResult> {
        this.ensureConnected();

        // TODO: پیاده‌سازی واقعی
        // await pool.query(
        //   `INSERT INTO contexts (channel_id, user_id, content, size, checksum, version)
        //    VALUES ($1, $2, $3, $4, $5, 1)
        //    ON CONFLICT (channel_id, user_id)
        //    DO UPDATE SET
        //      content = $3,
        //      size = $4,
        //      checksum = $5,
        //      version = contexts.version + 1,
        //      updated_at = NOW()`,
        //   [channelId, userId, content, content.length, this.checksum(content)],
        // );

        this.notImplemented("saveContext");
        return {
            success: false,
            path: `db://${channelId}/${userId}`,
            error: "Not implemented",
        };
    }

    async deleteContext(
        channelId: string,
        userId: string,
    ): Promise<boolean> {
        this.ensureConnected();

        // TODO: DELETE FROM contexts WHERE channel_id = $1 AND user_id = $2
        this.notImplemented("deleteContext");
        return false;
    }

    async contextExists(
        channelId: string,
        userId: string,
    ): Promise<boolean> {
        this.ensureConnected();

        // TODO: SELECT EXISTS(...)
        this.notImplemented("contextExists");
        return false;
    }

    async listContexts(): Promise<Array<{
        channelId: string;
        userId: string;
        size: number;
        modifiedAt: Date;
    }>> {
        this.ensureConnected();

        // TODO: SELECT channel_id, user_id, size, updated_at FROM contexts
        this.notImplemented("listContexts");
        return [];
    }

    async backupContext(
        channelId: string,
        userId: string,
    ): Promise<string> {
        this.ensureConnected();

        // TODO: INSERT INTO context_backups SELECT ... FROM contexts
        this.notImplemented("backupContext");
        return `backup://${channelId}/${userId}/${Date.now()}`;
    }

    async restoreContext(
        channelId: string,
        userId: string,
    ): Promise<boolean> {
        this.ensureConnected();

        // TODO: UPDATE contexts SET content = (SELECT ... FROM context_backups ORDER BY created_at DESC LIMIT 1)
        this.notImplemented("restoreContext");
        return false;
    }

    // ============================================================
    // 🔍 EXTENDED QUERIES (آینده)
    // ============================================================

    /**
     * جستجو در memory entries
     *
     * @example
     * ```typescript
     * const results = await dbStorage.searchEntries({
     *   channelId: "ch_123",
     *   query: "typescript react",
     *   types: ["skill", "fact"],
     *   limit: 10,
     * });
     * ```
     */
    async searchEntries(_params: {
        channelId: string;
        userId?: string;
        query?: string;
        types?: string[];
        domains?: string[];
        tags?: string[];
        pinnedOnly?: boolean;
        limit?: number;
    }): Promise<ContextRecord[]> {
        this.ensureConnected();

        // TODO: Full-text search with ts_vector
        // SELECT * FROM memory_entries
        // WHERE context_id = (SELECT id FROM contexts WHERE channel_id = $1)
        //   AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $2)
        //   AND type = ANY($3)
        // ORDER BY ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $2)) DESC
        // LIMIT $4

        this.notImplemented("searchEntries");
        return [];
    }

    /**
     * دریافت آمار
     */
    async getStats(): Promise<DatabaseStats> {
        return {
            totalRecords: 0,
            totalSize: 0,
            connectionState: this.state,
            activeConnections: 0,
            avgQueryTimeMs: this.queryCount > 0
                ? Math.round(this.totalQueryTime / this.queryCount)
                : 0,
            lastError: this.lastError,
        };
    }

    /**
     * پاکسازی entry‌های منقضی
     */
    async cleanupExpired(): Promise<number> {
        this.ensureConnected();

        // TODO: DELETE FROM memory_entries WHERE expires_at < NOW()
        this.notImplemented("cleanupExpired");
        return 0;
    }

    // ============================================================
    // 🛠️ HELPERS
    // ============================================================

    private ensureConnected(): void {
        if (this.state !== "connected") {
            throw new Error(
                `Database not connected. Current state: ${this.state}`,
            );
        }
    }

    private notImplemented(method: string): void {
        console.warn(
            `[DatabaseStorage] ${method}() not yet implemented. ` +
            `Using FileStorage is recommended for now.`,
        );
    }

    /**
     * محاسبه checksum ساده
     */
    private checksum(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }
}

// ============================================================
// 🏭 FACTORY
// ============================================================

/**
 * ساخت Storage بر اساس تنظیمات
 *
 * @example
 * ```typescript
 * const storage = createContextStorage({
 *   type: "file",
 *   runtimeDir: "./runtime",
 * });
 *
 * // یا:
 * const storage = createContextStorage({
 *   type: "database",
 *   databaseConfig: {
 *     type: "postgres",
 *     connectionString: process.env.DATABASE_URL!,
 *   },
 * });
 * ```
 */
export function createContextStorage(config: {
    type: "file" | "database";
    runtimeDir?: string;
    databaseConfig?: DatabaseConfig;
}): IContextStorage {
    if (config.type === "database" && config.databaseConfig) {
        console.warn(
            "[Storage] DatabaseStorage is not yet fully implemented. " +
            "Falling back to FileStorage.",
        );

        // فعلاً fallback به FileStorage
        // وقتی DatabaseStorage کامل شد، این خط حذف میشه:
        if (!config.runtimeDir) {
            throw new Error("runtimeDir is required for FileStorage fallback");
        }

        const { FileStorage, ContextFileStorage } = require("./FileStorage");
        const fileStorage = new FileStorage(config.runtimeDir);
        return new ContextFileStorage(fileStorage);

        // آینده:
        // const db = new DatabaseStorage(config.databaseConfig);
        // await db.connect();
        // await db.migrate();
        // return db;
    }

    if (!config.runtimeDir) {
        throw new Error("runtimeDir is required for FileStorage");
    }

    const { FileStorage, ContextFileStorage } = require("./FileStorage");
    const fileStorage = new FileStorage(config.runtimeDir);
    return new ContextFileStorage(fileStorage);
}