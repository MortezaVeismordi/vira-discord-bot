// src/infrastructure/context/managers/ContextManager.ts

import type {
    IContextManager,
    SaveOptions,
    LoadOptions,
    BuildContextOptions,
    ExtractedMemories,
    SummarizationResult,
    MaintenanceResult,
    MemoryHealthStatus,
} from "@/core/contracts/IContextManager";
import type { ILLMPort } from "@/core/contracts/ILLMPort";
import type { IContextStorage } from "@/core/contracts/IStorage";
import type { IEventBus } from "@/core/contracts/IEventBus";
import type { Message } from "@/core/domain/entities/Message";
import type { Conversation } from "@/core/domain/entities/Conversation";
import type { AgentType } from "@/core/domain/types/AgentType";
import {
    MemoryEntry,
    type MemoryFilter,
    type MemorySearchResult,
} from "@/core/domain/entities/memory/MemoryEntry";
import {
    MemorySnapshot,
    type SnapshotPruneResult,
    type SnapshotStats,
} from "@/core/domain/entities/memory/MemorySnapshot";
import {
    ContextWindow,
    type ContextWindowOptions,
} from "@/core/domain/entities/memory/ContextWindow";
import type {
    MemoryType,
    MemoryDomain,
    ImportanceLevel,
} from "@/core/domain/entities/memory/MemoryMetadata";
import { SYSTEM_LIMITS } from "@/config";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * تنظیمات ContextManager
 */
export interface ContextManagerConfig {
    /** حداکثر توکن context */
    readonly maxContextTokens: number;

    /** حداکثر پیام در context */
    readonly maxContextMessages: number;

    /** خلاصه‌سازی خودکار فعال باشه؟ */
    readonly autoSummarize: boolean;

    /** در چه تعداد پیامی خلاصه‌سازی شروع بشه */
    readonly summarizeAtMessages: number;

    /** تعداد پیام‌های اخیر که خلاصه نشن */
    readonly keepRecentMessages: number;

    /** استخراج خودکار فعال باشه؟ */
    readonly autoExtract: boolean;

    /** cache فعال باشه؟ */
    readonly cacheEnabled: boolean;

    /** حداکثر آیتم در cache */
    readonly maxCacheSize: number;
}

/**
 * کلید cache
 */
interface CacheKey {
    readonly channelId: string;
    readonly userId: string;
}

/**
 * ورودی cache
 */
interface CacheEntry {
    snapshot: MemorySnapshot;
    loadedAt: Date;
    dirty: boolean;
}

// ============================================================
// 🧠 CONTEXT MANAGER
// ============================================================

/**
 * پیاده‌سازی اصلی IContextManager
 *
 * مدیریت کامل حافظه ویرا:
 *   1. بارگذاری و ذخیره (Markdown files)
 *   2. Remember & Recall
 *   3. Context Window ساخت
 *   4. خلاصه‌سازی
 *   5. استخراج اطلاعات
 *   6. نگهداری و پاکسازی
 *
 * ```
 *                    ┌────────────────────────┐
 *                    │    ContextManager      │
 *                    │                        │
 *  load/save ───────▶│  Cache (RAM)           │
 *                    │    ↕                   │
 *  remember/recall ─▶│  MemorySnapshot        │
 *                    │    ↕                   │
 *  buildContext ────▶│  ContextWindow         │
 *                    │    ↕                   │
 *  summarize ───────▶│  LLM (summarization)   │
 *                    │    ↕                   │
 *  maintain ────────▶│  Prune + Save          │
 *                    │                        │
 *                    └──────────┬─────────────┘
 *                               │
 *                    ┌──────────▼─────────────┐
 *                    │   IContextStorage      │
 *                    │  (FileStorage / DB)    │
 *                    └────────────────────────┘
 * ```
 *
 * @example
 * ```typescript
 * const contextManager = new ContextManager({
 *   storage: contextFileStorage,
 *   llm: llmFactory,
 *   eventBus: eventBus,
 *   config: {
 *     maxContextTokens: 4096,
 *     maxContextMessages: 50,
 *     autoSummarize: true,
 *     summarizeAtMessages: 40,
 *     keepRecentMessages: 10,
 *     autoExtract: true,
 *     cacheEnabled: true,
 *     maxCacheSize: 50,
 *   },
 * });
 *
 * // بارگذاری
 * const snapshot = await contextManager.load("ch_123", "usr_456");
 *
 * // ساخت context
 * const context = await contextManager.buildContext(conversation, message, {
 *   maxTokens: 4096,
 *   agentType: "dev",
 *   systemPrompt: devSystemPrompt,
 *   relevantQuery: message.content,
 * });
 *
 * // ذخیره خاطره
 * await contextManager.rememberMessage("ch_123", "usr_456", message);
 *
 * // ذخیره فایل
 * await contextManager.save("ch_123", "usr_456");
 * ```
 */
