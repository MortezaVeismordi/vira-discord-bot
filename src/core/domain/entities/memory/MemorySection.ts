// src/core/domain/entities/memory/MemorySection.ts

import {
    MemoryEntry,
    type MemoryFilter,
    type MemorySearchResult,
    type MemoryStats,
} from "./MemoryEntry";
import type {
    MemoryType,
    MemoryDomain,
    ImportanceLevel,
} from "./MemoryMetadata";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * نوع بخش حافظه - هر بخش یک هدر مارک‌داون مستقل دارد
 *
 * هر Section یک "دسته‌بندی" از حافظه‌هاست
 * که در فایل مارک‌داون به صورت ## Header نمایش داده می‌شود
 */
export type SectionType =
    | "profile"           // پروفایل کاربر
    | "pinned"            // حافظه‌های pin شده
    | "skills"            // مهارت‌ها
    | "projects"          // پروژه‌ها
    | "preferences"       // ترجیحات
    | "facts"             // حقایق عمومی
    | "relationship"      // رابطه ویرا و کاربر
    | "recent-events"     // رویدادهای اخیر
    | "conversation"      // تاریخچه مکالمه
    | "summaries";        // خلاصه‌های قبلی

/**
 * تنظیمات هر بخش
 */
export interface SectionConfig {
    readonly type: SectionType;
    readonly title: string;
    readonly icon: string;
    readonly maxEntries: number;
    readonly priority: number;       // بالاتر = زودتر در context
    readonly alwaysInclude: boolean;  // حتی اگر خالی باشد
    readonly pruneStrategy: "oldest" | "lowest-relevance" | "none";
    readonly acceptedMemoryTypes: MemoryType[];
}

/**
 * نتیجه عملیات Prune
 */
export interface PruneResult {
    readonly removed: MemoryEntry[];
    readonly summarized: MemoryEntry[];
    readonly kept: MemoryEntry[];
    readonly freedTokens: number;
}

// ============================================================
// 📋 SECTION CONFIGS - تنظیمات پیش‌فرض هر بخش
// ============================================================

export const DEFAULT_SECTION_CONFIGS: Record<SectionType, SectionConfig> = {
    profile: {
        type: "profile",
        title: "پروفایل کاربر",
        icon: "👤",
        maxEntries: 10,
        priority: 100,       // بالاترین اولویت
        alwaysInclude: true,
        pruneStrategy: "none",
        acceptedMemoryTypes: ["fact", "skill", "preference"],
    },

    pinned: {
        type: "pinned",
        title: "یادداشت‌های مهم",
        icon: "📌",
        maxEntries: 20,
        priority: 95,
        alwaysInclude: true,
        pruneStrategy: "none", // هرگز حذف نشود
        acceptedMemoryTypes: ["pinned", "fact", "preference", "skill", "project"],
    },

    skills: {
        type: "skills",
        title: "مهارت‌ها",
        icon: "🛠️",
        maxEntries: 15,
        priority: 85,
        alwaysInclude: false,
        pruneStrategy: "lowest-relevance",
        acceptedMemoryTypes: ["skill"],
    },

    projects: {
        type: "projects",
        title: "پروژه‌ها",
        icon: "📂",
        maxEntries: 10,
        priority: 80,
        alwaysInclude: false,
        pruneStrategy: "lowest-relevance",
        acceptedMemoryTypes: ["project"],
    },

    preferences: {
        type: "preferences",
        title: "ترجیحات",
        icon: "⭐",
        maxEntries: 15,
        priority: 75,
        alwaysInclude: false,
        pruneStrategy: "lowest-relevance",
        acceptedMemoryTypes: ["preference"],
    },

    facts: {
        type: "facts",
        title: "حقایق",
        icon: "📋",
        maxEntries: 20,
        priority: 70,
        alwaysInclude: false,
        pruneStrategy: "oldest",
        acceptedMemoryTypes: ["fact"],
    },

    relationship: {
        type: "relationship",
        title: "رابطه ما",
        icon: "💚",
        maxEntries: 10,
        priority: 90,
        alwaysInclude: true,
        pruneStrategy: "oldest",
        acceptedMemoryTypes: ["emotion", "event"],
    },

    "recent-events": {
        type: "recent-events",
        title: "رویدادهای اخیر",
        icon: "📅",
        maxEntries: 15,
        priority: 60,
        alwaysInclude: false,
        pruneStrategy: "oldest",
        acceptedMemoryTypes: ["event"],
    },

    conversation: {
        type: "conversation",
        title: "مکالمه اخیر",
        icon: "💬",
        maxEntries: 50,
        priority: 50,
        alwaysInclude: true,
        pruneStrategy: "oldest",
        acceptedMemoryTypes: ["event", "fact", "emotion"],
    },

    summaries: {
        type: "summaries",
        title: "خلاصه مکالمات قبلی",
        icon: "📝",
        maxEntries: 10,
        priority: 40,
        alwaysInclude: false,
        pruneStrategy: "oldest",
        acceptedMemoryTypes: ["summary"],
    },
} as const;

