// src/core/domain/entities/memory/MemoryEntry.ts

import {
    MemoryMetadata,
    type MemoryType,
    type MemorySource,
    type MemoryDomain,
    type ImportanceLevel,
    type MemoryLifecycle,
} from "./MemoryMetadata";
import type { Message } from "../Message";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * نتیجه جستجو در حافظه
 */
export interface MemorySearchResult {
    readonly entry: MemoryEntry;
    readonly score: number;
    readonly matchedKeywords: string[];
}

/**
 * فیلتر برای جستجو و فیلتر حافظه
 */
export interface MemoryFilter {
    readonly types?: MemoryType[];
    readonly domains?: MemoryDomain[];
    readonly importance?: ImportanceLevel[];
    readonly lifecycle?: MemoryLifecycle[];
    readonly channelId?: string;
    readonly userId?: string;
    readonly tags?: string[];
    readonly pinnedOnly?: boolean;
    readonly minRelevanceScore?: number;
    readonly maxAge?: number;           // ساعت
    readonly keyword?: string;
}

/**
 * آمار خلاصه یک مجموعه از حافظه‌ها
 */
export interface MemoryStats {
    readonly total: number;
    readonly active: number;
    readonly expired: number;
    readonly pinned: number;
    readonly byType: Record<MemoryType, number>;
    readonly byDomain: Record<MemoryDomain, number>;
    readonly totalTokens: number;
    readonly averageRelevance: number;
    readonly oldestEntry: Date | null;
    readonly newestEntry: Date | null;
}

// ============================================================
// 📝 MEMORY ENTRY - یک واحد حافظه
// ============================================================

/**
 * واحد اصلی حافظه ویرا
 *
 * MemoryEntry = Content + Metadata
 *
 * این کلاس یک "خاطره" کامل را نمایندگی می‌کند.
 * می‌تواند یک fact، یک event، یک احساس، یا یک خلاصه باشد.
 *
 * Immutable - هر تغییری instance جدید می‌سازد.
 *
 * @example
 * ```typescript
 * // ساخت از مکالمه
 * const entry = MemoryEntry.fromConversation({
 *   content: "علی از TypeScript و React استفاده می‌کنه",
 *   type: "skill",
 *   domains: ["technical"],
 *   channelId: "123",
 *   userId: "456",
 * });
 *
 * // recall
 * const recalled = entry.recall();
 *
 * // جستجو
 * const score = entry.searchScore("typescript react");
 * ```
 */
export class MemoryEntry {
    // ─── Core ────────────────────────────────────────────────
    public readonly id: string;
    public readonly content: string;
    public readonly metadata: MemoryMetadata;

    // ─── Content Analysis ────────────────────────────────────
    public readonly keywords: readonly string[];
    public readonly estimatedTokens: number;

    // ─── Private Constructor ─────────────────────────────────
    private constructor(params: {
        id: string;
        content: string;
        metadata: MemoryMetadata;
        keywords: readonly string[];
        estimatedTokens: number;
    }) {
        this.id = params.id;
        this.content = params.content;
        this.metadata = params.metadata;
        this.keywords = params.keywords;
        this.estimatedTokens = params.estimatedTokens;
    }

    // ============================================================
    // 🏭 FACTORIES
    // ============================================================

    /**
     * ساخت حافظه از مکالمه
     *
     * @example
     * ```typescript
     * const entry = MemoryEntry.fromConversation({
     *   content: "علی گفت که با Docker و Kubernetes کار می‌کنه",
     *   type: "skill",
     *   domains: ["technical"],
     *   channelId: "ch_123",
     *   userId: "usr_456",
     *   importance: "high",
     *   tags: ["devops"],
     * });
     * ```
     */
    static fromConversation(params: {
        content: string;
        type: MemoryType;
        domains: MemoryDomain[];
        channelId: string;
        userId: string;
        importance?: ImportanceLevel;
        tags?: string[];
        relatedMessageIds?: string[];
    }): MemoryEntry {
        const metadata = MemoryMetadata.create({
            type: params.type,
            source: "conversation",
            domains: params.domains,
            importance: params.importance,
            channelId: params.channelId,
            userId: params.userId,
            relatedMessageIds: params.relatedMessageIds,
            tags: params.tags,
        });

        return new MemoryEntry({
            id: MemoryEntry.generateId(params.type),
            content: params.content,
            metadata,
            keywords: MemoryEntry.extractKeywords(params.content),
            estimatedTokens: MemoryEntry.estimateTokens(params.content),
        });
    }