export class ContextManager implements IContextManager {
    private readonly storage: IContextStorage;
    private readonly llm: ILLMPort;
    private readonly eventBus: IEventBus;
    private readonly config: ContextManagerConfig;

    // ─── Cache ───────────────────────────────────────────
    private readonly cache: Map<string, CacheEntry>;

    constructor(params: {
        storage: IContextStorage;
        llm: ILLMPort;
        eventBus: IEventBus;
        config: ContextManagerConfig;
    }) {
        this.storage = params.storage;
        this.llm = params.llm;
        this.eventBus = params.eventBus;
        this.config = params.config;
        this.cache = new Map();
    }

    // ============================================================
    // 💾 LOAD & SAVE
    // ============================================================

    async load(
        channelId: string,
        userId: string,
        options?: LoadOptions,
    ): Promise<MemorySnapshot> {
        const cacheKey = this.toCacheKey(channelId, userId);

        // چک cache
        if (options?.useCache !== false && this.config.cacheEnabled) {
            const cached = this.cache.get(cacheKey);
            if (cached) return cached.snapshot;
        }

        // خواندن از storage
        const markdown = await this.storage.loadContext(channelId, userId);

        let snapshot: MemorySnapshot;

        if (markdown) {
            snapshot = MemorySnapshot.fromMarkdown(markdown, channelId, userId);
        } else if (options?.createIfNotExists !== false) {
            snapshot = MemorySnapshot.create(channelId, userId);
        } else {
            snapshot = MemorySnapshot.create(channelId, userId);
        }

        // Prune on load
        if (options?.pruneOnLoad) {
            const { snapshot: pruned } = snapshot.prune();
            snapshot = pruned;
        }

        // ذخیره در cache
        this.setCache(channelId, userId, snapshot, false);

        // Event
        this.eventBus.emitAsync("memory.loaded", {
            channelId,
            userId,
            entries: snapshot.totalEntries,
            tokens: snapshot.totalTokens,
        });

        return snapshot;
    }

    async save(
        channelId: string,
        userId: string,
        options?: SaveOptions,
    ): Promise<boolean> {
        const cacheKey = this.toCacheKey(channelId, userId);
        const cached = this.cache.get(cacheKey);

        if (!cached) {
            console.warn(
                `[ContextManager] Nothing to save for ${channelId}:${userId} (not in cache)`,
            );
            return false;
        }

        // فقط اگر تغییر کرده باشد
        if (options?.onlyIfChanged && !cached.dirty) {
            return false;
        }

        // Backup
        if (options?.backup) {
            const exists = await this.storage.contextExists(channelId, userId);
            if (exists) {
                await this.storage.backupContext(channelId, userId);
            }
        }

        // تبدیل به markdown و ذخیره
        const markdown = cached.snapshot.toMarkdown();
        const result = await this.storage.saveContext(channelId, userId, markdown);

        if (result.success) {
            cached.dirty = false;

            this.eventBus.emitAsync("memory.saved", {
                channelId,
                userId,
                size: result.bytesWritten ?? markdown.length,
                version: cached.snapshot.version,
            });
        }

        return result.success;
    }

    async loadOrCreate(
        channelId: string,
        userId: string,
    ): Promise<MemorySnapshot> {
        return this.load(channelId, userId, { createIfNotExists: true });
    }

    async delete(
        channelId: string,
        userId: string,
    ): Promise<boolean> {
        const cacheKey = this.toCacheKey(channelId, userId);
        this.cache.delete(cacheKey);

        return this.storage.deleteContext(channelId, userId);
    }

