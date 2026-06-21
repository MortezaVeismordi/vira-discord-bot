// src/core/domain/entities/memory/MemorySnapshot.ts

import {
    MemorySection,
    SectionBuilder,
    type SectionType,
    type SectionConfig,
    type PruneResult,
} from "./MemorySection";
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
 * نتیجه Prune کل Snapshot
 */
export interface SnapshotPruneResult {
    readonly totalRemoved: number;
    readonly totalFreedTokens: number;
    readonly perSection: Record<SectionType, PruneResult>;
}

/**
 * بودجه توکن هر Section برای Context Window
 */
export interface TokenBudget {
    readonly total: number;
    readonly perSection: Partial<Record<SectionType, number>>;
}

/**
 * آمار کلی Snapshot
 */
export interface SnapshotStats {
    readonly totalEntries: number;
    readonly totalTokens: number;
    readonly totalActive: number;
    readonly totalExpired: number;
    readonly totalPinned: number;
    readonly sectionsUsed: number;
    readonly sectionsEmpty: number;
    readonly averageRelevance: number;
    readonly perSection: Record<SectionType, {
        entries: number;
        tokens: number;
        active: number;
        pinned: number;
        averageRelevance: number;
    }>;
    readonly topKeywords: string[];
    readonly lastUpdated: Date;
}

/**
 * Diff بین دو Snapshot
 */
export interface SnapshotDiff {
    readonly added: MemoryEntry[];
    readonly removed: MemoryEntry[];
    readonly modified: Array<{
        before: MemoryEntry;
        after: MemoryEntry;
    }>;
    readonly tokenDelta: number;
}

/**
 * آپشن‌های ساخت Context خروجی
 */
export interface ContextOutputOptions {
    readonly maxTokens: number;
    readonly prioritySections?: SectionType[];
    readonly excludeSections?: SectionType[];
    readonly compact?: boolean;
    readonly includeHeader?: boolean;
    readonly includeStats?: boolean;
}

// ============================================================
// 📸 MEMORY SNAPSHOT
// ============================================================

/**
 * عکس لحظه‌ای از کل حافظه ویرا برای یک کانال/کاربر
 *
 * MemorySnapshot = مجموعه‌ای از MemorySectionها
 *
 * این کلاس بالاترین سطح مدیریت حافظه است.
 * هر کانال دیسکورد یک Snapshot مستقل دارد.
 *
 * فایل مارک‌داون نهایی از Snapshot تولید می‌شود:
 *
 * ```markdown
 * # 🧠 حافظه ویرا - کانال dev
 *
 * ## 👤 پروفایل کاربر
 * ...
 * ## 📌 یادداشت‌های مهم
 * ...
 * ## 🛠️ مهارت‌ها
 * ...
 * ## 💬 مکالمه اخیر
 * ...
 * ```
 *
 * Immutable - هر تغییر instance جدید می‌سازد.
 *
 * @example
 * ```typescript
 * // ساخت
 * const snapshot = MemorySnapshot.create("ch_123", "usr_456");
 *
 * // اضافه کردن خاطره
 * const updated = snapshot.remember(entry);
 *
 * // بازیابی
 * const results = updated.recall("typescript react");
 *
 * // خروجی context
 * const context = updated.toContext({ maxTokens: 4096 });
 *
 * // ذخیره
 * const markdown = updated.toMarkdown();
 * ```
 */
export class MemorySnapshot {
    // ─── Identity ────────────────────────────────────────────
    public readonly channelId: string;
    public readonly userId: string;

    // ─── Sections ────────────────────────────────────────────
    public readonly sections: ReadonlyMap<SectionType, MemorySection>;

    // ─── Metadata ────────────────────────────────────────────
    public readonly createdAt: Date;
    public readonly updatedAt: Date;
    public readonly version: number;

    // ─── Private Constructor ─────────────────────────────────
    private constructor(params: {
        channelId: string;
        userId: string;
        sections: ReadonlyMap<SectionType, MemorySection>;
        createdAt: Date;
        updatedAt: Date;
        version: number;
    }) {
        this.channelId = params.channelId;
        this.userId = params.userId;
        this.sections = params.sections;
        this.createdAt = params.createdAt;
        this.updatedAt = params.updatedAt;
        this.version = params.version;
    }

