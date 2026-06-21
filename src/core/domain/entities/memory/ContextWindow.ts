// src/core/domain/entities/memory/ContextWindow.ts

import { MemorySnapshot, type ContextOutputOptions } from "./MemorySnapshot";
import { MemoryEntry, type MemorySearchResult } from "./MemoryEntry";
import type { MemorySection, SectionType } from "./MemorySection";
import type { MemoryDomain } from "./MemoryMetadata";
import { Message } from "../Message";
import type { AgentType } from "../../types/AgentType";
import { SYSTEM_LIMITS } from "@/config";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * یک پیام در فرمت LLM
 */
export interface LLMMessage {
    readonly role: "system" | "user" | "assistant";
    readonly content: string;
}

/**
 * آپشن‌های ساخت Context Window
 */
export interface ContextWindowOptions {
    readonly maxTokens: number;
    readonly maxMessages: number;
    readonly agentType: AgentType;
    readonly includeMemory: boolean;
    readonly includePersonality: boolean;
    readonly relevantQuery?: string;
    readonly priorityDomains?: MemoryDomain[];
    readonly prioritySections?: SectionType[];
}

/**
 * ترکیب‌بندی توکن‌ها
 */
export interface TokenAllocation {
    readonly total: number;
    readonly systemPrompt: number;
    readonly personality: number;
    readonly memory: number;
    readonly relevantMemories: number;
    readonly conversationHistory: number;
    readonly currentMessage: number;
    readonly reserved: number;       // رزرو برای پاسخ مدل
}

/**
 * متادیتای Context Window
 */
export interface ContextWindowMeta {
    readonly totalTokens: number;
    readonly messageCount: number;
    readonly memoryEntriesIncluded: number;
    readonly relevantMemoriesIncluded: number;
    readonly conversationMessagesIncluded: number;
    readonly agentType: AgentType;
    readonly truncated: boolean;
    readonly buildTimeMs: number;
}

/**
 * بخش‌های Context Window
 */
interface ContextParts {
    systemPrompt: string;
    personality: string;
    memoryContext: string;
    relevantMemories: string;
    conversationHistory: LLMMessage[];
    currentMessage: LLMMessage;
}

// ============================================================
// 🪟 CONTEXT WINDOW
// ============================================================

/**
 * پنجره Context - آنچه واقعاً به LLM ارسال می‌شود
 *
 * ContextWindow آخرین لایه قبل از LLM است.
 * وظیفه‌اش: ساخت بهینه‌ترین context از:
 *   1. System Prompt (شخصیت Agent)
 *   2. Personality Layer (شخصیت ویرا)
 *   3. Long-term Memory (از MemorySnapshot)
 *   4. Relevant Memories (جستجو بر اساس پیام فعلی)
 *   5. Conversation History (پیام‌های اخیر)
 *   6. Current Message (پیام فعلی کاربر)
 *
 * ```
 * ┌──────────────────────────────────────┐
 * │         System Prompt               │ ← شخصیت Agent
 * ├──────────────────────────────────────┤
 * │         Personality                 │ ← لحن ویرا
 * ├──────────────────────────────────────┤
 * │         Memory Context              │ ← حافظه بلندمدت
 * ├──────────────────────────────────────┤
 * │         Relevant Memories           │ ← حافظه مرتبط
 * ├──────────────────────────────────────┤
 * │    ┌─ older messages ──────────┐    │
 * │    │  ...                      │    │
 * │    │  user: سلام               │    │ ← تاریخچه مکالمه
 * │    │  assistant: سلام!         │    │
 * │    └───────────────────────────┘    │
 * ├──────────────────────────────────────┤
 * │         Current Message             │ ← پیام فعلی
 * └──────────────────────────────────────┘
 * ```
 *
 * Immutable - هر بار build جدید.
 *
 * @example
 * ```typescript
 * const window = ContextWindow.build({
 *   snapshot,
 *   systemPrompt: "تو ویرا هستی...",
 *   personalityPrompt: "لحن: صمیمی و شوخ...",
 *   conversationHistory: recentMessages,
 *   currentMessage: newMessage,
 *   options: {
 *     maxTokens: 4096,
 *     maxMessages: 50,
 *     agentType: "dev",
 *     includeMemory: true,
 *     includePersonality: true,
 *   },
 * });
 *
 * // ارسال به LLM
 * const response = await llm.chat(window.messages);
 * ```
 */