    async exists(
        channelId: string,
        userId: string,
    ): Promise<boolean> {
        // چک cache اول
        if (this.cache.has(this.toCacheKey(channelId, userId))) {
            return true;
        }

        return this.storage.contextExists(channelId, userId);
    }

    // ============================================================
    // 🧠 REMEMBER
    // ============================================================

    async remember(
        channelId: string,
        userId: string,
        entry: MemoryEntry,
    ): Promise<MemorySnapshot> {
        const snapshot = await this.ensureLoaded(channelId, userId);

        const updated = snapshot.remember(entry);

        this.setCache(channelId, userId, updated, true);

        this.eventBus.emitAsync("memory.created", {
            entry,
            section: entry.metadata.type,
            source: entry.metadata.source,
        });

        return updated;
    }

    async rememberMessage(
        channelId: string,
        userId: string,
        message: Message,
        hints?: {
            type?: MemoryType;
            domains?: MemoryDomain[];
            importance?: ImportanceLevel;
        },
    ): Promise<MemorySnapshot> {
        // تشخیص نوع
        const type = hints?.type ?? this.inferMemoryType(message);

        // تشخیص domain
        const domains = hints?.domains ?? this.inferDomains(message);

        // ساخت entry
        const entry = MemoryEntry.fromMessage(message, {
            type,
            domains,
            importance: hints?.importance,
        });

        return this.remember(channelId, userId, entry);
    }

    async rememberMany(
        channelId: string,
        userId: string,
        entries: MemoryEntry[],
    ): Promise<MemorySnapshot> {
        const snapshot = await this.ensureLoaded(channelId, userId);

        const updated = snapshot.rememberAll(entries);

        this.setCache(channelId, userId, updated, true);

        return updated;
    }

    async pin(
        channelId: string,
        userId: string,
        params: {
            content: string;
            type: MemoryType;
            domains: MemoryDomain[];
            tags?: string[];
        },
    ): Promise<MemorySnapshot> {
        const entry = MemoryEntry.pinned({
            content: params.content,
            type: params.type,
            domains: params.domains,
            channelId,
            userId,
            tags: params.tags,
        });

        const snapshot = await this.remember(channelId, userId, entry);

        this.eventBus.emitAsync("memory.pinned", {
            entry,
            reason: "user-request",
        });

        return snapshot;
    }

    async unpin(
        channelId: string,
        userId: string,
        entryId: string,
    ): Promise<MemorySnapshot> {
        const snapshot = await this.ensureLoaded(channelId, userId);

        const updated = snapshot.updateEntry(entryId, (entry) =>
            entry.pin(false),
        );

        this.setCache(channelId, userId, updated, true);

        return updated;
    }

    // ============================================================
    // 🔍 RECALL
    // ============================================================

    async recall(
        channelId: string,
        userId: string,
        query: string,
        limit: number = 10,
    ): Promise<MemorySearchResult[]> {
        const snapshot = await this.ensureLoaded(channelId, userId);

        return snapshot.recall(query, limit);
    }

    async recallAndTrack(
        channelId: string,
        userId: string,
        query: string,
        limit: number = 10,
    ): Promise<MemorySearchResult[]> {
        const snapshot = await this.ensureLoaded(channelId, userId);

        const [results, updated] = snapshot.recallAndTrack(query, limit);

        if (updated !== snapshot) {
            this.setCache(channelId, userId, updated, true);

            // Event برای هر recall
            for (const result of results) {
                this.eventBus.emitAsync("memory.recalled", {
                    entry: result.entry,
                    query,
                    score: result.score,
                    recallCount: result.entry.metadata.recallCount + 1,
                });
            }
        }

        return results;
    }