    // ============================================================
    // 🏭 FACTORIES
    // ============================================================

    /**
     * ساخت Snapshot خالی
     *
     * @example
     * ```typescript
     * const snapshot = MemorySnapshot.create("ch_123", "usr_456");
     * ```
     */
    static create(channelId: string, userId: string): MemorySnapshot {
        const now = new Date();

        return new MemorySnapshot({
            channelId,
            userId,
            sections: SectionBuilder.createAll(),
            createdAt: now,
            updatedAt: now,
            version: 1,
        });
    }

    /**
     * ساخت Snapshot با Sectionهای انتخابی
     */
    static createWithSections(
        channelId: string,
        userId: string,
        sectionTypes: SectionType[],
    ): MemorySnapshot {
        const now = new Date();

        return new MemorySnapshot({
            channelId,
            userId,
            sections: SectionBuilder.createSelected(sectionTypes),
            createdAt: now,
            updatedAt: now,
            version: 1,
        });
    }

    /**
     * ساخت Snapshot از فایل مارک‌داون
     *
     * @example
     * ```typescript
     * const markdown = fs.readFileSync("./runtime/contexts/ch_123.md", "utf-8");
     * const snapshot = MemorySnapshot.fromMarkdown(markdown, "ch_123", "usr_456");
     * ```
     */
    static fromMarkdown(
        markdown: string,
        channelId: string,
        userId: string,
    ): MemorySnapshot {
        const now = new Date();
        const sections = new Map<SectionType, MemorySection>();

        // پارس هدرهای سطح ۲
        const sectionBlocks = MemorySnapshot.parseSectionBlocks(markdown);

        for (const [type, content] of sectionBlocks) {
            sections.set(
                type,
                MemorySection.fromMarkdown(content, type, channelId, userId),
            );
        }

        // Sectionهایی که در فایل نبودند رو خالی بساز
        const allTypes: SectionType[] = [
            "profile", "pinned", "skills", "projects",
            "preferences", "facts", "relationship",
            "recent-events", "conversation", "summaries",
        ];

        for (const type of allTypes) {
            if (!sections.has(type)) {
                sections.set(type, MemorySection.create(type));
            }
        }

        // version رو از markdown comment بخون
        const versionMatch = markdown.match(/<!-- version:(\d+) -->/);
        const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;

        return new MemorySnapshot({
            channelId,
            userId,
            sections,
            createdAt: now,
            updatedAt: now,
            version,
        });
    }

    // ============================================================
    // 🧠 REMEMBER - اضافه کردن خاطره
    // ============================================================

    /**
     * اضافه کردن یک خاطره به بهترین Section
     *
     * @example
     * ```typescript
     * const entry = MemoryEntry.fromConversation({
     *   content: "علی TypeScript کار می‌کنه",
     *   type: "skill",
     *   domains: ["technical"],
     *   channelId: "ch_123",
     *   userId: "usr_456",
     * });
     *
     * const updated = snapshot.remember(entry);
     * ```
     */
    remember(entry: MemoryEntry): MemorySnapshot {
        const targetSection = SectionBuilder.findBestSection(
            entry,
            this.sections as Map<SectionType, MemorySection>,
        );

        if (!targetSection) {
            // اگر جایی پیدا نشد، به facts اضافه کن
            return this.addToSection("facts", entry);
        }

        return this.addToSection(targetSection, entry);
    }

    /**
     * اضافه کردن چند خاطره
     */
    rememberAll(entries: MemoryEntry[]): MemorySnapshot {
        let snapshot: MemorySnapshot = this;

        for (const entry of entries) {
            snapshot = snapshot.remember(entry);
        }

        return snapshot;
    }

    /**
     * Pin کردن یک خاطره
     *
     * @example
     * ```typescript
     * // کاربر: "ویرا یادت بمونه من قهوه دوست دارم"
     * const pinned = MemoryEntry.pinned({
     *   content: "کاربر قهوه دوست دارد",
     *   type: "preference",
     *   domains: ["personal"],
     *   channelId: "ch_123",
     *   userId: "usr_456",
     * });
     *
     * const updated = snapshot.pin(pinned);
     * ```
     */
    pin(entry: MemoryEntry): MemorySnapshot {
        const pinnedEntry = entry.pin(true);
        return this.addToSection("pinned", pinnedEntry);
    }

