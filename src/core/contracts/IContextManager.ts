// src/core/contracts/IContextManager.ts

import type { Message } from "../domain/entities/Message";
import type { Conversation } from "../domain/entities/Conversation";
import type { MemoryEntry, MemoryFilter, MemorySearchResult } from "../domain/entities/memory/MemoryEntry";
import type { MemorySnapshot, SnapshotPruneResult, SnapshotStats } from "../domain/entities/memory/MemorySnapshot";
import type { MemorySection, SectionType } from "../domain/entities/memory/MemorySection";
import type { ContextWindow, ContextWindowOptions } from "../domain/entities/memory/ContextWindow";
import type { MemoryType, MemoryDomain, ImportanceLevel, MemorySource } from "../domain/entities/memory/MemoryMetadata";
import type { AgentType } from "../domain/types/AgentType";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * آپشن‌های ذخیره‌سازی حافظه
 */
export interface SaveOptions {
    /** backup قبل از ذخیره */
    readonly backup?: boolean;

    /** فقط اگر تغییر کرده باشد */
    readonly onlyIfChanged?: boolean;

    /** flush cache بعد از ذخیره */
    readonly flushCache?: boolean;
}

/**
 * آپشن‌های بارگذاری حافظه
 */
export interface LoadOptions {
    /** از cache بخوان (اگر موجود باشد) */
    readonly useCache?: boolean;

    /** اگر وجود نداشت، یک snapshot خالی بساز */
    readonly createIfNotExists?: boolean;

    /** بعد از load، prune کن */
    readonly pruneOnLoad?: boolean;
}

/**
 * اطلاعات استخراج شده از مکالمه
 */
export interface ExtractedMemories {
    readonly facts: Array<{
        content: string;
        domains: MemoryDomain[];
        importance: ImportanceLevel;
    }>;

    readonly skills: Array<{
        content: string;
        importance: ImportanceLevel;
    }>;

    readonly preferences: Array<{
        content: string;
        importance: ImportanceLevel;
    }>;

    readonly emotions: Array<{
        content: string;
        trigger: string;
    }>;

    readonly projects: Array<{
        content: string;
        importance: ImportanceLevel;
    }>;
}

/**
 * نتیجه عملیات خلاصه‌سازی
 */
export interface SummarizationResult {
    readonly summary: string;
    readonly originalMessageCount: number;
    readonly originalTokenCount: number;
    readonly summaryTokenCount: number;
    readonly compressionRatio: number;
    readonly preservedFacts: string[];
}

/**
 * وضعیت سلامت حافظه یک کانال
 */
export interface MemoryHealthStatus {
    readonly channelId: string;
    readonly userId: string;
    readonly totalEntries: number;
    readonly totalTokens: number;
    readonly activeEntries: number;
    readonly expiredEntries: number;
    readonly pinnedEntries: number;
    readonly needsSummarization: boolean;
    readonly needsPruning: boolean;
    readonly lastSaved: Date | null;
    readonly lastLoaded: Date | null;
    readonly snapshotVersion: number;
    readonly fileSize: number;
}

/**
 * نتیجه maintenance
 */
export interface MaintenanceResult {
    readonly pruned: SnapshotPruneResult;
    readonly summarized: SummarizationResult | null;
    readonly expired: number;
    readonly saved: boolean;
    readonly duration: number;
}

/**
 * آپشن‌های ساخت Context Window
 */
export interface BuildContextOptions {
    /** بودجه توکن */
    readonly maxTokens: number;

    /** حداکثر پیام */
    readonly maxMessages?: number;

    /** Agent فعلی */
    readonly agentType: AgentType;

    /** system prompt */
    readonly systemPrompt: string;

    /** personality prompt */
    readonly personalityPrompt?: string;

    /** Sectionهای اولویت‌دار */
    readonly prioritySections?: SectionType[];

    /** Sectionهایی که exclude بشن */
    readonly excludeSections?: SectionType[];