    /**
     * ساخت حافظه از ورودی صوتی
     */
    static fromVoice(params: {
        content: string;
        type: MemoryType;
        domains: MemoryDomain[];
        channelId: string;
        userId: string;
        importance?: ImportanceLevel;
    }): MemoryEntry {
        const metadata = MemoryMetadata.create({
            type: params.type,
            source: "voice",
            domains: params.domains,
            importance: params.importance,
            channelId: params.channelId,
            userId: params.userId,
        });

        return new MemoryEntry({
            id: MemoryEntry.generateId(params.type),
            content: params.content,
            metadata,
            keywords: MemoryEntry.extractKeywords(params.content),
            estimatedTokens: MemoryEntry.estimateTokens(params.content),
        });
    }

    /**
     * ساخت حافظه از استنباط LLM
     *
     * @example
     * ```typescript
     * // وقتی LLM از مکالمه استنباط می‌کنه که کاربر برنامه‌نویسه
     * const entry = MemoryEntry.fromLLMExtraction({
     *   content: "کاربر یک برنامه‌نویس فول‌استک است",
     *   type: "fact",
     *   domains: ["personal", "technical"],
     *   channelId: "ch_123",
     *   userId: "usr_456",
     * });
     * ```
     */
    static fromLLMExtraction(params: {
        content: string;
        type: MemoryType;
        domains: MemoryDomain[];
        channelId: string;
        userId: string;
        importance?: ImportanceLevel;
        relatedMessageIds?: string[];
    }): MemoryEntry {
        const metadata = MemoryMetadata.create({
            type: params.type,
            source: "llm-extracted",
            domains: params.domains,
            importance: params.importance,
            channelId: params.channelId,
            userId: params.userId,
            relatedMessageIds: params.relatedMessageIds,
        });

        return new MemoryEntry({
            id: MemoryEntry.generateId(params.type),
            content: params.content,
            metadata,
            keywords: MemoryEntry.extractKeywords(params.content),
            estimatedTokens: MemoryEntry.estimateTokens(params.content),
        });
    }

    /**
     * ساخت حافظه pin شده
     *
     * @example
     * ```typescript
     * // کاربر: "ویرا یادت بمونه من قهوه دوست دارم"
     * const entry = MemoryEntry.pinned({
     *   content: "کاربر قهوه دوست دارد",
     *   type: "preference",
     *   domains: ["personal"],
     *   channelId: "ch_123",
     *   userId: "usr_456",
     * });
     * ```
     */
    static pinned(params: {
        content: string;
        type: MemoryType;
        domains: MemoryDomain[];
        channelId: string;
        userId: string;
        tags?: string[];
    }): MemoryEntry {
        const metadata = MemoryMetadata.pinned({
            type: params.type,
            domains: params.domains,
            channelId: params.channelId,
            userId: params.userId,
            tags: params.tags,
        });

        return new MemoryEntry({
            id: MemoryEntry.generateId("pinned"),
            content: params.content,
            metadata,
            keywords: MemoryEntry.extractKeywords(params.content),
            estimatedTokens: MemoryEntry.estimateTokens(params.content),
        });
    }