    /**
     * ذخیره خلاصه مکالمه
     */
    addSummary(
        summaryContent: string,
        originalMessageIds: string[],
        originalEntries?: MemoryEntry[],
    ): MemorySnapshot {
        const summary = MemoryEntry.summary({
            content: summaryContent,
            channelId: this.channelId,
            userId: this.userId,
            originalMessageIds,
            originalEntries,
        });

        return this.addToSection("summaries", summary);
    }

    // ============================================================
    // 🔍 RECALL - بازیابی خاطره
    // ============================================================

    /**
     * جستجو در تمام حافظه
     *
     * @example
     * ```typescript
     * const results = snapshot.recall("typescript docker");
     * for (const result of results) {
     *   console.log(result.entry.content, result.score);
     * }
     * ```
     */
    recall(query: string, limit: number = 10): MemorySearchResult[] {
        const allEntries = this.getAllEntries();
        const results = MemoryEntry.search(allEntries, query, limit);

        // هر entry که recall شد، recallCount افزایش بده
        if (results.length > 0) {
            // side-effect: بازگشت snapshot جدید با recall count آپدیت شده
            // اما اینجا فقط نتایج برمی‌گردونیم
            // caller مسئوله withRecall رو صدا بزنه
        }

        return results;
    }

    /**
     * بازیابی و به‌روزرسانی recall count
     *
     * @returns [نتایج, snapshot جدید]
     */
    recallAndTrack(
        query: string,
        limit: number = 10,
    ): [MemorySearchResult[], MemorySnapshot] {
        const results = this.recall(query, limit);

        let snapshot: MemorySnapshot = this;

        for (const result of results) {
            snapshot = snapshot.updateEntry(
                result.entry.id,
                (entry) => entry.recall(),
            );
        }

        return [results, snapshot];
    }

    /**
     * دریافت تمام حافظه‌های pin شده
     */
    getPinned(): MemoryEntry[] {
        return this.getAllEntries().filter((e) => e.isPinned());
    }

    /**
     * دریافت حافظه‌ها بر اساس فیلتر
     */
    getFiltered(filter: MemoryFilter): MemoryEntry[] {
        return MemoryEntry.filter(this.getAllEntries(), filter);
    }

    /**
     * دریافت حافظه‌ها بر اساس domain
     */
    getByDomain(domain: MemoryDomain): MemoryEntry[] {
        return this.getFiltered({ domains: [domain] });
    }

    /**
     * دریافت حافظه‌ها بر اساس نوع
     */
    getByType(type: MemoryType): MemoryEntry[] {
        return this.getFiltered({ types: [type] });
    }

    /**
     * دریافت یک entry از هر Sectionی
     */
    findEntry(entryId: string): MemoryEntry | undefined {
        for (const section of this.sections.values()) {
            const entry = section.getEntry(entryId);
            if (entry) return entry;
        }
        return undefined;
    }

    /**
     * پیدا کردن Section یک entry
     */
    findEntrySection(entryId: string): SectionType | undefined {
        for (const [type, section] of this.sections) {
            if (section.hasEntry(entryId)) return type;
        }
        return undefined;
    }

    // ============================================================
    // 🔄 MUTATIONS (Immutable)
    // ============================================================

    /**
     * اضافه کردن entry به Section خاص
     */
    addToSection(
        sectionType: SectionType,
        entry: MemoryEntry,
    ): MemorySnapshot {
        const section = this.sections.get(sectionType);
        if (!section) return this;

        const updated = section.addEntry(entry);
        if (!updated) return this;

        return this.withSection(sectionType, updated);
    }

    /**
     * حذف entry از هر Sectionی که هست
     */
    removeEntry(entryId: string): MemorySnapshot {
        const sectionType = this.findEntrySection(entryId);
        if (!sectionType) return this;

        const section = this.sections.get(sectionType)!;
        const updated = section.removeEntry(entryId);

        return this.withSection(sectionType, updated);
    }

    /**
     * به‌روزرسانی entry
     */
    updateEntry(
        entryId: string,
        updater: (entry: MemoryEntry) => MemoryEntry,
    ): MemorySnapshot {
        const sectionType = this.findEntrySection(entryId);
        if (!sectionType) return this;

        const section = this.sections.get(sectionType)!;
        const updated = section.updateEntry(entryId, updater);

        return this.withSection(sectionType, updated);
    }