export class ContextWindow {
    // ─── Core ────────────────────────────────────────────────
    public readonly messages: readonly LLMMessage[];
    public readonly meta: ContextWindowMeta;
    public readonly allocation: TokenAllocation;

    // ─── Parts (برای debugging) ──────────────────────────
    private readonly parts: ContextParts;

    // ─── Private Constructor ─────────────────────────────────
    private constructor(params: {
        messages: readonly LLMMessage[];
        meta: ContextWindowMeta;
        allocation: TokenAllocation;
        parts: ContextParts;
    }) {
        this.messages = params.messages;
        this.meta = params.meta;
        this.allocation = params.allocation;
        this.parts = params.parts;
    }

    // ============================================================
    // 🏭 MAIN BUILDER
    // ============================================================

    /**
     * ساخت Context Window کامل
     *
     * این متد اصلی‌ترین entry point این کلاس است.
     *
     * @example
     * ```typescript
     * const window = ContextWindow.build({
     *   snapshot: memorySnapshot,
     *   systemPrompt: devSystemPrompt,
     *   personalityPrompt: personalityMd,
     *   conversationHistory: last50Messages,
     *   currentMessage: userMessage,
     *   options: {
     *     maxTokens: 4096,
     *     maxMessages: 50,
     *     agentType: "dev",
     *     includeMemory: true,
     *     includePersonality: true,
     *     relevantQuery: "باگ داکر",
     *     priorityDomains: ["technical"],
     *   },
     * });
     * ```
     */
    static build(params: {
        snapshot: MemorySnapshot;
        systemPrompt: string;
        personalityPrompt?: string;
        conversationHistory: Message[];
        currentMessage: Message;
        options: ContextWindowOptions;
    }): ContextWindow {
        const startTime = Date.now();
        const {
            snapshot,
            systemPrompt,
            personalityPrompt,
            conversationHistory,
            currentMessage,
            options,
        } = params;

        // ─── 1. بودجه‌بندی توکن ──────────────────────────
        const allocation = ContextWindow.calculateAllocation(
            options.maxTokens,
            systemPrompt,
            personalityPrompt,
            currentMessage,
            options,
        );

        // ─── 2. ساخت هر بخش ─────────────────────────────
        const personality = options.includePersonality && personalityPrompt
            ? ContextWindow.buildPersonality(personalityPrompt, allocation.personality)
            : "";

        const memoryContext = options.includeMemory
            ? ContextWindow.buildMemoryContext(snapshot, allocation.memory, options)
            : "";

        const relevantMemories = options.relevantQuery
            ? ContextWindow.buildRelevantMemories(
                snapshot,
                options.relevantQuery,
                allocation.relevantMemories,
            )
            : "";

        const trimmedHistory = ContextWindow.buildConversationHistory(
            conversationHistory,
            allocation.conversationHistory,
            options.maxMessages,
        );

        const currentLLMMessage = currentMessage.toLLMFormat();

        // ─── 3. ترکیب به LLMMessage[] ──────────────────
        const messages = ContextWindow.assembleMessages({
            systemPrompt,
            personality,
            memoryContext,
            relevantMemories,
            conversationHistory: trimmedHistory,
            currentMessage: currentLLMMessage,
        });

        // ─── 4. متادیتا ─────────────────────────────────
        const totalTokens = ContextWindow.estimateTokens(
            messages.map((m) => m.content).join("\n"),
        );

        const meta: ContextWindowMeta = {
            totalTokens,
            messageCount: messages.length,
            memoryEntriesIncluded: ContextWindow.countMemoryEntries(memoryContext),
            relevantMemoriesIncluded: ContextWindow.countMemoryEntries(relevantMemories),
            conversationMessagesIncluded: trimmedHistory.length,
            agentType: options.agentType,
            truncated: totalTokens > options.maxTokens,
            buildTimeMs: Date.now() - startTime,
        };

        const parts: ContextParts = {
            systemPrompt,
            personality,
            memoryContext,
            relevantMemories,
            conversationHistory: trimmedHistory,
            currentMessage: currentLLMMessage,
        };

        return new ContextWindow({ messages, meta, allocation, parts });
    }