    /** domainهای مرتبط */
    readonly relevantDomains?: MemoryDomain[];

    /** query برای recall حافظه مرتبط */
    readonly relevantQuery?: string;

    /** compact mode */
    readonly compact?: boolean;
}

// ============================================================
// 🧠 MAIN INTERFACE - IContextManager
// ============================================================

/**
 * مدیریت حافظه و Context ویرا
 *
 * مسئولیت‌ها:
 *   1. بارگذاری و ذخیره حافظه (Markdown files)
 *   2. اضافه/حذف/جستجوی خاطرات
 *   3. خلاصه‌سازی خودکار
 *   4. استخراج اطلاعات از مکالمه
 *   5. ساخت Context Window برای LLM
 *   6. نگهداری و پاکسازی (Maintenance)
 *
 * ```
 * Discord Message
 *      │
 *      ▼
 * ┌──────────────────────────────────────────┐
 * │           IContextManager                │
 * │                                          │
 * │  ┌──────────┐     ┌──────────────────┐  │
 * │  │  Load    │────▶│ MemorySnapshot   │  │
 * │  └──────────┘     └───────┬──────────┘  │
 * │                           │              │
 * │  ┌──────────┐     ┌──────▼──────────┐  │
 * │  │ Remember │────▶│  Add Entry      │  │
 * │  └──────────┘     └──────┬──────────┘  │
 * │                           │              │
 * │  ┌──────────┐     ┌──────▼──────────┐  │
 * │  │  Recall  │────▶│  Search         │  │
 * │  └──────────┘     └──────┬──────────┘  │
 * │                           │              │
 * │  ┌──────────┐     ┌──────▼──────────┐  │
 * │  │  Build   │────▶│ ContextWindow   │  │
 * │  │  Context │     └─────────────────┘  │
 * │  └──────────┘                           │
 * │                                          │
 * │  ┌──────────┐     ┌─────────────────┐  │
 * │  │  Save    │────▶│ Markdown File   │  │
 * │  └──────────┘     └─────────────────┘  │
 * └──────────────────────────────────────────┘
 * ```
 *
 * @example
 * ```typescript
 * class ResponsePipeline {
 *   constructor(private contextManager: IContextManager) {}
 *
 *   async process(message: Message, conversation: Conversation) {
 *     // ۱. بارگذاری حافظه
 *     await this.contextManager.load(message.channel.id, message.author.id);
 *
 *     // ۲. ساخت Context
 *     const context = await this.contextManager.buildContext(
 *       conversation,
 *       message,
 *       {
 *         maxTokens: 4096,
 *         agentType: "dev",
 *         systemPrompt: devPrompt,
 *         relevantQuery: message.content,
 *       },
 *     );
 *
 *     // ۳. ارسال به LLM
 *     const response = await llm.generate({
 *       messages: context.toLLMPayload(),
 *     });
 *
 *     // ۴. ذخیره خاطره
 *     await this.contextManager.remember(
 *       message.channel.id,
 *       message.author.id,
 *       message,
 *     );
 *
 *     // ۵. ذخیره فایل
 *     await this.contextManager.save(
 *       message.channel.id,
 *       message.author.id,
 *     );
 *   }
 * }
 * ```
 */
export interface IContextManager {
    // ─── Load & Save ──────────────────────────────────────

    /**
     * بارگذاری حافظه یک کانال/کاربر
     *
     * فایل مارک‌داون رو می‌خونه و به MemorySnapshot تبدیل می‌کنه
     *
     * @example
     * ```typescript
     * const snapshot = await contextManager.load("ch_123", "usr_456");
     * console.log(`${snapshot.totalEntries} memories loaded`);
     * ```
     */
    load(
        channelId: string,
        userId: string,
        options?: LoadOptions,
    ): Promise<MemorySnapshot>;