    /**
     * جابجایی entry بین Sectionها
     */
    moveEntry(
        entryId: string,
        targetSection: SectionType,
    ): MemorySnapshot {
        const entry = this.findEntry(entryId);
        if (!entry) return this;

        const currentSection = this.findEntrySection(entryId);
        if (!currentSection || currentSection === targetSection) return this;

        return this
            .removeEntry(entryId)
            .addToSection(targetSection, entry);
    }

    // ============================================================
    // ✂️ PRUNING & MAINTENANCE
    // ============================================================

    /**
     * Prune تمام Sectionها
     *
     * @example
     * ```typescript
     * const { snapshot, result } = snapshot.prune();
     * console.log(`${result.totalRemoved} entries removed`);
     * console.log(`${result.totalFreedTokens} tokens freed`);
     * ```
     */
    prune(): { snapshot: MemorySnapshot; result: SnapshotPruneResult } {
        const newSections = new Map<SectionType, MemorySection>();
        const perSection: Record<string, PruneResult> = {};
        let totalRemoved = 0;
        let totalFreedTokens = 0;

        for (const [type, section] of this.sections) {
            const { section: pruned, result } = section.prune();
            newSections.set(type, pruned);
            perSection[type] = result;
            totalRemoved += result.removed.length;
            totalFreedTokens += result.freedTokens;
        }

        return {
            snapshot: new MemorySnapshot({
                channelId: this.channelId,
                userId: this.userId,
                sections: newSections,
                createdAt: this.createdAt,
                updatedAt: new Date(),
                version: this.version + 1,
            }),
            result: {
                totalRemoved,
                totalFreedTokens,
                perSection: perSection as Record<SectionType, PruneResult>,
            },
        };
    }

    /**
     * Prune تا رسیدن به بودجه توکن
     */
    pruneToTokenBudget(maxTokens: number): {
        snapshot: MemorySnapshot;
        result: SnapshotPruneResult;
    } {
        if (this.totalTokens <= maxTokens) {
            return {
                snapshot: this,
                result: {
                    totalRemoved: 0,
                    totalFreedTokens: 0,
                    perSection: {} as Record<SectionType, PruneResult>,
                },
            };
        }

        // بودجه‌بندی هوشمند
        const budget = this.calculateTokenBudgets(maxTokens);
        const newSections = new Map<SectionType, MemorySection>();
        const perSection: Record<string, PruneResult> = {};
        let totalRemoved = 0;
        let totalFreedTokens = 0;

        for (const [type, section] of this.sections) {
            const sectionBudget = budget.perSection[type] ?? 0;
            const { section: pruned, result } = section.pruneToTokenLimit(sectionBudget);

            newSections.set(type, pruned);
            perSection[type] = result;
            totalRemoved += result.removed.length;
            totalFreedTokens += result.freedTokens;
        }

        return {
            snapshot: new MemorySnapshot({
                channelId: this.channelId,
                userId: this.userId,
                sections: newSections,
                createdAt: this.createdAt,
                updatedAt: new Date(),
                version: this.version + 1,
            }),
            result: {
                totalRemoved,
                totalFreedTokens,
                perSection: perSection as Record<SectionType, PruneResult>,
            },
        };
    }

    /**
     * حذف تمام entryهای منقضی
     */
    removeExpired(): MemorySnapshot {
        const newSections = new Map<SectionType, MemorySection>();
        let hasChanges = false;

        for (const [type, section] of this.sections) {
            const cleaned = section.removeExpired();

            if (cleaned !== section) hasChanges = true;

            newSections.set(type, cleaned);
        }

        if (!hasChanges) return this;

        return new MemorySnapshot({
            channelId: this.channelId,
            userId: this.userId,
            sections: newSections,
            createdAt: this.createdAt,
            updatedAt: new Date(),
            version: this.version + 1,
        });
    }

    /**
     * پاکسازی کامل + prune + remove expired
     */
    maintain(): { snapshot: MemorySnapshot; result: SnapshotPruneResult } {
        // ۱. حذف منقضی‌ها
        const afterExpired = this.removeExpired();

        // ۲. prune
        return afterExpired.prune();
    }

    // ============================================================
    // 📊 STATS & QUERIES
    // ============================================================