    /**
     * ساخت سریع بدون Memory (برای routing یا کارهای سبک)
     *
     * @example
     * ```typescript
     * const window = ContextWindow.buildMinimal({
     *   systemPrompt: "تشخیص بده این پیام مربوط به کدوم agent هست",
     *   currentMessage: message,
     *   maxTokens: 1024,
     * });
     * ```
     */
    static buildMinimal(params: {
        systemPrompt: string;
        currentMessage: Message;
        maxTokens?: number;
        recentMessages?: Message[];
    }): ContextWindow {
        const startTime = Date.now();
        const maxTokens = params.maxTokens ?? 1024;

        const messages: LLMMessage[] = [
            { role: "system", content: params.systemPrompt },
        ];

        // اضافه کردن چند پیام اخیر (اگر بود)
        if (params.recentMessages) {
            const recentBudget = Math.floor(maxTokens * 0.4);
            const trimmed = ContextWindow.buildConversationHistory(
                params.recentMessages,
                recentBudget,
                10,
            );
            messages.push(...trimmed);
        }

        messages.push(params.currentMessage.toLLMFormat());

        const totalTokens = ContextWindow.estimateTokens(
            messages.map((m) => m.content).join("\n"),
        );

        return new ContextWindow({
            messages,
            meta: {
                totalTokens,
                messageCount: messages.length,
                memoryEntriesIncluded: 0,
                relevantMemoriesIncluded: 0,
                conversationMessagesIncluded: params.recentMessages?.length ?? 0,
                agentType: "companion",
                truncated: false,
                buildTimeMs: Date.now() - startTime,
            },
            allocation: {
                total: maxTokens,
                systemPrompt: ContextWindow.estimateTokens(params.systemPrompt),
                personality: 0,
                memory: 0,
                relevantMemories: 0,
                conversationHistory: 0,
                currentMessage: ContextWindow.estimateTokens(params.currentMessage.content),
                reserved: 0,
            },
            parts: {
                systemPrompt: params.systemPrompt,
                personality: "",
                memoryContext: "",
                relevantMemories: "",
                conversationHistory: [],
                currentMessage: params.currentMessage.toLLMFormat(),
            },
        });
    }

    // ============================================================
    // 🔍 QUERY METHODS
    // ============================================================

    /**
     * آیا context پُر است؟ (بیش از ۹۰٪ بودجه)
     */
    get isNearLimit(): boolean {
        return this.meta.totalTokens > this.allocation.total * 0.9;
    }

    /**
     * چند توکن باقی مانده برای پاسخ مدل
     */
    get remainingTokens(): number {
        return Math.max(0, this.allocation.total - this.meta.totalTokens);
    }

    /**
     * درصد استفاده از بودجه
     */
    get usagePercent(): number {
        return Math.round((this.meta.totalTokens / this.allocation.total) * 100);
    }

    /**
     * آیا حافظه‌ای شامل شده؟
     */
    get hasMemory(): boolean {
        return this.meta.memoryEntriesIncluded > 0;
    }

    /**
     * آیا حافظه مرتبط پیدا شده؟
     */
    get hasRelevantMemories(): boolean {
        return this.meta.relevantMemoriesIncluded > 0;
    }

    /**
     * System prompt (اولین پیام)
     */
    get systemMessage(): LLMMessage | undefined {
        return this.messages.find((m) => m.role === "system");
    }