// ============================================================
// 📂 MEMORY SECTION CLASS
// ============================================================

/**
 * یک بخش از حافظه مارک‌داون ویرا
 *
 * هر Section = یک ## Header در فایل context
 *
 * مثال:
 * ```markdown
 * ## 📌 یادداشت‌های مهم
 * <!-- meta:pinned:critical:personal:1703001600:pinned -->
 * - علی قهوه دوست داره
 * <!-- meta:skill:high:technical:1703001600 -->
 * - علی TypeScript کار می‌کنه
 * ```
 *
 * Immutable - هر تغییر instance جدید می‌سازد.
 *
 * @example
 * ```typescript
 * const section = MemorySection.create("pinned");
 * const updated = section.addEntry(entry);
 * const pruned = updated.prune();
 * const markdown = pruned.section.toMarkdown();
 * ```
 */
export class MemorySection {
    // ─── Core ────────────────────────────────────────────────
    public readonly config: SectionConfig;
    public readonly entries: readonly MemoryEntry[];

    // ─── Private Constructor ─────────────────────────────────
    private constructor(params: {
        config: SectionConfig;
        entries: readonly MemoryEntry[];
    }) {
        this.config = params.config;
        this.entries = params.entries;
    }

    // ============================================================
    // 🏭 FACTORIES
    // ============================================================

    /**
     * ساخت Section خالی
     *
     * @example
     * ```typescript
     * const pinned = MemorySection.create("pinned");
     * const skills = MemorySection.create("skills");
     * const conversation = MemorySection.create("conversation");
     * ```
     */
    static create(
        type: SectionType,
        configOverrides?: Partial<SectionConfig>,
    ): MemorySection {
        const baseConfig = DEFAULT_SECTION_CONFIGS[type];
        const config = configOverrides
            ? { ...baseConfig, ...configOverrides }
            : baseConfig;

        return new MemorySection({
            config,
            entries: [],
        });
    }

    /**
     * ساخت Section با entryهای موجود
     *
     * @example
     * ```typescript
     * const section = MemorySection.withEntries("facts", [
     *   entry1,
     *   entry2,
     *   entry3,
     * ]);
     * ```
     */
    static withEntries(
        type: SectionType,
        entries: MemoryEntry[],
        configOverrides?: Partial<SectionConfig>,
    ): MemorySection {
        const section = MemorySection.create(type, configOverrides);

        // فقط entryهای مجاز رو قبول کن
        const validEntries = entries.filter((entry) =>
            section.config.acceptedMemoryTypes.includes(entry.metadata.type)
        );

        return new MemorySection({
            config: section.config,
            entries: validEntries,
        });
    }

    /**
     * ساخت Section از مارک‌داون
     *
     * @example
     * ```typescript
     * const section = MemorySection.fromMarkdown(
     *   "## 📌 یادداشت‌های مهم\n...",
     *   "pinned",
     *   "ch_123",
     *   "usr_456",
     * );
     * ```
     */
    static fromMarkdown(
        markdown: string,
        type: SectionType,
        channelId: string,
        userId: string,
    ): MemorySection {
        const section = MemorySection.create(type);
        const entries: MemoryEntry[] = [];

        // Split to blocks (هر بلاک = یک meta comment + content)
        const blocks = MemorySection.parseMarkdownBlocks(markdown);

        for (const block of blocks) {
            const entry = MemoryEntry.fromMarkdown(block, channelId, userId);
            if (entry && section.accepts(entry)) {
                entries.push(entry);
            }
        }

        return new MemorySection({
            config: section.config,
            entries,
        });
    }

    // ============================================================
    // 🔄 MUTATIONS (Immutable)
    // ============================================================