    /**
     * ذخیره حافظه
     *
     * MemorySnapshot رو به مارک‌داون تبدیل و ذخیره می‌کنه
     *
     * @example
     * ```typescript
     * await contextManager.save("ch_123", "usr_456", {
     *   backup: true,
     *   onlyIfChanged: true,
     * });
     * ```
     */
    save(
        channelId: string,
        userId: string,
        options?: SaveOptions,
    ): Promise<boolean>;

    /**
     * بارگذاری یا ساخت snapshot جدید
     */
    loadOrCreate(
        channelId: string,
        userId: string,
    ): Promise<MemorySnapshot>;

    /**
     * حذف حافظه یک کانال
     */
    delete(
        channelId: string,
        userId: string,
    ): Promise<boolean>;

    /**
     * آیا حافظه برای این کانال/کاربر وجود دارد؟
     */
    exists(
        channelId: string,
        userId: string,
    ): Promise<boolean>;

    // ─── Remember (ذخیره خاطره) ───────────────────────────

    /**
     * ذخیره یک خاطره جدید
     *
     * خاطره رو به بهترین Section اضافه می‌کنه
     *
     * @example
     * ```typescript
     * await contextManager.remember("ch_123", "usr_456", entry);
     * ```
     */
    remember(
        channelId: string,
        userId: string,
        entry: MemoryEntry,
    ): Promise<MemorySnapshot>;

    /**
     * ذخیره خاطره از پیام
     *
     * پیام رو تحلیل و به MemoryEntry تبدیل می‌کنه
     *
     * @example
     * ```typescript
     * await contextManager.rememberMessage(
     *   "ch_123",
     *   "usr_456",
     *   message,
     *   { type: "event", domains: ["technical"] },
     * );
     * ```
     */
    rememberMessage(
        channelId: string,
        userId: string,
        message: Message,
        hints?: {
            type?: MemoryType;
            domains?: MemoryDomain[];
            importance?: ImportanceLevel;
        },
    ): Promise<MemorySnapshot>;

    /**
     * ذخیره چند خاطره
     */
    rememberMany(
        channelId: string,
        userId: string,
        entries: MemoryEntry[],
    ): Promise<MemorySnapshot>;

    /**
     * Pin کردن یک خاطره
     *
     * @example
     * ```typescript
     * // کاربر: "یادت بمونه من قهوه دوست دارم"
     * await contextManager.pin("ch_123", "usr_456", {
     *   content: "کاربر قهوه دوست دارد",
     *   type: "preference",
     *   domains: ["personal"],
     * });
     * ```
     */
    pin(
        channelId: string,
        userId: string,
        params: {
            content: string;
            type: MemoryType;
            domains: MemoryDomain[];
            tags?: string[];
        },
    ): Promise<MemorySnapshot>;

    /**
     * Unpin کردن یک خاطره
     */
    unpin(
        channelId: string,
        userId: string,
        entryId: string,
    ): Promise<MemorySnapshot>;

    // ─── Recall (بازیابی) ─────────────────────────────────

    /**
     * جستجو در حافظه
     *
     * @example
     * ```typescript
     * const results = await contextManager.recall(
     *   "ch_123",
     *   "usr_456",
     *   "typescript react",
     *   10,
     * );
     *
     * for (const { entry, score } of results) {
     *   console.log(`[${score}] ${entry.content}`);
     * }
     * ```
     */
    recall(
        channelId: string,
        userId: string,
        query: string,
        limit?: number,
    ): Promise<MemorySearchResult[]>;

    /**
     * جستجو و به‌روزرسانی recall count
     */
    recallAndTrack(
        channelId: string,
        userId: string,
        query: string,
        limit?: number,
    ): Promise<MemorySearchResult[]>;

    /**
     * دریافت حافظه‌های pin شده
     */
    getPinned(
        channelId: string,
        userId: string,
    ): Promise<MemoryEntry[]>;

    /**
     * فیلتر کردن حافظه‌ها
     */
    filter(
        channelId: string,
        userId: string,
        filter: MemoryFilter,
    ): Promise<MemoryEntry[]>;