    async getPinned(
        channelId: string,
        userId: string,
    ): Promise<MemoryEntry[]> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        return snapshot.getPinned();
    }

    async filter(
        channelId: string,
        userId: string,
        filter: MemoryFilter,
    ): Promise<MemoryEntry[]> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        return snapshot.getFiltered(filter);
    }

    async getByDomain(
        channelId: string,
        userId: string,
        domain: MemoryDomain,
    ): Promise<MemoryEntry[]> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        return snapshot.getByDomain(domain);
    }

    async getByType(
        channelId: string,
        userId: string,
        type: MemoryType,
    ): Promise<MemoryEntry[]> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        return snapshot.getByType(type);
    }

    async getEntry(
        channelId: string,
        userId: string,
        entryId: string,
    ): Promise<MemoryEntry | undefined> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        return snapshot.findEntry(entryId);
    }

    // ============================================================
    // 🪟 CONTEXT BUILDING
    // ============================================================

    async buildContext(
        conversation: Conversation,
        currentMessage: Message,
        options: BuildContextOptions,
    ): Promise<ContextWindow> {
        const channelId = currentMessage.channel.id;
        const userId = currentMessage.author.id;

        const snapshot = await this.ensureLoaded(channelId, userId);

        // بارگذاری system prompt و personality از options
        const systemPrompt = options.systemPrompt;
        const personalityPrompt = options.personalityPrompt;

        // Relevant query: محتوای پیام فعلی
        const relevantQuery = options.relevantQuery ?? currentMessage.content;

        // دریافت تاریخچه مکالمه
        const historyWindow = conversation.getHistoryWindow({
            maxMessages: options.maxMessages ?? this.config.maxContextMessages,
            maxTokens: Math.floor(options.maxTokens * 0.4),
        });

        // ساخت context window
        const contextWindow = ContextWindow.build({
            snapshot,
            systemPrompt,
            personalityPrompt,
            conversationHistory: [...historyWindow.messages] as Message[],
            currentMessage,
            options: {
                maxTokens: options.maxTokens,
                maxMessages: options.maxMessages ?? this.config.maxContextMessages,
                agentType: options.agentType,
                includeMemory: true,
                includePersonality: !!personalityPrompt,
                relevantQuery,
                priorityDomains: options.relevantDomains,
                prioritySections: options.prioritySections,
            },
        });

        // Event
        this.eventBus.emitAsync("context.built", {
            agentType: options.agentType,
            totalTokens: contextWindow.meta.totalTokens,
            messageCount: contextWindow.meta.messageCount,
            memoryEntries: contextWindow.meta.memoryEntriesIncluded,
            buildTimeMs: contextWindow.meta.buildTimeMs,
        });

        // Warning اگر نزدیک حد مجاز
        if (contextWindow.isNearLimit) {
            this.eventBus.emitAsync("context.near-limit", {
                totalTokens: contextWindow.meta.totalTokens,
                maxTokens: options.maxTokens,
                usagePercent: contextWindow.usagePercent,
            });
        }

        return contextWindow;
    }

    buildMinimalContext(
        currentMessage: Message,
        systemPrompt: string,
        recentMessages?: Message[],
    ): ContextWindow {
        return ContextWindow.buildMinimal({
            systemPrompt,
            currentMessage,
            maxTokens: 1024,
            recentMessages,
        });
    }

    // ============================================================
    // 🔬 EXTRACTION
    // ============================================================

    async extractMemories(
        conversation: Conversation,
        channelId: string,
        userId: string,
    ): Promise<ExtractedMemories> {
        if (!this.config.autoExtract) {
            return { facts: [], skills: [], preferences: [], emotions: [], projects: [] };
        }

        // آخرین پیام‌ها رو بگیر
        const recentMessages = conversation.getRecentMessages(10);

        if (recentMessages.length < 3) {
            return { facts: [], skills: [], preferences: [], emotions: [], projects: [] };
        }

        const conversationText = recentMessages
            .map((msg) => msg.toMemoryFormat())
            .join("\n");

        try {
            const response = await this.llm.generate({
                messages: [
                    {
                        role: "system",
                        content: EXTRACTION_PROMPT,
                    },
                    {
                        role: "user",
                        content: conversationText,
                    },
                ],
                params: {
                    temperature: 0.1,
                    maxTokens: 1024,
                    jsonMode: true,
                },
                metadata: {
                    purpose: "extraction",
                    channelId,
                    userId,
                },
            });

            return this.parseExtractedMemories(response.content);
        } catch (error) {
            console.warn(
                `[ContextManager] Memory extraction failed:`,
                error,
            );
            return { facts: [], skills: [], preferences: [], emotions: [], projects: [] };
        }
    }

    async applyExtracted(
        channelId: string,
        userId: string,
        extracted: ExtractedMemories,
    ): Promise<MemorySnapshot> {
        const entries: MemoryEntry[] = [];

        // Facts
        for (const fact of extracted.facts) {
            entries.push(
                MemoryEntry.fromLLMExtraction({
                    content: fact.content,
                    type: "fact",
                    domains: fact.domains,
                    importance: fact.importance,
                    channelId,
                    userId,
                }),
            );
        }

        // Skills
        for (const skill of extracted.skills) {
            entries.push(
                MemoryEntry.fromLLMExtraction({
                    content: skill.content,
                    type: "skill",
                    domains: ["technical"],
                    importance: skill.importance,
                    channelId,
                    userId,
                }),
            );
        }

        // Preferences
        for (const pref of extracted.preferences) {
            entries.push(
                MemoryEntry.fromLLMExtraction({
                    content: pref.content,
                    type: "preference",
                    domains: ["personal"],
                    importance: pref.importance,
                    channelId,
                    userId,
                }),
            );
        }

        // Emotions
        for (const emotion of extracted.emotions) {
            entries.push(
                MemoryEntry.fromLLMExtraction({
                    content: emotion.content,
                    type: "emotion",
                    domains: ["emotional"],
                    channelId,
                    userId,
                }),
            );
        }

        // Projects
        for (const project of extracted.projects) {
            entries.push(
                MemoryEntry.fromLLMExtraction({
                    content: project.content,
                    type: "project",
                    domains: ["project"],
                    importance: project.importance,
                    channelId,
                    userId,
                }),
            );
        }

        if (entries.length === 0) {
            return this.ensureLoaded(channelId, userId);
        }

        return this.rememberMany(channelId, userId, entries);
    }

    // ============================================================
    // 📝 SUMMARIZATION
    // ============================================================

    async summarize(
        channelId: string,
        userId: string,
        conversation: Conversation,
    ): Promise<SummarizationResult | null> {
        if (!this.config.autoSummarize) return null;

        const shouldSummarize = await this.needsSummarization(
            channelId,
            userId,
            conversation,
        );

        if (!shouldSummarize) return null;

        // پیام‌های قدیمی (بدون recent)
        const allMessages = conversation.getRecentMessages(
            this.config.summarizeAtMessages,
        );

        const oldMessages = allMessages.slice(
            0,
            allMessages.length - this.config.keepRecentMessages,
        );

        if (oldMessages.length < 5) return null;

        const messagesText = oldMessages
            .map((msg) => msg.toMemoryFormat())
            .join("\n");

        const originalTokens = oldMessages.reduce(
            (sum, msg) => sum + msg.estimatedTokens,
            0,
        );

        try {
            const response = await this.llm.generate({
                messages: [
                    {
                        role: "system",
                        content: SUMMARIZATION_PROMPT,
                    },
                    {
                        role: "user",
                        content: messagesText,
                    },
                ],
                params: {
                    temperature: 0.2,
                    maxTokens: 512,
                },
                metadata: {
                    purpose: "summarization",
                    channelId,
                    userId,
                },
            });

            const summary = response.content.trim();
            const summaryTokens = response.usage.completionTokens;

            // ذخیره summary در snapshot
            const snapshot = await this.ensureLoaded(channelId, userId);
            const messageIds = oldMessages.map((m) => m.id);

            const updated = snapshot.addSummary(summary, messageIds);
            this.setCache(channelId, userId, updated, true);

            const result: SummarizationResult = {
                summary,
                originalMessageCount: oldMessages.length,
                originalTokenCount: originalTokens,
                summaryTokenCount: summaryTokens,
                compressionRatio: Math.round(
                    (1 - summaryTokens / originalTokens) * 100,
                ) / 100,
                preservedFacts: [],
            };

            this.eventBus.emitAsync("memory.summarized", {
                originalCount: result.originalMessageCount,
                summaryLength: summary.length,
                freedTokens: originalTokens - summaryTokens,
            });

            return result;
        } catch (error) {
            console.warn(`[ContextManager] Summarization failed:`, error);
            return null;
        }
    }

    async needsSummarization(
        channelId: string,
        userId: string,
        conversation: Conversation,
    ): Promise<boolean> {
        if (!this.config.autoSummarize) return false;

        return conversation.size >= this.config.summarizeAtMessages;
    }

    // ============================================================
    // 🧹 MAINTENANCE
    // ============================================================

    async maintain(
        channelId: string,
        userId: string,
        conversation?: Conversation,
    ): Promise<MaintenanceResult> {
        const startTime = Date.now();

        const snapshot = await this.ensureLoaded(channelId, userId);

        // ۱. حذف منقضی‌ها
        const afterExpired = snapshot.removeExpired();
        const expiredCount = snapshot.totalEntries - afterExpired.totalEntries;

        // ۲. Prune
        const { snapshot: afterPrune, result: pruneResult } = afterExpired.prune();

        // ۳. خلاصه‌سازی
        let summarizationResult: SummarizationResult | null = null;
        if (conversation) {
            summarizationResult = await this.summarize(
                channelId,
                userId,
                conversation,
            );
        }

        // ۴. ذخیره
        this.setCache(channelId, userId, afterPrune, true);
        const saved = await this.save(channelId, userId, { onlyIfChanged: true });

        const result: MaintenanceResult = {
            pruned: pruneResult,
            summarized: summarizationResult,
            expired: expiredCount,
            saved,
            duration: Date.now() - startTime,
        };

        if (pruneResult.totalRemoved > 0 || expiredCount > 0) {
            this.eventBus.emitAsync("memory.pruned", {
                removedCount: pruneResult.totalRemoved + expiredCount,
                freedTokens: pruneResult.totalFreedTokens,
                snapshotSize: afterPrune.totalEntries,
            });
        }

        return result;
    }

    async maintainAll(): Promise<Record<string, MaintenanceResult>> {
        const results: Record<string, MaintenanceResult> = {};
        const contexts = await this.storage.listContexts();

        for (const ctx of contexts) {
            const key = this.toCacheKey(ctx.channelId, ctx.userId);

            try {
                results[key] = await this.maintain(ctx.channelId, ctx.userId);
            } catch (error) {
                console.error(
                    `[ContextManager] Maintenance failed for ${key}:`,
                    error,
                );
            }
        }

        return results;
    }

    async prune(
        channelId: string,
        userId: string,
    ): Promise<SnapshotPruneResult> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        const { snapshot: pruned, result } = snapshot.prune();

        this.setCache(channelId, userId, pruned, true);

        return result;
    }

    async pruneToTokenBudget(
        channelId: string,
        userId: string,
        maxTokens: number,
    ): Promise<SnapshotPruneResult> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        const { snapshot: pruned, result } = snapshot.pruneToTokenBudget(maxTokens);

        this.setCache(channelId, userId, pruned, true);

        return result;
    }

    // ============================================================
    // 📊 HEALTH & STATS
    // ============================================================

    async health(
        channelId: string,
        userId: string,
    ): Promise<MemoryHealthStatus> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        const stats = snapshot.stats;

        return {
            channelId,
            userId,
            totalEntries: stats.totalEntries,
            totalTokens: stats.totalTokens,
            activeEntries: stats.totalActive,
            expiredEntries: stats.totalExpired,
            pinnedEntries: stats.totalPinned,
            needsSummarization: stats.totalEntries > this.config.summarizeAtMessages,
            needsPruning: stats.totalTokens > this.config.maxContextTokens,
            lastSaved: null,
            lastLoaded: this.cache.get(this.toCacheKey(channelId, userId))?.loadedAt ?? null,
            snapshotVersion: snapshot.version,
            fileSize: 0,
        };
    }

    async stats(
        channelId: string,
        userId: string,
    ): Promise<SnapshotStats> {
        const snapshot = await this.ensureLoaded(channelId, userId);
        return snapshot.stats;
    }

    async statsAll(): Promise<Array<{
        channelId: string;
        userId: string;
        stats: SnapshotStats;
    }>> {
        const contexts = await this.storage.listContexts();
        const results: Array<{
            channelId: string;
            userId: string;
            stats: SnapshotStats;
        }> = [];

        for (const ctx of contexts) {
            try {
                const s = await this.stats(ctx.channelId, ctx.userId);
                results.push({
                    channelId: ctx.channelId,
                    userId: ctx.userId,
                    stats: s,
                });
            } catch { }
        }

        return results;
    }

    async listAll(): Promise<Array<{
        channelId: string;
        userId: string;
        size: number;
        modifiedAt: Date;
    }>> {
        return this.storage.listContexts();
    }

    // ============================================================
    // 📦 SNAPSHOT ACCESS
    // ============================================================

    getSnapshot(
        channelId: string,
        userId: string,
    ): MemorySnapshot | undefined {
        return this.cache.get(this.toCacheKey(channelId, userId))?.snapshot;
    }

    isCached(channelId: string, userId: string): boolean {
        return this.cache.has(this.toCacheKey(channelId, userId));
    }

    clearCache(channelId?: string, userId?: string): void {
        if (channelId && userId) {
            this.cache.delete(this.toCacheKey(channelId, userId));
        } else {
            this.cache.clear();
        }
    }

    // ============================================================
    // 💾 BACKUP & RECOVERY
    // ============================================================

    async backup(channelId: string, userId: string): Promise<string> {
        // اول save کن (تا آخرین تغییرات ذخیره بشه)
        await this.save(channelId, userId, { onlyIfChanged: true });

        return this.storage.backupContext(channelId, userId);
    }

    async restore(channelId: string, userId: string): Promise<boolean> {
        const restored = await this.storage.restoreContext(channelId, userId);

        if (restored) {
            // cache رو invalidate کن
            this.cache.delete(this.toCacheKey(channelId, userId));
            // reload
            await this.load(channelId, userId);
        }

        return restored;
    }

    async listBackups(
        channelId: string,
        userId: string,
    ): Promise<Array<{
        path: string;
        size: number;
        createdAt: Date;
    }>> {
        // IContextStorage این method رو نداره
        // fallback ساده
        return [];
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    /**
     * اطمینان از load شدن snapshot
     */
    private async ensureLoaded(
        channelId: string,
        userId: string,
    ): Promise<MemorySnapshot> {
        const cached = this.cache.get(this.toCacheKey(channelId, userId));
        if (cached) return cached.snapshot;

        return this.load(channelId, userId, { createIfNotExists: true });
    }

    /**
     * ساخت cache key
     */
    private toCacheKey(channelId: string, userId: string): string {
        return `${channelId}:${userId}`;
    }

    /**
     * ذخیره در cache
     */
    private setCache(
        channelId: string,
        userId: string,
        snapshot: MemorySnapshot,
        dirty: boolean,
    ): void {
        if (!this.config.cacheEnabled) return;

        const key = this.toCacheKey(channelId, userId);

        // محدودیت سایز cache
        if (!this.cache.has(key) && this.cache.size >= this.config.maxCacheSize) {
            // حذف قدیمی‌ترین
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                const oldest = this.cache.get(oldestKey);
                // اگر dirty بود، اول save کن
                if (oldest?.dirty) {
                    const [ch, us] = oldestKey.split(":");
                    this.save(ch, us).catch(() => { });
                }
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            snapshot,
            loadedAt: new Date(),
            dirty,
        });
    }

    /**
     * تشخیص نوع حافظه از پیام
     */
    private inferMemoryType(message: Message): MemoryType {
        if (message.hasCode()) return "event";
        if (message.isVoice()) return "event";

        return "event";
    }

    /**
     * تشخیص domain از پیام
     */
    private inferDomains(message: Message): MemoryDomain[] {
        const domains: MemoryDomain[] = [];
        const content = message.content.toLowerCase();

        const technicalKeywords = [
            "کد", "code", "باگ", "bug", "error", "debug",
            "docker", "api", "typescript", "javascript",
            "function", "class", "server", "database",
        ];

        const gamingKeywords = [
            "بازی", "game", "ماینکرفت", "minecraft",
            "گیم", "pvp", "survival", "server",
        ];

        const emotionalKeywords = [
            "خسته", "خوشحال", "ناراحت", "ممنون",
            "دوست", "عشق", "حس", "احساس",
        ];

        if (technicalKeywords.some((kw) => content.includes(kw))) {
            domains.push("technical");
        }

        if (gamingKeywords.some((kw) => content.includes(kw))) {
            domains.push("gaming");
        }

        if (emotionalKeywords.some((kw) => content.includes(kw))) {
            domains.push("emotional");
        }

        if (message.hasCode()) {
            domains.push("technical");
        }

        // اگر هیچ domain تشخیص داده نشد
        if (domains.length === 0) {
            domains.push("personal");
        }

        // حذف تکراری
        return [...new Set(domains)];
    }

    /**
     * پارس خروجی extraction LLM
     */
    private parseExtractedMemories(json: string): ExtractedMemories {
        const empty: ExtractedMemories = {
            facts: [],
            skills: [],
            preferences: [],
            emotions: [],
            projects: [],
        };

        try {
            const parsed = JSON.parse(json);

            return {
                facts: Array.isArray(parsed.facts)
                    ? parsed.facts.map((f: any) => ({
                        content: String(f.content ?? f),
                        domains: Array.isArray(f.domains) ? f.domains : ["personal"],
                        importance: f.importance ?? "medium",
                    }))
                    : [],

                skills: Array.isArray(parsed.skills)
                    ? parsed.skills.map((s: any) => ({
                        content: String(s.content ?? s),
                        importance: s.importance ?? "high",
                    }))
                    : [],

                preferences: Array.isArray(parsed.preferences)
                    ? parsed.preferences.map((p: any) => ({
                        content: String(p.content ?? p),
                        importance: p.importance ?? "medium",
                    }))
                    : [],

                emotions: Array.isArray(parsed.emotions)
                    ? parsed.emotions.map((e: any) => ({
                        content: String(e.content ?? e),
                        trigger: e.trigger ?? "unknown",
                    }))
                    : [],

                projects: Array.isArray(parsed.projects)
                    ? parsed.projects.map((p: any) => ({
                        content: String(p.content ?? p),
                        importance: p.importance ?? "high",
                    }))
                    : [],
            };
        } catch {
            return empty;
        }
    }
}