    /**
     * اضافه کردن یک entry
     *
     * @returns Section جدید یا null اگر entry مجاز نباشد
     *
     * @example
     * ```typescript
     * const updated = section.addEntry(newEntry);
     * if (!updated) {
     *   console.log("Entry type not accepted by this section");
     * }
     * ```
     */
    addEntry(entry: MemoryEntry): MemorySection | null {
        if (!this.accepts(entry)) return null;

        // جلوگیری از تکراری
        if (this.hasEntry(entry.id)) return this;

        return new MemorySection({
            config: this.config,
            entries: [...this.entries, entry],
        });
    }

    /**
     * اضافه کردن چند entry
     */
    addEntries(entries: MemoryEntry[]): MemorySection {
        const validEntries = entries.filter(
            (entry) => this.accepts(entry) && !this.hasEntry(entry.id),
        );

        if (validEntries.length === 0) return this;

        return new MemorySection({
            config: this.config,
            entries: [...this.entries, ...validEntries],
        });
    }

    /**
     * حذف یک entry
     */
    removeEntry(entryId: string): MemorySection {
        const filtered = this.entries.filter((e) => e.id !== entryId);

        if (filtered.length === this.entries.length) return this;

        return new MemorySection({
            config: this.config,
            entries: filtered,
        });
    }

    /**
     * حذف چند entry
     */
    removeEntries(entryIds: string[]): MemorySection {
        const idSet = new Set(entryIds);
        const filtered = this.entries.filter((e) => !idSet.has(e.id));

        return new MemorySection({
            config: this.config,
            entries: filtered,
        });
    }

    /**
     * جایگزینی یک entry (مثلاً بعد از recall)
     */
    replaceEntry(entryId: string, newEntry: MemoryEntry): MemorySection {
        const index = this.entries.findIndex((e) => e.id === entryId);
        if (index === -1) return this;

        const updated = [...this.entries];
        updated[index] = newEntry;

        return new MemorySection({
            config: this.config,
            entries: updated,
        });
    }

    /**
     * به‌روزرسانی entry (مثل recall، pin، etc)
     */
    updateEntry(
        entryId: string,
        updater: (entry: MemoryEntry) => MemoryEntry,
    ): MemorySection {
        const entry = this.getEntry(entryId);
        if (!entry) return this;

        return this.replaceEntry(entryId, updater(entry));
    }

    /**
     * recall یک entry
     */
    recallEntry(entryId: string): MemorySection {
        return this.updateEntry(entryId, (entry) => entry.recall());
    }

    /**
     * پاکسازی entryهای منقضی
     */
    removeExpired(): MemorySection {
        const filtered = this.entries.filter((e) => !e.isExpired());

        if (filtered.length === this.entries.length) return this;

        return new MemorySection({
            config: this.config,
            entries: filtered,
        });
    }

    // ============================================================
    // ✂️ PRUNING
    // ============================================================

    /**
     * Prune = حذف هوشمند برای آزادسازی فضا
     *
     * @returns PruneResult با جزئیات آنچه اتفاق افتاد
     *
     * @example
     * ```typescript
     * const result = section.prune();
     * console.log(`${result.removed.length} entries removed`);
     * console.log(`${result.freedTokens} tokens freed`);
     * ```
     */
    prune(): { section: MemorySection; result: PruneResult } {
        if (this.config.pruneStrategy === "none") {
            return {
                section: this,
                result: {
                    removed: [],
                    summarized: [],
                    kept: [...this.entries],
                    freedTokens: 0,
                },
            };
        }

        // ابتدا منقضی‌ها رو حذف کن
        const afterExpiry = this.entries.filter((e) => !e.isExpired());
        const expiredEntries = this.entries.filter((e) => e.isExpired());

        // اگر هنوز بیش از حد هست، prune کن
        let toKeep: MemoryEntry[];
        let toRemove: MemoryEntry[];

        if (afterExpiry.length <= this.config.maxEntries) {
            toKeep = afterExpiry;
            toRemove = expiredEntries;
        } else {
            const sorted = this.sortForPruning(afterExpiry);
            toKeep = sorted.slice(0, this.config.maxEntries);
            toRemove = [
                ...expiredEntries,
                ...sorted.slice(this.config.maxEntries),
            ];
        }

        // حافظه‌هایی که باید خلاصه بشن
        const toSummarize = toKeep.filter((e) => e.needsSummarization());

        const freedTokens = toRemove.reduce(
            (sum, entry) => sum + entry.estimatedTokens,
            0,
        );

        return {
            section: new MemorySection({
                config: this.config,
                entries: toKeep,
            }),
            result: {
                removed: toRemove,
                summarized: toSummarize,
                kept: toKeep,
                freedTokens,
            },
        };
    }