    /**
     * دریافت حافظه‌ها بر اساس domain
     */
    getByDomain(
        channelId: string,
        userId: string,
        domain: MemoryDomain,
    ): Promise<MemoryEntry[]>;

    /**
     * دریافت حافظه‌ها بر اساس نوع
     */
    getByType(
        channelId: string,
        userId: string,
        type: MemoryType,
    ): Promise<MemoryEntry[]>;

    /**
     * دریافت یک entry خاص
     */
    getEntry(
        channelId: string,
        userId: string,
        entryId: string,
    ): Promise<MemoryEntry | undefined>;

    // ─── Context Building ─────────────────────────────────

    /**
     * ساخت Context Window برای ارسال به LLM
     *
     * هوشمندانه ترکیب می‌کنه:
     * - System Prompt
     * - Personality
     * - Long-term Memory
     * - Relevant Memories
     * - Conversation History
     * - Current Message
     *
     * @example
     * ```typescript
     * const context = await contextManager.buildContext(
     *   conversation,
     *   currentMessage,
     *   {
     *     maxTokens: 4096,
     *     agentType: "dev",
     *     systemPrompt: devSystemPrompt,
     *     personalityPrompt: personalityMd,
     *     relevantQuery: currentMessage.content,
     *     prioritySections: ["skills", "projects"],
     *   },
     * );
     *
     * const response = await llm.generate({
     *   messages: context.toLLMPayload(),
     * });
     * ```
     */
    buildContext(
        conversation: Conversation,
        currentMessage: Message,
        options: BuildContextOptions,
    ): Promise<ContextWindow>;

    /**
     * ساخت Context سبک (بدون memory)
     *
     * برای routing یا کارهای ساده
     */
    buildMinimalContext(
        currentMessage: Message,
        systemPrompt: string,
        recentMessages?: Message[],
    ): ContextWindow;

    // ─── Extraction ───────────────────────────────────────

    /**
     * استخراج خودکار اطلاعات از مکالمه
     *
     * LLM مکالمه رو تحلیل می‌کنه و fact/skill/preference استخراج می‌کنه
     *
     * @example
     * ```typescript
     * const extracted = await contextManager.extractMemories(
     *   conversation,
     *   "ch_123",
     *   "usr_456",
     * );
     *
     * console.log(`Found ${extracted.facts.length} facts`);
     * console.log(`Found ${extracted.skills.length} skills`);
     *
     * // ذخیره خودکار
     * await contextManager.applyExtracted(
     *   "ch_123",
     *   "usr_456",
     *   extracted,
     * );
     * ```
     */
    extractMemories(
        conversation: Conversation,
        channelId: string,
        userId: string,
    ): Promise<ExtractedMemories>;

    /**
     * اعمال اطلاعات استخراج شده به حافظه
     */
    applyExtracted(
        channelId: string,
        userId: string,
        extracted: ExtractedMemories,
    ): Promise<MemorySnapshot>;

    // ─── Summarization ────────────────────────────────────

    /**
     * خلاصه‌سازی پیام‌های قدیمی
     *
     * وقتی مکالمه بلند شد، پیام‌های قدیمی رو خلاصه می‌کنه
     *
     * @example
     * ```typescript
     * const result = await contextManager.summarize(
     *   "ch_123",
     *   "usr_456",
     *   conversation,
     * );
     *
     * if (result) {
     *   console.log(`Compressed ${result.originalMessageCount} msgs`);
     *   console.log(`Ratio: ${result.compressionRatio}`);
     * }
     * ```
     */
    summarize(
        channelId: string,
        userId: string,
        conversation: Conversation,
    ): Promise<SummarizationResult | null>;

    /**
     * آیا مکالمه نیاز به خلاصه‌سازی دارد؟
     */
    needsSummarization(
        channelId: string,
        userId: string,
        conversation: Conversation,
    ): Promise<boolean>;

    // ─── Maintenance ──────────────────────────────────────