// ============================================================
// 📝 PROMPTS
// ============================================================

const EXTRACTION_PROMPT = `تو یک سیستم استخراج اطلاعات هستی.
از مکالمه زیر اطلاعات مهم را استخراج کن.

خروجی JSON با این ساختار:
{
  "facts": [{"content": "...", "domains": ["personal"|"technical"|"gaming"], "importance": "high"|"medium"|"low"}],
  "skills": [{"content": "...", "importance": "high"|"medium"}],
  "preferences": [{"content": "...", "importance": "high"|"medium"}],
  "emotions": [{"content": "...", "trigger": "..."}],
  "projects": [{"content": "...", "importance": "high"|"medium"}]
}

قوانین:
- فقط اطلاعات واقعی و مشخص استخراج کن
- حدس نزن
- اگر چیزی پیدا نکردی، آرایه خالی برگردون
- content باید فارسی و خلاصه باشد
- فقط JSON خالص برگردون`;

const SUMMARIZATION_PROMPT = `تو یک خلاصه‌نویس هستی.
مکالمه زیر را خلاصه کن.

قوانین:
- خلاصه باید فارسی باشد
- نکات کلیدی و تصمیمات مهم را حفظ کن
- حقایق شخصی درباره کاربر را حفظ کن
- اطلاعات فنی مهم را حفظ کن
- احساسات و لحظات عاطفی مهم را ذکر کن
- خلاصه باید ۲۰۰ تا ۴۰۰ کلمه باشد
- از بولت‌پوینت استفاده کن`;