    /**
     * Prune تا رسیدن به حد مشخصی از توکن
     */
    pruneToTokenLimit(maxTokens: number): {
        section: MemorySection;
        result: PruneResult;
    } {
        if (this.totalTokens <= maxTokens) {
            return {
                section: this,
                result: {
                    removed: [],
                    summarized: [],
                    kept: [...this.entries],
                    freedTokens: 0,
                },
            };
        }

        const sorted = this.sortForPruning([...this.entries]);
        const kept: MemoryEntry[] = [];
        const removed: MemoryEntry[] = [];
        let currentTokens = 0;

        for (const entry of sorted) {
            if (currentTokens + entry.estimatedTokens <= maxTokens) {
                kept.push(entry);
                currentTokens += entry.estimatedTokens;
            } else {
                // pin شده‌ها هرگز حذف نشوند
                if (entry.isPinned()) {
                    kept.push(entry);
                    currentTokens += entry.estimatedTokens;
                } else {
                    removed.push(entry);
                }
            }
        }

        return {
            section: new MemorySection({
                config: this.config,
                entries: kept,
            }),
            result: {
                removed,
                summarized: [],
                kept,
                freedTokens: removed.reduce(
                    (sum, e) => sum + e.estimatedTokens,
                    0,
                ),
            },
        };
    }

    // ============================================================
    // 🔍 QUERY METHODS
    // ============================================================

    /**
     * آیا این entry در Section قابل قبوله؟
     */
    accepts(entry: MemoryEntry): boolean {
        return this.config.acceptedMemoryTypes.includes(entry.metadata.type);
    }

    /**
     * آیا entry با این ID وجود دارد؟
     */
    hasEntry(entryId: string): boolean {
        return this.entries.some((e) => e.id === entryId);
    }

    /**
     * دریافت entry با ID
     */
    getEntry(entryId: string): MemoryEntry | undefined {
        return this.entries.find((e) => e.id === entryId);
    }

    /**
     * آیا Section خالی است؟
     */
    get isEmpty(): boolean {
        return this.entries.length === 0;
    }

    /**
     * تعداد entry‌ها
     */
    get size(): number {
        return this.entries.length;
    }

    /**
     * مجموع توکن‌ها
     */
    get totalTokens(): number {
        return this.entries.reduce(
            (sum, entry) => sum + entry.estimatedTokens,
            0,
        );
    }

    /**
     * آیا Section پُر است؟
     */
    get isFull(): boolean {
        return this.entries.length >= this.config.maxEntries;
    }

    /**
     * چند جا خالیه؟
     */
    get remainingCapacity(): number {
        return Math.max(0, this.config.maxEntries - this.entries.length);
    }

    /**
     * تعداد entryهای فعال
     */
    get activeCount(): number {
        return this.entries.filter((e) => e.isActive()).length;
    }

    /**
     * تعداد entryهای منقضی
     */
    get expiredCount(): number {
        return this.entries.filter((e) => e.isExpired()).length;
    }

    /**
     * تعداد entryهای pin شده
     */
    get pinnedCount(): number {
        return this.entries.filter((e) => e.isPinned()).length;
    }

    /**
     * میانگین relevance score
     */
    get averageRelevance(): number {
        if (this.entries.length === 0) return 0;

        const total = this.entries.reduce(
            (sum, e) => sum + e.relevanceScore,
            0,
        );
        return Math.round((total / this.entries.length) * 100) / 100;
    }

    /**
     * فیلتر کردن entryها
     */
    filter(filter: MemoryFilter): MemoryEntry[] {
        return MemoryEntry.filter([...this.entries], filter);
    }

    /**
     * جستجو در Section
     */
    search(query: string, limit?: number): MemorySearchResult[] {
        return MemoryEntry.search([...this.entries], query, limit);
    }

    /**
     * آمار Section
     */
    get stats(): MemoryStats {
        return MemoryEntry.calculateStats([...this.entries]);
    }