    /**
     * ساخت خلاصه از چند پیام
     *
     * @example
     * ```typescript
     * const summary = MemoryEntry.summary({
     *   content: "کاربر و ویرا درباره باگ Docker صحبت کردند...",
     *   channelId: "ch_123",
     *   userId: "usr_456",
     *   originalMessageIds: ["msg_1", "msg_2", "msg_3"],
     *   originalEntries: [entry1, entry2, entry3],
     * });
     * ```
     */
    static summary(params: {
        content: string;
        channelId: string;
        userId: string;
        originalMessageIds: string[];
        originalEntries?: MemoryEntry[];
    }): MemoryEntry {
        // Domainها رو از entry‌های اصلی ارث ببر
        const domains = params.originalEntries
            ? MemoryEntry.mergeDomains(params.originalEntries)
            : [];

        const metadata = MemoryMetadata.forSummary({
            channelId: params.channelId,
            userId: params.userId,
            originalMessageIds: params.originalMessageIds,
        });

        // اگر domainها هست، اضافه کن
        const metaWithDomains = domains.reduce(
            (meta, domain) => meta.withDomain(domain),
            metadata,
        );

        return new MemoryEntry({
            id: MemoryEntry.generateId("summary"),
            content: params.content,
            metadata: metaWithDomains,
            keywords: MemoryEntry.extractKeywords(params.content),
            estimatedTokens: MemoryEntry.estimateTokens(params.content),
        });
    }

    /**
     * ساخت حافظه از پیام (Message entity)
     *
     * @example
     * ```typescript
     * const entry = MemoryEntry.fromMessage(message, {
     *   type: "event",
     *   domains: ["technical"],
     * });
     * ```
     */
    static fromMessage(
        message: Message,
        params: {
            type: MemoryType;
            domains: MemoryDomain[];
            importance?: ImportanceLevel;
        },
    ): MemoryEntry {
        const source: MemorySource = message.isVoice() ? "voice" : "conversation";

        const metadata = MemoryMetadata.create({
            type: params.type,
            source,
            domains: params.domains,
            importance: params.importance,
            channelId: message.channel.id,
            userId: message.author.id,
            relatedMessageIds: [message.id],
        });

        return new MemoryEntry({
            id: MemoryEntry.generateId(params.type),
            content: message.content,
            metadata,
            keywords: MemoryEntry.extractKeywords(message.content),
            estimatedTokens: MemoryEntry.estimateTokens(message.content),
        });
    }

    // ============================================================
    // 🔄 STATE TRANSITIONS (Immutable)
    // ============================================================

    /**
     * حافظه بازیابی (recall) شد
     * - recallCount افزایش
     * - expiry تمدید
     */
    recall(): MemoryEntry {
        return this.clone({
            metadata: this.metadata.withRecall(),
        });
    }

    /**
     * حافظه خلاصه شد
     */
    summarize(): MemoryEntry {
        return this.clone({
            metadata: this.metadata.withSummarized(),
        });
    }

    /**
     * حافظه آرشیو شد
     */
    archive(): MemoryEntry {
        return this.clone({
            metadata: this.metadata.withArchived(),
        });
    }

    /**
     * حافظه منقضی شد
     */
    expire(): MemoryEntry {
        return this.clone({
            metadata: this.metadata.withExpired(),
        });
    }

    /**
     * حافظه pin/unpin شد
     */
    pin(pinned: boolean = true): MemoryEntry {
        return this.clone({
            metadata: this.metadata.withPinned(pinned),
        });
    }

    /**
     * محتوای حافظه به‌روزرسانی شد (مثلاً بعد از summarize)
     */
    withContent(newContent: string): MemoryEntry {
        return new MemoryEntry({
            id: this.id,
            content: newContent,
            metadata: this.metadata,
            keywords: MemoryEntry.extractKeywords(newContent),
            estimatedTokens: MemoryEntry.estimateTokens(newContent),
        });
    }

    /**
     * تگ جدید اضافه شد
     */
    withTag(tag: string): MemoryEntry {
        return this.clone({
            metadata: this.metadata.withTag(tag),
        });
    }

    /**
     * اهمیت تغییر کرد
     */
    withImportance(level: ImportanceLevel): MemoryEntry {
        return this.clone({
            metadata: this.metadata.withImportance(level),
        });
    }

    // ============================================================
    // 🔍 QUERY METHODS
    // ============================================================