// ============================================================
// 🏭 FACTORY
// ============================================================

/**
 * ساخت ContextManager
 *
 * @example
 * ```typescript
 * const contextManager = createContextManager({
 *   storage: contextFileStorage,
 *   llm: llmFactory,
 *   eventBus: eventBus,
 *   memoryConfig: memoryConfig,
 * });
 * ```
 */
export function createContextManager(params: {
    storage: IContextStorage;
    llm: ILLMPort;
    eventBus: IEventBus;
    memoryConfig: {
        maxContextTokens: number;
        maxContextMessages: number;
        summarization: {
            enabled: boolean;
            triggerAtMessages: number;
            keepRecentMessages: number;
        };
    };
}): ContextManager {
    return new ContextManager({
        storage: params.storage,
        llm: params.llm,
        eventBus: params.eventBus,
        config: {
            maxContextTokens: params.memoryConfig.maxContextTokens,
            maxContextMessages: params.memoryConfig.maxContextMessages,
            autoSummarize: params.memoryConfig.summarization.enabled,
            summarizeAtMessages: params.memoryConfig.summarization.triggerAtMessages,
            keepRecentMessages: params.memoryConfig.summarization.keepRecentMessages,
            autoExtract: true,
            cacheEnabled: true,
            maxCacheSize: 50,
        },
    });
}