    // ============================================================
    // 📦 SERIALIZATION
    // ============================================================

    /**
     * تبدیل به مارک‌داون
     *
     * @example
     * ```markdown
     * ## 📌 یادداشت‌های مهم
     *
     * <!-- meta:pinned:critical:personal:1703001600:pinned -->
     * - علی قهوه دوست داره
     *
     * <!-- meta:skill:high:technical:1703001600 -->
     * - علی TypeScript کار می‌کنه
     * ```
     */
    toMarkdown(): string {
        const header = `## ${this.config.icon} ${this.config.title}`;

        if (this.isEmpty) {
            if (this.config.alwaysInclude) {
                return `${header}\n\n_هنوز اطلاعاتی ثبت نشده_\n`;
            }
            return "";
        }

        // مرتب‌سازی: pinned اول، بعد بر اساس relevance
        const sortedEntries = this.getSortedEntries();

        const entriesMarkdown = sortedEntries
            .map((entry) => entry.toMarkdown())
            .join("\n\n");

        return `${header}\n\n${entriesMarkdown}\n`;
    }

    /**
     * تبدیل به مارک‌داون فشرده (برای context کم)
     */
    toCompactMarkdown(): string {
        if (this.isEmpty && !this.config.alwaysInclude) return "";

        const header = `## ${this.config.icon} ${this.config.title}`;

        if (this.isEmpty) {
            return `${header}\n_خالی_\n`;
        }

        // فقط مهم‌ترین‌ها
        const topEntries = MemoryEntry.sortByRelevance([...this.entries])
            .slice(0, Math.ceil(this.config.maxEntries / 2));

        const entriesText = topEntries
            .map((entry) => entry.toCompactFormat())
            .join("\n");

        return `${header}\n${entriesText}\n`;
    }

    /**
     * خروجی برای context window
     * شامل بودجه توکن
     */
    toContextOutput(tokenBudget?: number): string {
        if (this.isEmpty && !this.config.alwaysInclude) return "";

        if (!tokenBudget || this.totalTokens <= tokenBudget) {
            return this.toMarkdown();
        }

        // اگر بودجه کمه، فشرده بنویس
        if (tokenBudget < this.totalTokens * 0.5) {
            return this.toCompactMarkdown();
        }

        // بودجه متوسط: مهم‌ترین‌ها رو کامل بنویس
        const selected = MemoryEntry.selectForContext(
            [...this.entries],
            tokenBudget,
        );

        const header = `## ${this.config.icon} ${this.config.title}`;
        const entriesMarkdown = selected
            .map((entry) => entry.toMarkdown())
            .join("\n\n");

        return `${header}\n\n${entriesMarkdown}\n`;
    }

    /**
     * تبدیل به JSON
     */
    toJSON(): Record<string, unknown> {
        return {
            type: this.config.type,
            title: this.config.title,
            size: this.size,
            totalTokens: this.totalTokens,
            activeCount: this.activeCount,
            expiredCount: this.expiredCount,
            pinnedCount: this.pinnedCount,
            averageRelevance: this.averageRelevance,
            isFull: this.isFull,
            entries: this.entries.map((e) => e.toJSON()),
        };
    }

    // ============================================================
    // 🔧 PRIVATE HELPERS
    // ============================================================

    /**
     * مرتب‌سازی entryها برای نمایش
     *
     * اولویت:
     * 1. pinned
     * 2. بر اساس relevanceScore
     */
    private getSortedEntries(): MemoryEntry[] {
        const pinned = this.entries.filter((e) => e.isPinned());
        const unpinned = this.entries.filter((e) => !e.isPinned());

        const sortedUnpinned = MemoryEntry.sortByRelevance(unpinned);

        return [...pinned, ...sortedUnpinned];
    }

    /**
     * مرتب‌سازی برای Pruning
     *
     * بر اساس استراتژی Section:
     * - oldest: قدیمی‌ترین حذف بشه
     * - lowest-relevance: کم‌اهمیت‌ترین حذف بشه
     */
    private sortForPruning(entries: MemoryEntry[]): MemoryEntry[] {
        // pinned همیشه اول (نباید حذف بشن)
        const pinned = entries.filter((e) => e.isPinned());
        const unpinned = entries.filter((e) => !e.isPinned());

        let sortedUnpinned: MemoryEntry[];

        switch (this.config.pruneStrategy) {
            case "oldest":
                // جدیدترین اول (قدیمی‌ترین آخر = اول حذف میشه)
                sortedUnpinned = MemoryEntry.sortByRecency(unpinned);
                break;

            case "lowest-relevance":
                // بالاترین اول (پایین‌ترین آخر = اول حذف میشه)
                sortedUnpinned = MemoryEntry.sortByRelevance(unpinned);
                break;

            case "none":
            default:
                sortedUnpinned = unpinned;
                break;
        }

        return [...pinned, ...sortedUnpinned];
    }