    /**
     * آیا حافظه فعال و قابل استفاده است؟
     */
    isActive(): boolean {
        return this.metadata.isActive();
    }

    /**
     * آیا حافظه منقضی شده؟
     */
    isExpired(): boolean {
        return this.metadata.isExpired();
    }

    /**
     * آیا حافظه pin شده؟
     */
    isPinned(): boolean {
        return this.metadata.userPinned;
    }

    /**
     * آیا نیاز به خلاصه‌سازی دارد؟
     */
    needsSummarization(): boolean {
        return this.metadata.needsSummarization();
    }

    /**
     * آیا قابل حذف است؟
     */
    isDeletable(): boolean {
        return this.metadata.isDeletable();
    }

    /**
     * امتیاز اهمیت (0-1)
     */
    get relevanceScore(): number {
        return this.metadata.relevanceScore;
    }

    /**
     * آیا با فیلتر داده شده match می‌شود؟
     */
    matchesFilter(filter: MemoryFilter): boolean {
        if (filter.types && !filter.types.includes(this.metadata.type)) {
            return false;
        }

        if (filter.domains) {
            const hasMatchingDomain = filter.domains.some((d) =>
                this.metadata.hasDomain(d)
            );
            if (!hasMatchingDomain) return false;
        }

        if (filter.importance && !filter.importance.includes(this.metadata.importance)) {
            return false;
        }

        if (filter.lifecycle && !filter.lifecycle.includes(this.metadata.lifecycle)) {
            return false;
        }

        if (filter.channelId && !this.metadata.isFromChannel(filter.channelId)) {
            return false;
        }

        if (filter.userId && !this.metadata.isFromUser(filter.userId)) {
            return false;
        }

        if (filter.tags) {
            const hasMatchingTag = filter.tags.some((t) => this.metadata.hasTag(t));
            if (!hasMatchingTag) return false;
        }

        if (filter.pinnedOnly && !this.isPinned()) {
            return false;
        }

        if (filter.minRelevanceScore !== undefined) {
            if (this.relevanceScore < filter.minRelevanceScore) return false;
        }

        if (filter.maxAge !== undefined) {
            if (this.metadata.ageInHours > filter.maxAge) return false;
        }

        if (filter.keyword) {
            if (this.searchScore(filter.keyword) === 0) return false;
        }

        return true;
    }

    // ============================================================
    // 🔎 SEARCH
    // ============================================================

    /**
     * امتیاز جستجو برای یک query (0-1)
     *
     * ترکیب:
     * - keyword match در content
     * - keyword match در keywords استخراج‌شده
     * - relevanceScore خود حافظه
     *
     * @example
     * ```typescript
     * const score = entry.searchScore("typescript react");
     * // 0.85
     * ```
     */
    searchScore(query: string): number {
        const queryTerms = MemoryEntry.normalizeText(query)
            .split(/\s+/)
            .filter((t) => t.length > 1);

        if (queryTerms.length === 0) return 0;

        const normalizedContent = MemoryEntry.normalizeText(this.content);

        // ─── Content Match ─────────────────────────────────
        let contentMatches = 0;
        for (const term of queryTerms) {
            if (normalizedContent.includes(term)) {
                contentMatches++;
            }
        }
        const contentScore = contentMatches / queryTerms.length;

        // ─── Keyword Match ─────────────────────────────────
        let keywordMatches = 0;
        for (const term of queryTerms) {
            if (this.keywords.some((kw) => kw.includes(term) || term.includes(kw))) {
                keywordMatches++;
            }
        }
        const keywordScore = keywordMatches / queryTerms.length;

        // ─── Exact Phrase Bonus ────────────────────────────
        const normalizedQuery = MemoryEntry.normalizeText(query);
        const exactPhraseBonus = normalizedContent.includes(normalizedQuery) ? 0.2 : 0;

        // ─── Combine ───────────────────────────────────────
        const rawScore =
            contentScore * 0.45 +
            keywordScore * 0.25 +
            this.relevanceScore * 0.15 +
            exactPhraseBonus +
            (this.isPinned() ? 0.1 : 0);

        return Math.min(1, Math.max(0, rawScore));
    }