    /**
     * تمام entryها از همه Sectionها
     */
    getAllEntries(): MemoryEntry[] {
        const entries: MemoryEntry[] = [];
        for (const section of this.sections.values()) {
            entries.push(...section.entries);
        }
        return entries;
    }

    /**
     * تمام entryهای فعال
     */
    getActiveEntries(): MemoryEntry[] {
        return this.getAllEntries().filter((e) => e.isActive());
    }

    /**
     * تعداد کل entry‌ها
     */
    get totalEntries(): number {
        let count = 0;
        for (const section of this.sections.values()) {
            count += section.size;
        }
        return count;
    }

    /**
     * مجموع توکن‌ها
     */
    get totalTokens(): number {
        let tokens = 0;
        for (const section of this.sections.values()) {
            tokens += section.totalTokens;
        }
        return tokens;
    }

    /**
     * آیا Snapshot خالی است؟
     */
    get isEmpty(): boolean {
        return this.totalEntries === 0;
    }

    /**
     * آمار کامل
     */
    get stats(): SnapshotStats {
        const allEntries = this.getAllEntries();
        let totalActive = 0;
        let totalExpired = 0;
        let totalPinned = 0;
        let totalRelevance = 0;
        let sectionsUsed = 0;
        let sectionsEmpty = 0;

        const perSection: Record<string, any> = {};

        for (const [type, section] of this.sections) {
            if (section.isEmpty) {
                sectionsEmpty++;
            } else {
                sectionsUsed++;
            }

            perSection[type] = {
                entries: section.size,
                tokens: section.totalTokens,
                active: section.activeCount,
                pinned: section.pinnedCount,
                averageRelevance: section.averageRelevance,
            };
        }

        for (const entry of allEntries) {
            if (entry.isActive()) totalActive++;
            if (entry.isExpired()) totalExpired++;
            if (entry.isPinned()) totalPinned++;
            totalRelevance += entry.relevanceScore;
        }

        // بیشترین کلیدواژه‌ها
        const keywordCounts = new Map<string, number>();
        for (const entry of allEntries) {
            for (const keyword of entry.keywords) {
                keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
            }
        }
        const topKeywords = [...keywordCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([keyword]) => keyword);

        return {
            totalEntries: allEntries.length,
            totalTokens: this.totalTokens,
            totalActive,
            totalExpired,
            totalPinned,
            sectionsUsed,
            sectionsEmpty,
            averageRelevance: allEntries.length > 0
                ? Math.round((totalRelevance / allEntries.length) * 100) / 100
                : 0,
            perSection: perSection as SnapshotStats["perSection"],
            topKeywords,
            lastUpdated: this.updatedAt,
        };
    }

    /**
     * تفاوت بین این Snapshot و یک Snapshot دیگر
     */
    diff(other: MemorySnapshot): SnapshotDiff {
        const thisEntries = new Map(
            this.getAllEntries().map((e) => [e.id, e]),
        );
        const otherEntries = new Map(
            other.getAllEntries().map((e) => [e.id, e]),
        );

        const added: MemoryEntry[] = [];
        const removed: MemoryEntry[] = [];
        const modified: Array<{ before: MemoryEntry; after: MemoryEntry }> = [];

        // Added: در other هست ولی در this نیست
        for (const [id, entry] of otherEntries) {
            if (!thisEntries.has(id)) {
                added.push(entry);
            }
        }

        // Removed: در this هست ولی در other نیست
        for (const [id, entry] of thisEntries) {
            if (!otherEntries.has(id)) {
                removed.push(entry);
            }
        }

        // Modified: در هر دو هست ولی metadata فرق می‌کنه
        for (const [id, thisEntry] of thisEntries) {
            const otherEntry = otherEntries.get(id);
            if (otherEntry && thisEntry.metadata.updatedAt !== otherEntry.metadata.updatedAt) {
                modified.push({ before: thisEntry, after: otherEntry });
            }
        }

        return {
            added,
            removed,
            modified,
            tokenDelta: other.totalTokens - this.totalTokens,
        };
    }

    // ============================================================
    // 📦 SERIALIZATION
    // ============================================================