    /**
     * آخرین پیام کاربر
     */
    get lastUserMessage(): LLMMessage | undefined {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === "user") return this.messages[i];
        }
        return undefined;
    }

    // ============================================================
    // 🔄 MODIFICATIONS
    // ============================================================

    /**
     * اضافه کردن پیام به انتهای context
     * (مثلاً tool result یا system note)
     */
    appendMessage(message: LLMMessage): ContextWindow {
        const newMessages = [...this.messages, message];
        const addedTokens = ContextWindow.estimateTokens(message.content);

        return new ContextWindow({
            messages: newMessages,
            meta: {
                ...this.meta,
                totalTokens: this.meta.totalTokens + addedTokens,
                messageCount: this.meta.messageCount + 1,
                truncated: this.meta.totalTokens + addedTokens > this.allocation.total,
            },
            allocation: this.allocation,
            parts: this.parts,
        });
    }

    /**
     * اضافه کردن نتیجه Tool
     */
    appendToolResult(toolName: string, result: string): ContextWindow {
        return this.appendMessage({
            role: "system",
            content: `🔧 نتیجه ابزار "${toolName}":\n${result}`,
        });
    }

    /**
     * اضافه کردن یادآوری فوری
     * (مثلاً وقتی ویرا یادش میاد چیز مرتبطی هست)
     */
    appendMemoryRecall(entries: MemoryEntry[]): ContextWindow {
        if (entries.length === 0) return this;

        const content = entries
            .map((e) => e.toCompactFormat())
            .join("\n");

        return this.appendMessage({
            role: "system",
            content: `💡 یادآوری مرتبط:\n${content}`,
        });
    }

    // ============================================================
    // 📦 SERIALIZATION
    // ============================================================

    /**
     * خروجی برای ارسال به LLM API
     *
     * @example
     * ```typescript
     * const payload = window.toLLMPayload();
     * // [
     * //   { role: "system", content: "..." },
     * //   { role: "user", content: "سلام" },
     * //   { role: "assistant", content: "سلام!" },
     * //   { role: "user", content: "یه باگ دارم" },
     * // ]
     * ```
     */
    toLLMPayload(): LLMMessage[] {
        return [...this.messages];
    }

    /**
     * خروجی debug (نشون‌دهنده ساختار context)
     */
    toDebugView(): string {
        const lines: string[] = [
            "╔══════════════════════════════════════════╗",
            "║         CONTEXT WINDOW DEBUG             ║",
            "╠══════════════════════════════════════════╣",
            `║ Agent: ${this.meta.agentType.padEnd(33)}║`,
            `║ Tokens: ${String(this.meta.totalTokens).padEnd(32)}║`,
            `║ Budget: ${String(this.allocation.total).padEnd(32)}║`,
            `║ Usage: ${String(this.usagePercent + "%").padEnd(33)}║`,
            `║ Messages: ${String(this.meta.messageCount).padEnd(30)}║`,
            `║ Build Time: ${String(this.meta.buildTimeMs + "ms").padEnd(28)}║`,
            "╠══════════════════════════════════════════╣",
            "║ Token Allocation:                        ║",
            `║   System Prompt:    ${String(this.allocation.systemPrompt).padEnd(20)}║`,
            `║   Personality:      ${String(this.allocation.personality).padEnd(20)}║`,
            `║   Memory:           ${String(this.allocation.memory).padEnd(20)}║`,
            `║   Relevant:         ${String(this.allocation.relevantMemories).padEnd(20)}║`,
            `║   Conversation:     ${String(this.allocation.conversationHistory).padEnd(20)}║`,
            `║   Current Message:  ${String(this.allocation.currentMessage).padEnd(20)}║`,
            `║   Reserved:         ${String(this.allocation.reserved).padEnd(20)}║`,
            "╠══════════════════════════════════════════╣",
            "║ Messages:                                ║",
        ];

        for (const msg of this.messages) {
            const role = msg.role.padEnd(10);
            const preview = msg.content.slice(0, 25).replace(/\n/g, " ");
            const tokens = ContextWindow.estimateTokens(msg.content);
            lines.push(
                `║   [${role}] ${preview.padEnd(16)} (${String(tokens).padStart(4)} tok) ║`,
            );
        }

        lines.push("╚══════════════════════════════════════════╝");

        return lines.join("\n");
    }

    /**
     * خروجی JSON (برای logging و metrics)
     */
    toJSON(): Record<string, unknown> {
        return {
            meta: this.meta,
            allocation: this.allocation,
            messageCount: this.messages.length,
            messages: this.messages.map((m) => ({
                role: m.role,
                contentLength: m.content.length,
                estimatedTokens: ContextWindow.estimateTokens(m.content),
            })),
        };
    }

    // ============================================================
    // 🔧 PRIVATE BUILDERS
    // ============================================================

    /**
     * محاسبه تخصیص بودجه توکن
     *
     * فرمول:
     * ┌─────────────────────────────────────────────┐
     * │ Total Budget                                │
     * │ ├── Reserved (20%) → برای پاسخ مدل          │
     * │ ├── System Prompt (fixed)                   │
     * │ ├── Current Message (fixed)                 │
     * │ ├── Personality (5-8%)                      │
     * │ ├── Memory (15-25%)                         │
     * │ ├── Relevant (10-15%)                       │
     * │ └── Conversation (بقیه)                     │
     * └─────────────────────────────────────────────┘
     */
    private static calculateAllocation(
        maxTokens: number,
        systemPrompt: string,
        personalityPrompt: string | undefined,
        currentMessage: Message,
        options: ContextWindowOptions,
    ): TokenAllocation {
        // Fixed costs
        const systemPromptTokens = ContextWindow.estimateTokens(systemPrompt);
        const currentMessageTokens = currentMessage.estimatedTokens;
        const reserved = Math.floor(maxTokens * 0.20);

        let remaining = maxTokens - systemPromptTokens - currentMessageTokens - reserved;

        // Personality
        let personalityTokens = 0;
        if (options.includePersonality && personalityPrompt) {
            personalityTokens = Math.min(
                ContextWindow.estimateTokens(personalityPrompt),
                Math.floor(maxTokens * 0.08),
            );
            remaining -= personalityTokens;
        }

        // Memory
        let memoryTokens = 0;
        if (options.includeMemory) {
            memoryTokens = Math.floor(remaining * 0.30);
            remaining -= memoryTokens;
        }

        // Relevant Memories
        let relevantTokens = 0;
        if (options.relevantQuery) {
            relevantTokens = Math.floor(remaining * 0.25);
            remaining -= relevantTokens;
        }

        // Conversation History → بقیه بودجه
        const conversationTokens = Math.max(0, remaining);

        return {
            total: maxTokens,
            systemPrompt: systemPromptTokens,
            personality: personalityTokens,
            memory: memoryTokens,
            relevantMemories: relevantTokens,
            conversationHistory: conversationTokens,
            currentMessage: currentMessageTokens,
            reserved,
        };
    }

    /**
     * ساخت بخش Personality
     */
    private static buildPersonality(
        prompt: string,
        maxTokens: number,
    ): string {
        const tokens = ContextWindow.estimateTokens(prompt);

        if (tokens <= maxTokens) return prompt;

        // Truncate هوشمند: خطوط اول رو نگه دار
        return ContextWindow.truncateToTokens(prompt, maxTokens);
    }

    /**
     * ساخت بخش Memory Context
     */
    private static buildMemoryContext(
        snapshot: MemorySnapshot,
        maxTokens: number,
        options: ContextWindowOptions,
    ): string {
        if (snapshot.isEmpty) return "";

        const contextOptions: ContextOutputOptions = {
            maxTokens,
            prioritySections: options.prioritySections,
            compact: maxTokens < 1000,
            includeHeader: false,
            includeStats: false,
        };

        return snapshot.toContext(contextOptions);
    }

    /**
     * ساخت بخش Relevant Memories
     *
     * جستجو بر اساس پیام فعلی کاربر
     * و اضافه کردن حافظه‌های مرتبط
     */
    private static buildRelevantMemories(
        snapshot: MemorySnapshot,
        query: string,
        maxTokens: number,
    ): string {
        if (snapshot.isEmpty) return "";

        const results = snapshot.recall(query, 10);
        if (results.length === 0) return "";

        // فقط نتایج با score بالای ۰.۳
        const relevant = results.filter((r) => r.score > 0.3);
        if (relevant.length === 0) return "";

        const lines: string[] = ["### 💡 حافظه‌های مرتبط"];

        let currentTokens = ContextWindow.estimateTokens(lines[0]);

        for (const result of relevant) {
            const line = result.entry.toCompactFormat();
            const lineTokens = ContextWindow.estimateTokens(line);

            if (currentTokens + lineTokens > maxTokens) break;

            lines.push(line);
            currentTokens += lineTokens;
        }

        // اگر فقط هدر بود، چیزی برنگردون
        if (lines.length <= 1) return "";

        return lines.join("\n");
    }

    /**
     * ساخت تاریخچه مکالمه با محدودیت توکن
     *
     * از آخر (جدیدترین) شروع کن و به عقب برو
     * تا بودجه توکن تمام شود
     */
    private static buildConversationHistory(
        messages: Message[],
        maxTokens: number,
        maxMessages: number,
    ): LLMMessage[] {
        if (messages.length === 0) return [];

        const result: LLMMessage[] = [];
        let currentTokens = 0;
        let count = 0;

        // از آخر شروع کن (جدیدترین اول)
        for (let i = messages.length - 1; i >= 0; i--) {
            if (count >= maxMessages) break;

            const msg = messages[i];
            const llmMsg = msg.toLLMFormat();
            const msgTokens = ContextWindow.estimateTokens(llmMsg.content);

            if (currentTokens + msgTokens > maxTokens) break;

            result.unshift(llmMsg); // اول آرایه اضافه کن (ترتیب زمانی)
            currentTokens += msgTokens;
            count++;
        }

        return result;
    }

    /**
     * ترکیب نهایی پیام‌ها
     *
     * System prompt + Personality + Memory = یک system message ترکیبی
     * Conversation History = پیام‌های جداگانه
     * Current Message = آخرین پیام
     */
    private static assembleMessages(parts: {
        systemPrompt: string;
        personality: string;
        memoryContext: string;
        relevantMemories: string;
        conversationHistory: LLMMessage[];
        currentMessage: LLMMessage;
    }): LLMMessage[] {
        const messages: LLMMessage[] = [];

        // ─── System Message (ترکیبی) ──────────────────────
        const systemParts: string[] = [parts.systemPrompt];

        if (parts.personality) {
            systemParts.push("\n---\n");
            systemParts.push(parts.personality);
        }

        if (parts.memoryContext) {
            systemParts.push("\n---\n");
            systemParts.push(parts.memoryContext);
        }

        if (parts.relevantMemories) {
            systemParts.push("\n---\n");
            systemParts.push(parts.relevantMemories);
        }

        messages.push({
            role: "system",
            content: systemParts.join("\n"),
        });

        // ─── Conversation History ─────────────────────────
        messages.push(...parts.conversationHistory);

        // ─── Current Message ──────────────────────────────
        messages.push(parts.currentMessage);

        return messages;
    }

    // ============================================================
    // 🛠️ UTILITY
    // ============================================================

    /**
     * تخمین تعداد توکن
     * فارسی ≈ ۱ توکن هر ۲ کاراکتر
     * انگلیسی ≈ ۱ توکن هر ۴ کاراکتر
     */
    private static estimateTokens(text: string): number {
        if (!text) return 0;
        const persianChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
        const otherChars = text.length - persianChars;
        return Math.ceil(persianChars / 2 + otherChars / 4);
    }

    /**
     * کوتاه کردن متن تا بودجه توکن
     *
     * سعی می‌کنه از سر خط‌ها ببره (نه وسط جمله)
     */
    private static truncateToTokens(text: string, maxTokens: number): string {
        const currentTokens = ContextWindow.estimateTokens(text);
        if (currentTokens <= maxTokens) return text;

        const lines = text.split("\n");
        const result: string[] = [];
        let tokens = 0;

        for (const line of lines) {
            const lineTokens = ContextWindow.estimateTokens(line);
            if (tokens + lineTokens > maxTokens) break;
            result.push(line);
            tokens += lineTokens;
        }

        // اگر حتی یک خط جا نشد، کاراکتری ببر
        if (result.length === 0) {
            // تقریب: هر توکن ≈ ۳ کاراکتر
            const maxChars = maxTokens * 3;
            return text.slice(0, maxChars) + "...";
        }

        return result.join("\n");
    }

    /**
     * شمارش entry‌های حافظه در متن
     */
    private static countMemoryEntries(text: string): number {
        if (!text) return 0;
        return (text.match(/<!-- meta:/g) || []).length;
    }
}