    /**
     * پیدا کردن کلیدواژه‌های match شده با query
     */
    getMatchedKeywords(query: string): string[] {
        const queryTerms = MemoryEntry.normalizeText(query)
            .split(/\s+/)
            .filter((t) => t.length > 1);

        return this.keywords.filter((kw) =>
            queryTerms.some((term) => kw.includes(term) || term.includes(kw))
        );
    }

    /**
     * تبدیل به MemorySearchResult
     */
    toSearchResult(query: string): MemorySearchResult {
        return {
            entry: this,
            score: this.searchScore(query),
            matchedKeywords: this.getMatchedKeywords(query),
        };
    }

    // ============================================================
    // 📦 SERIALIZATION
    // ============================================================

    /**
     * تبدیل به فرمت مارک‌داون
     *
     * @example
     * ```markdown
     * <!-- meta:skill:high:technical:1703001600:rc:3 -->
     * - علی از TypeScript و React استفاده می‌کنه
     * ```
     */
    toMarkdown(): string {
        const metaComment = this.metadata.toMarkdownComment();
        return `${metaComment}\n- ${this.content}`;
    }

    /**
     * ساخت MemoryEntry از مارک‌داون
     *
     * @example
     * ```typescript
     * const entry = MemoryEntry.fromMarkdown(
     *   "<!-- meta:skill:high:technical:1703001600 -->\n- علی React کار می‌کنه",
     *   "ch_123",
     *   "usr_456",
     * );
     * ```
     */
    static fromMarkdown(
        markdown: string,
        channelId: string,
        userId: string,
    ): MemoryEntry | null {
        const lines = markdown.trim().split("\n");
        if (lines.length < 2) return null;

        // خط اول = metadata comment
        const metaLine = lines[0].trim();
        const metadata = MemoryMetadata.fromMarkdownComment(
            metaLine,
            channelId,
            userId,
        );

        if (!metadata) return null;

        // خط دوم به بعد = content
        const content = lines
            .slice(1)
            .map((line) => line.replace(/^-\s*/, "").trim())
            .join("\n")
            .trim();

        if (!content) return null;

        return new MemoryEntry({
            id: MemoryEntry.generateId(metadata.type),
            content,
            metadata,
            keywords: MemoryEntry.extractKeywords(content),
            estimatedTokens: MemoryEntry.estimateTokens(content),
        });
    }

    /**
     * تبدیل به فرمت خلاصه (برای context window)
     *
     * وقتی فضای context کمه، از این فرمت فشرده استفاده می‌شه
     */
    toCompactFormat(): string {
        const icon = this.typeIcon;
        const pin = this.isPinned() ? "📌 " : "";
        return `${pin}${icon} ${this.content}`;
    }