    /**
     * تبدیل به مارک‌داون کامل
     *
     * @example
     * ```markdown
     * # 🧠 حافظه ویرا
     * <!-- version:5 -->
     * <!-- channel:ch_123 user:usr_456 -->
     * <!-- updated:2024-01-15T14:30:00.000Z -->
     *
     * ## 👤 پروفایل کاربر
     * ...
     *
     * ## 📌 یادداشت‌های مهم
     * ...
     * ```
     */
    toMarkdown(): string {
        const parts: string[] = [];

        // ─── Header ────────────────────────────────────────
        parts.push("# 🧠 حافظه ویرا");
        parts.push(`<!-- version:${this.version} -->`);
        parts.push(`<!-- channel:${this.channelId} user:${this.userId} -->`);
        parts.push(`<!-- updated:${this.updatedAt.toISOString()} -->`);
        parts.push("");

        // ─── Sections (بر اساس اولویت) ────────────────────
        const sortedSections = SectionBuilder.sortByPriority(
            this.sections as Map<SectionType, MemorySection>,
        );

        for (const section of sortedSections) {
            const markdown = section.toMarkdown();
            if (markdown) {
                parts.push(markdown);
                parts.push(""); // خط خالی بین sectionها
            }
        }

        return parts.join("\n").trim() + "\n";
    }

    /**
     * تبدیل به Context Window
     *
     * هوشمندانه بودجه توکن رو بین Sectionها تقسیم می‌کنه
     *
     * @example
     * ```typescript
     * const context = snapshot.toContext({
     *   maxTokens: 4096,
     *   compact: false,
     *   includeHeader: true,
     * });
     *
     * // ارسال به LLM:
     * const messages = [
     *   { role: "system", content: systemPrompt },
     *   { role: "system", content: context },
     *   ...conversationHistory,
     * ];
     * ```
     */
    toContext(options: ContextOutputOptions): string {
        const {
            maxTokens,
            prioritySections,
            excludeSections,
            compact = false,
            includeHeader = true,
            includeStats = false,
        } = options;

        const parts: string[] = [];

        // ─── Header ────────────────────────────────────────
        if (includeHeader) {
            parts.push("# 🧠 حافظه من درباره تو");
            parts.push("");
        }

        // ─── بودجه‌بندی ─────────────────────────────────────
        const headerTokens = includeHeader ? 10 : 0;
        const statsTokens = includeStats ? 50 : 0;
        const availableTokens = maxTokens - headerTokens - statsTokens;
        const budget = this.calculateTokenBudgets(availableTokens, prioritySections);

        // ─── Sectionها بر اساس اولویت ───────────────────────
        const sortedSections = SectionBuilder.sortByPriority(
            this.sections as Map<SectionType, MemorySection>,
        );

        for (const section of sortedSections) {
            // رد کردن sectionهای exclude شده
            if (excludeSections?.includes(section.config.type)) continue;

            // رد کردن sectionهای خالی (مگر alwaysInclude باشه)
            if (section.isEmpty && !section.config.alwaysInclude) continue;

            const sectionBudget = budget.perSection[section.config.type] ?? 0;

            if (sectionBudget <= 0 && !section.config.alwaysInclude) continue;

            const output = compact
                ? section.toCompactMarkdown()
                : section.toContextOutput(sectionBudget);

            if (output) {
                parts.push(output);
            }
        }

        // ─── Stats (اختیاری) ──────────────────────────────
        if (includeStats) {
            parts.push(this.toStatsBlock());
        }

        return parts.join("\n").trim();
    }

    /**
     * خروجی JSON
     */
    toJSON(): Record<string, unknown> {
        const sectionsJSON: Record<string, unknown> = {};
        for (const [type, section] of this.sections) {
            sectionsJSON[type] = section.toJSON();
        }

        return {
            channelId: this.channelId,
            userId: this.userId,
            version: this.version,
            totalEntries: this.totalEntries,
            totalTokens: this.totalTokens,
            sections: sectionsJSON,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString(),
        };
    }

    // ============================================================
    // 🔧 PRIVATE HELPERS
    // ============================================================

    /**
     * جایگزینی یک Section
     */
    private withSection(
        type: SectionType,
        section: MemorySection,
    ): MemorySnapshot {
        const newSections = new Map(this.sections);
        newSections.set(type, section);

        return new MemorySnapshot({
            channelId: this.channelId,
            userId: this.userId,
            sections: newSections,
            createdAt: this.createdAt,
            updatedAt: new Date(),
            version: this.version + 1,
        });
    }