    /**
     * نگهداری حافظه
     *
     * شامل:
     * 1. حذف منقضی‌ها
     * 2. Prune
     * 3. خلاصه‌سازی (اگر لازم باشه)
     * 4. ذخیره
     *
     * @example
     * ```typescript
     * const result = await contextManager.maintain(
     *   "ch_123",
     *   "usr_456",
     *   conversation,
     * );
     *
     * console.log(`Pruned: ${result.pruned.totalRemoved}`);
     * console.log(`Expired: ${result.expired}`);
     * ```
     */
    maintain(
        channelId: string,
        userId: string,
        conversation?: Conversation,
    ): Promise<MaintenanceResult>;

    /**
     * نگهداری تمام حافظه‌ها
     *
     * برای اجرای دوره‌ای (مثلاً هر ساعت)
     */
    maintainAll(): Promise<Record<string, MaintenanceResult>>;

    /**
     * Prune یک حافظه
     */
    prune(
        channelId: string,
        userId: string,
    ): Promise<SnapshotPruneResult>;

    /**
     * Prune تا بودجه توکن
     */
    pruneToTokenBudget(
        channelId: string,
        userId: string,
        maxTokens: number,
    ): Promise<SnapshotPruneResult>;

    // ─── Health & Stats ───────────────────────────────────

    /**
     * وضعیت سلامت حافظه
     */
    health(
        channelId: string,
        userId: string,
    ): Promise<MemoryHealthStatus>;

    /**
     * آمار حافظه
     */
    stats(
        channelId: string,
        userId: string,
    ): Promise<SnapshotStats>;

    /**
     * آمار تمام حافظه‌ها
     */
    statsAll(): Promise<Array<{
        channelId: string;
        userId: string;
        stats: SnapshotStats;
    }>>;

    /**
     * لیست تمام حافظه‌های موجود
     */
    listAll(): Promise<Array<{
        channelId: string;
        userId: string;
        size: number;
        modifiedAt: Date;
    }>>;

    // ─── Snapshot Access ──────────────────────────────────

    /**
     * دسترسی مستقیم به Snapshot فعلی (از cache)
     *
     * بدون IO - فقط از حافظه RAM
     */
    getSnapshot(
        channelId: string,
        userId: string,
    ): MemorySnapshot | undefined;

    /**
     * آیا Snapshot در cache هست؟
     */
    isCached(
        channelId: string,
        userId: string,
    ): boolean;

    /**
     * پاکسازی cache
     */
    clearCache(channelId?: string, userId?: string): void;

    // ─── Backup & Recovery ────────────────────────────────

    /**
     * backup گرفتن
     */
    backup(
        channelId: string,
        userId: string,
    ): Promise<string>;

    /**
     * بازیابی از backup
     */
    restore(
        channelId: string,
        userId: string,
    ): Promise<boolean>;

    /**
     * لیست backupها
     */
    listBackups(
        channelId: string,
        userId: string,
    ): Promise<Array<{
        path: string;
        size: number;
        createdAt: Date;
    }>>;
}

// ============================================================
// 🧠 SPECIALIZED INTERFACES
// ============================================================

/**
 * سرویس استخراج اطلاعات
 *
 * جدا شده تا بتونه مستقل تست و توسعه بشه
 *
 * @example
 * ```typescript
 * class LLMMemoryExtractor implements IMemoryExtractor {
 *   constructor(private llm: ILLMPort) {}
 *
 *   async extract(conversation: Conversation) {
 *     const response = await this.llm.generate({
 *       messages: [
 *         { role: "system", content: extractionPrompt },
 *         { role: "user", content: conversation.toMarkdown() },
 *       ],
 *       params: { jsonMode: true },
 *     });
 *     return JSON.parse(response.content);
 *   }
 * }
 * ```
 */
export interface IMemoryExtractor {
    /**
     * استخراج اطلاعات از مکالمه
     */
    extract(
        conversation: Conversation,
        existingMemory?: MemorySnapshot,
    ): Promise<ExtractedMemories>;