    /**
     * تبدیل به JSON
     */
    toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            content: this.content,
            keywords: [...this.keywords],
            estimatedTokens: this.estimatedTokens,
            relevanceScore: Math.round(this.relevanceScore * 100) / 100,
            metadata: this.metadata.toJSON(),
        };
    }

    // ============================================================
    // 📊 STATIC COLLECTION METHODS
    // ============================================================

    /**
     * فیلتر کردن مجموعه‌ای از حافظه‌ها
     */
    static filter(entries: MemoryEntry[], filter: MemoryFilter): MemoryEntry[] {
        return entries.filter((entry) => entry.matchesFilter(filter));
    }

    /**
     * مرتب‌سازی بر اساس اهمیت (بالاترین اول)
     */
    static sortByRelevance(entries: MemoryEntry[]): MemoryEntry[] {
        return [...entries].sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    /**
     * مرتب‌سازی بر اساس زمان (جدیدترین اول)
     */
    static sortByRecency(entries: MemoryEntry[]): MemoryEntry[] {
        return [...entries].sort(
            (a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime(),
        );
    }

    /**
     * جستجو در مجموعه حافظه‌ها
     */
    static search(
        entries: MemoryEntry[],
        query: string,
        limit: number = 10,
    ): MemorySearchResult[] {
        return entries
            .map((entry) => entry.toSearchResult(query))
            .filter((result) => result.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * انتخاب حافظه‌ها برای context window با محدودیت توکن
     *
     * اولویت:
     * 1. pinned (همیشه)
     * 2. critical (همیشه)
     * 3. high (تا جای ممکن)
     * 4. بقیه بر اساس relevanceScore
     */
    static selectForContext(
        entries: MemoryEntry[],
        maxTokens: number,
    ): MemoryEntry[] {
        const activeEntries = entries.filter((e) => e.isActive());
        const selected: MemoryEntry[] = [];
        let totalTokens = 0;

        // مرحله ۱: pinned‌ها (حتماً)
        const pinned = activeEntries.filter((e) => e.isPinned());
        for (const entry of pinned) {
            if (totalTokens + entry.estimatedTokens > maxTokens) break;
            selected.push(entry);
            totalTokens += entry.estimatedTokens;
        }

        // مرحله ۲: critical‌ها (حتماً)
        const critical = activeEntries.filter(
            (e) => !e.isPinned() && e.metadata.importance === "critical",
        );
        for (const entry of critical) {
            if (totalTokens + entry.estimatedTokens > maxTokens) break;
            selected.push(entry);
            totalTokens += entry.estimatedTokens;
        }

        // مرحله ۳: بقیه بر اساس relevance
        const remaining = activeEntries
            .filter((e) => !selected.includes(e))
            .sort((a, b) => b.relevanceScore - a.relevanceScore);

        for (const entry of remaining) {
            if (totalTokens + entry.estimatedTokens > maxTokens) break;
            selected.push(entry);
            totalTokens += entry.estimatedTokens;
        }

        return selected;
    }

    /**
     * محاسبه آمار مجموعه حافظه‌ها
     */
    static calculateStats(entries: MemoryEntry[]): MemoryStats {
        const byType = {} as Record<MemoryType, number>;
        const byDomain = {} as Record<MemoryDomain, number>;
        let totalTokens = 0;
        let totalRelevance = 0;
        let oldestDate: Date | null = null;
        let newestDate: Date | null = null;
        let activeCount = 0;
        let expiredCount = 0;
        let pinnedCount = 0;

        const allTypes: MemoryType[] = [
            "fact", "event", "emotion", "preference",
            "skill", "project", "summary", "pinned",
        ];
        const allDomains: MemoryDomain[] = [
            "personal", "technical", "gaming",
            "emotional", "relationship", "project",
        ];

        for (const t of allTypes) byType[t] = 0;
        for (const d of allDomains) byDomain[d] = 0;

        for (const entry of entries) {
            // type count
            byType[entry.metadata.type]++;

            // domain count
            for (const domain of entry.metadata.domains) {
                byDomain[domain]++;
            }

            // tokens
            totalTokens += entry.estimatedTokens;

            // relevance
            totalRelevance += entry.relevanceScore;

            // status
            if (entry.isActive()) activeCount++;
            if (entry.isExpired()) expiredCount++;
            if (entry.isPinned()) pinnedCount++;

            // dates
            const created = entry.metadata.createdAt;
            if (!oldestDate || created < oldestDate) oldestDate = created;
            if (!newestDate || created > newestDate) newestDate = created;
        }

        return {
            total: entries.length,
            active: activeCount,
            expired: expiredCount,
            pinned: pinnedCount,
            byType,
            byDomain,
            totalTokens,
            averageRelevance: entries.length > 0
                ? Math.round((totalRelevance / entries.length) * 100) / 100
                : 0,
            oldestEntry: oldestDate,
            newestEntry: newestDate,
        };
    }

    // ============================================================
    // 🔧 PRIVATE HELPERS
    // ============================================================

    /**
     * تولید ID یکتا
     */
    private static generateId(type: MemoryType): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 8);
        return `mem_${type}_${timestamp}_${random}`;
    }

    /**
     * استخراج کلیدواژه‌ها از متن
     *
     * ترکیب:
     * - کلمات فارسی بلند (۳+ کاراکتر)
     * - کلمات انگلیسی بلند (۳+ کاراکتر)
     * - حذف stop words
     */
    private static extractKeywords(content: string): string[] {
        const normalized = MemoryEntry.normalizeText(content);

        // Split و فیلتر
        const words = normalized
            .split(/[\s\-_.,;:!?()[\]{}"'`\/\\]+/)
            .filter((word) => word.length >= 2)
            .filter((word) => !STOP_WORDS.has(word));

        // حذف تکراری‌ها
        return [...new Set(words)];
    }

    /**
     * نرمال‌سازی متن برای جستجو
     */
    private static normalizeText(text: string): string {
        return text
            .toLowerCase()
            // تبدیل اعداد فارسی به انگلیسی
            .replace(/[۰-۹]/g, (d) =>
                String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 0x30)
            )
            // حذف نیم‌فاصله و حروف خاص
            .replace(/\u200C/g, " ")
            .trim();
    }

    /**
     * تخمین تعداد توکن
     * فارسی ≈ ۱ توکن هر ۲ کاراکتر
     * انگلیسی ≈ ۱ توکن هر ۴ کاراکتر
     */
    private static estimateTokens(content: string): number {
        const persianChars = (content.match(/[\u0600-\u06FF]/g) || []).length;
        const otherChars = content.length - persianChars;
        return Math.ceil(persianChars / 2 + otherChars / 4);
    }

    /**
     * آیکون نوع حافظه
     */
    private get typeIcon(): string {
        const icons: Record<MemoryType, string> = {
            fact: "📋",
            event: "📅",
            emotion: "💭",
            preference: "⭐",
            skill: "🛠️",
            project: "📂",
            summary: "📝",
            pinned: "📌",
        };
        return icons[this.metadata.type];
    }

    /**
     * ادغام domainهای چند entry
     */
    private static mergeDomains(entries: MemoryEntry[]): MemoryDomain[] {
        const domains = new Set<MemoryDomain>();
        for (const entry of entries) {
            for (const domain of entry.metadata.domains) {
                domains.add(domain);
            }
        }
        return [...domains];
    }

    /**
     * ساخت کپی با تغییرات
     */
    private clone(overrides: Partial<{
        content: string;
        metadata: MemoryMetadata;
        keywords: readonly string[];
        estimatedTokens: number;
    }>): MemoryEntry {
        return new MemoryEntry({
            id: this.id,
            content: overrides.content ?? this.content,
            metadata: overrides.metadata ?? this.metadata,
            keywords: overrides.keywords ?? this.keywords,
            estimatedTokens: overrides.estimatedTokens ?? this.estimatedTokens,
        });
    }
}

// ============================================================
// 🛑 STOP WORDS - کلمات بی‌ارزش برای جستجو
// ============================================================

const STOP_WORDS = new Set([
    // فارسی
    "از", "به", "در", "با", "که", "این", "آن", "یک", "برای",
    "است", "هست", "بود", "شد", "شده", "می", "هم", "تا", "را",
    "و", "یا", "اگر", "اما", "ولی", "هر", "چه", "کی", "چی",
    "من", "تو", "او", "ما", "شما", "آنها", "خود", "هیچ",
    "بسیار", "خیلی", "کمی", "فقط", "حتی", "دیگه", "الان",
    "باید", "میشه", "نمیشه", "داره", "نداره", "بودم", "بودی",

    // انگلیسی
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "has", "have", "had", "do", "does", "did", "will", "would",
    "can", "could", "should", "may", "might", "must", "shall",
    "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "and", "or", "but", "not", "no", "if", "then", "else",
    "this", "that", "these", "those", "it", "its",
    "i", "you", "he", "she", "we", "they", "my", "your",
    "just", "very", "really", "also", "too", "so", "how",
]);