    /**
     * محاسبه بودجه توکن برای هر Section
     *
     * الگوریتم:
     * 1. Sectionهای alwaysInclude → حداقل بودجه تضمین‌شده
     * 2. Sectionهای priority بالا → بودجه بیشتر
     * 3. بقیه → تقسیم بر اساس نسبت priority
     */
    private calculateTokenBudgets(
        totalBudget: number,
        prioritySections?: SectionType[],
    ): TokenBudget {
        const perSection: Partial<Record<SectionType, number>> = {};
        let remainingBudget = totalBudget;

        // ─── فاز ۱: بودجه تضمینی برای alwaysInclude ────────
        const guaranteedSections: SectionType[] = [];

        for (const [type, section] of this.sections) {
            if (section.config.alwaysInclude && !section.isEmpty) {
                // حداقل ۱۰٪ بودجه یا توکن‌های فعلی
                const minBudget = Math.min(
                    section.totalTokens,
                    Math.floor(totalBudget * 0.1),
                );
                perSection[type] = minBudget;
                remainingBudget -= minBudget;
                guaranteedSections.push(type);
            }
        }

        // ─── فاز ۲: بودجه برای priority sections ──────────
        if (prioritySections) {
            for (const type of prioritySections) {
                if (guaranteedSections.includes(type)) continue;

                const section = this.sections.get(type);
                if (!section || section.isEmpty) continue;

                const budget = Math.min(
                    section.totalTokens,
                    Math.floor(remainingBudget * 0.2),
                );
                perSection[type] = budget;
                remainingBudget -= budget;
            }
        }

        // ─── فاز ۳: بقیه بودجه بر اساس priority ──────────
        const remainingSections: Array<[SectionType, MemorySection]> = [];
        let totalPriority = 0;

        for (const [type, section] of this.sections) {
            if (perSection[type] !== undefined) continue;
            if (section.isEmpty) continue;

            remainingSections.push([type, section]);
            totalPriority += section.config.priority;
        }

        for (const [type, section] of remainingSections) {
            const ratio = section.config.priority / totalPriority;
            const budget = Math.min(
                section.totalTokens,
                Math.floor(remainingBudget * ratio),
            );
            perSection[type] = (perSection[type] ?? 0) + budget;
        }

        return { total: totalBudget, perSection };
    }

    /**
     * بلاک آمار
     */
    private toStatsBlock(): string {
        const s = this.stats;
        return [
            "---",
            `📊 **آمار حافظه:** ${s.totalEntries} خاطره | `,
            `${s.totalTokens} توکن | `,
            `${s.totalPinned} پین‌شده | `,
            `میانگین اهمیت: ${s.averageRelevance}`,
        ].join("");
    }

    /**
     * پارس بلاک‌های Section از مارک‌داون
     */
    private static parseSectionBlocks(
        markdown: string,
    ): Map<SectionType, string> {
        const blocks = new Map<SectionType, string>();
        const lines = markdown.split("\n");

        let currentType: SectionType | null = null;
        let currentLines: string[] = [];

        const iconToType: Record<string, SectionType> = {
            "👤": "profile",
            "📌": "pinned",
            "🛠️": "skills",
            "📂": "projects",
            "⭐": "preferences",
            "📋": "facts",
            "💚": "relationship",
            "📅": "recent-events",
            "💬": "conversation",
            "📝": "summaries",
        };

        for (const line of lines) {
            const trimmed = line.trim();

            // سطح ۱ هدر → رد شود
            if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
                continue;
            }

            // سطح ۲ هدر → Section جدید
            if (trimmed.startsWith("## ")) {
                // ذخیره Section قبلی
                if (currentType && currentLines.length > 0) {
                    blocks.set(currentType, currentLines.join("\n"));
                }

                // تشخیص نوع Section از آیکون
                currentType = null;
                for (const [icon, type] of Object.entries(iconToType)) {
                    if (trimmed.includes(icon)) {
                        currentType = type;
                        break;
                    }
                }

                currentLines = [];
                continue;
            }

            // محتوای Section
            if (currentType) {
                currentLines.push(line);
            }
        }

        // آخرین Section
        if (currentType && currentLines.length > 0) {
            blocks.set(currentType, currentLines.join("\n"));
        }

        return blocks;
    }
}