    /**
     * پارس بلاک‌های مارک‌داون
     *
     * هر بلاک = یک meta comment + content lines
     */
    private static parseMarkdownBlocks(markdown: string): string[] {
        const lines = markdown.split("\n");
        const blocks: string[] = [];
        let currentBlock: string[] = [];
        let inBlock = false;

        for (const line of lines) {
            const trimmed = line.trim();

            // رد کردن header
            if (trimmed.startsWith("##")) continue;

            // رد کردن خطوط خالی و placeholder
            if (!trimmed || trimmed.startsWith("_")) {
                if (inBlock && currentBlock.length > 0) {
                    blocks.push(currentBlock.join("\n"));
                    currentBlock = [];
                    inBlock = false;
                }
                continue;
            }

            // شروع بلاک جدید با meta comment
            if (trimmed.startsWith("<!--")) {
                if (inBlock && currentBlock.length > 0) {
                    blocks.push(currentBlock.join("\n"));
                    currentBlock = [];
                }
                inBlock = true;
                currentBlock.push(trimmed);
                continue;
            }

            // ادامه بلاک فعلی
            if (inBlock) {
                currentBlock.push(trimmed);
            }
        }

        // آخرین بلاک
        if (currentBlock.length > 0) {
            blocks.push(currentBlock.join("\n"));
        }

        return blocks;
    }
}

// ============================================================
// 🏗️ SECTION BUILDER - ساخت آسان مجموعه Sectionها
// ============================================================

/**
 * ساخت مجموعه کامل Sectionها
 *
 * @example
 * ```typescript
 * const sections = SectionBuilder.createAll();
 * // → Map<SectionType, MemorySection> (10 section خالی)
 *
 * const customSections = SectionBuilder.createSelected([
 *   "profile",
 *   "pinned",
 *   "skills",
 *   "conversation",
 * ]);
 * ```
 */
export class SectionBuilder {
    /**
     * ساخت تمام Sectionهای پیش‌فرض
     */
    static createAll(): Map<SectionType, MemorySection> {
        const sections = new Map<SectionType, MemorySection>();
        const allTypes: SectionType[] = [
            "profile", "pinned", "skills", "projects",
            "preferences", "facts", "relationship",
            "recent-events", "conversation", "summaries",
        ];

        for (const type of allTypes) {
            sections.set(type, MemorySection.create(type));
        }

        return sections;
    }

    /**
     * ساخت Sectionهای انتخابی
     */
    static createSelected(types: SectionType[]): Map<SectionType, MemorySection> {
        const sections = new Map<SectionType, MemorySection>();

        for (const type of types) {
            sections.set(type, MemorySection.create(type));
        }

        return sections;
    }

    /**
     * مرتب‌سازی Sectionها بر اساس اولویت
     * (بالاترین priority اول)
     */
    static sortByPriority(
        sections: Map<SectionType, MemorySection>,
    ): MemorySection[] {
        return [...sections.values()].sort(
            (a, b) => b.config.priority - a.config.priority,
        );
    }

    /**
     * تشخیص بهترین Section برای یک MemoryEntry
     */
    static findBestSection(
        entry: MemoryEntry,
        sections: Map<SectionType, MemorySection>,
    ): SectionType | null {
        // pin شده → pinned section
        if (entry.isPinned()) return "pinned";

        // بر اساس نوع
        const typeMapping: Record<MemoryType, SectionType> = {
            pinned: "pinned",
            skill: "skills",
            project: "projects",
            preference: "preferences",
            fact: "facts",
            event: "recent-events",
            emotion: "relationship",
            summary: "summaries",
        };

        const targetType = typeMapping[entry.metadata.type];
        if (!targetType) return null;

        // چک کن Section وجود داره و پر نیست
        const section = sections.get(targetType);
        if (!section) return null;
        if (section.isFull) return null;

        return targetType;
    }
}