    /**
     * آیا مکالمه حاوی اطلاعات قابل استخراج هست؟
     */
    hasExtractableContent(conversation: Conversation): boolean;
}

/**
 * سرویس خلاصه‌سازی
 *
 * @example
 * ```typescript
 * class LLMSummarizer implements IMemorySummarizer {
 *   constructor(private llm: ILLMPort) {}
 *
 *   async summarize(messages: Message[]) {
 *     const text = messages.map(m => m.toMemoryFormat()).join("\n");
 *     const response = await this.llm.generate({
 *       messages: [
 *         { role: "system", content: summarizationPrompt },
 *         { role: "user", content: text },
 *       ],
 *     });
 *     return response.content;
 *   }
 * }
 * ```
 */
export interface IMemorySummarizer {
    /**
     * خلاصه‌سازی پیام‌ها
     */
    summarize(
        messages: Message[],
        existingFacts?: string[],
    ): Promise<SummarizationResult>;

    /**
     * آیا این تعداد پیام نیاز به خلاصه‌سازی دارد؟
     */
    shouldSummarize(
        messageCount: number,
        totalTokens: number,
    ): boolean;
}

/**
 * ایندکس حافظه برای جستجوی سریع
 *
 * @example
 * ```typescript
 * class InMemoryIndex implements IMemoryIndex {
 *   private entries = new Map<string, MemoryEntry>();
 *
 *   async search(query: string, limit: number) {
 *     return MemoryEntry.search([...this.entries.values()], query, limit);
 *   }
 * }
 * ```
 */
export interface IMemoryIndex {
    /**
     * ایندکس کردن یک entry
     */
    index(entry: MemoryEntry): Promise<void>;

    /**
     * ایندکس کردن چند entry
     */
    indexMany(entries: MemoryEntry[]): Promise<void>;

    /**
     * حذف از ایندکس
     */
    remove(entryId: string): Promise<void>;

    /**
     * جستجو
     */
    search(
        query: string,
        limit?: number,
        filter?: MemoryFilter,
    ): Promise<MemorySearchResult[]>;

    /**
     * بازسازی ایندکس
     */
    rebuild(entries: MemoryEntry[]): Promise<void>;

    /**
     * پاکسازی ایندکس
     */
    clear(): Promise<void>;

    /**
     * تعداد آیتم‌های ایندکس شده
     */
    size(): number;
}

// ============================================================
// 🛠️ HELPER TYPES
// ============================================================

/**
 * کلید یکتای حافظه (channel + user)
 */
export interface MemoryKey {
    readonly channelId: string;
    readonly userId: string;
}

/**
 * ساخت کلید حافظه
 */
export function createMemoryKey(
    channelId: string,
    userId: string,
): string {
    return `${channelId}:${userId}`;
}

/**
 * پارس کلید حافظه
 */
export function parseMemoryKey(key: string): MemoryKey | null {
    const parts = key.split(":");
    if (parts.length !== 2) return null;

    return {
        channelId: parts[0],
        userId: parts[1],
    };
}

/**
 * تنظیمات maintenance
 */
export interface MaintenanceConfig {
    /** فعال باشه؟ */
    readonly enabled: boolean;

    /** هر چند دقیقه اجرا بشه */
    readonly intervalMinutes: number;

    /** خلاصه‌سازی خودکار فعال باشه؟ */
    readonly autoSummarize: boolean;

    /** استخراج خودکار فعال باشه؟ */
    readonly autoExtract: boolean;

    /** Prune خودکار فعال باشه؟ */
    readonly autoPrune: boolean;

    /** Backup خودکار فعال باشه؟ */
    readonly autoBackup: boolean;

    /** حداکثر سن backup (ساعت) */
    readonly maxBackupAgeHours: number;
}

/**
 * تنظیمات پیش‌فرض maintenance
 */
export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
    enabled: true,
    intervalMinutes: 60,
    autoSummarize: true,
    autoExtract: true,
    autoPrune: true,
    autoBackup: true,
    maxBackupAgeHours: 168,  // 7 روز
} as const;