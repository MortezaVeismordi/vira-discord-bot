// src/core/domain/entities/Conversation.ts

import { Message, type MessageSource, type MessageAuthor, type MessageChannel } from "./Message";
import type { AgentType } from "../types/AgentType";
import { SYSTEM_LIMITS } from "../../../config";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * وضعیت مکالمه
 *
 * idle       → منتظر پیام جدید
 * active     → در حال پردازش پیام
 * streaming  → در حال استریم پاسخ
 * cooldown   → بعد از پاسخ (جلوگیری از spam)
 */
export type ConversationState =
    | "idle"
    | "active"
    | "streaming"
    | "cooldown";

/**
 * موضوع فعلی مکالمه (تشخیص خودکار)
 */
export type ConversationTopic =
    | "coding"
    | "debugging"
    | "gaming"
    | "casual-chat"
    | "emotional"
    | "learning"
    | "unknown";

/**
 * آمار مکالمه
 */
export interface ConversationStats {
    readonly totalMessages: number;
    readonly userMessages: number;
    readonly botMessages: number;
    readonly systemMessages: number;
    readonly totalTokens: number;
    readonly averageResponseTime: number;
    readonly codeBlockCount: number;
    readonly voiceMessageCount: number;
    readonly duration: number;            // ms از شروع
    readonly messagesPerMinute: number;
    readonly dominantTopic: ConversationTopic;
    readonly agentsUsed: AgentType[];
}

/**
 * نتیجه Trim مکالمه
 */
export interface TrimResult {
    readonly removed: readonly Message[];
    readonly kept: readonly Message[];
    readonly freedTokens: number;
    readonly trimmedCount: number;
}

/**
 * Window دریافت پیام‌ها
 */
export interface MessageWindow {
    readonly messages: readonly Message[];
    readonly totalTokens: number;
    readonly startIndex: number;
    readonly endIndex: number;
}

/**
 * فیلتر پیام‌ها
 */
export interface MessageFilter {
    readonly role?: "user" | "bot" | "system";
    readonly source?: MessageSource;
    readonly hasCode?: boolean;
    readonly agentType?: AgentType;
    readonly after?: Date;
    readonly before?: Date;
    readonly limit?: number;
}

/**
 * متادیتای پاسخ (برای ذخیره کنار پیام ویرا)
 */
export interface ResponseMeta {
    readonly agentType: AgentType;
    readonly model: string;
    readonly provider: "ollama" | "openrouter";
    readonly latencyMs: number;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly toolsUsed?: string[];
}

// ============================================================
// 💬 CONVERSATION
// ============================================================

/**
 * موجودیت مکالمه - ظرف short-term memory
 *
 * هر کانال دیسکورد یک Conversation فعال دارد.
 * پیام‌ها اینجا جمع می‌شوند و برای ContextWindow ارسال می‌شوند.
 *
 * ```
 * Discord Event
 *      ↓
 * Conversation.addUserMessage()     ← پیام وارد می‌شود
 *      ↓
 * conversation.getRecentHistory()   ← ContextWindow ازش می‌خواند
 *      ↓
 * Conversation.addBotResponse()     ← پاسخ ویرا ذخیره می‌شود
 * ```
 *
 * Immutable - هر تغییر instance جدید می‌سازد.
 *
 * @example
 * ```typescript
 * let conv = Conversation.create("ch_123", "usr_456");
 *
 * conv = conv.addUserMessage(message);
 * const history = conv.getRecentHistory(30);
 * conv = conv.addBotResponse(responseMessage, {
 *   agentType: "dev",
 *   model: "llama3.1:8b",
 *   provider: "ollama",
 *   latencyMs: 1200,
 * });
 * ```
 */
export class Conversation {
    // ─── Identity ────────────────────────────────────────────
    public readonly id: string;
    public readonly channelId: string;
    public readonly userId: string;

    // ─── Messages ────────────────────────────────────────────
    public readonly messages: readonly Message[];

    // ─── State ───────────────────────────────────────────────
    public readonly state: ConversationState;
    public readonly currentAgent: AgentType | null;
    public readonly currentTopic: ConversationTopic;

    // ─── Tracking ────────────────────────────────────────────
    public readonly responseTimes: readonly number[];
    public readonly agentsUsed: readonly AgentType[];

    // ─── Timestamps ──────────────────────────────────────────
    public readonly startedAt: Date;
    public readonly lastActivityAt: Date;

    // ─── Private Constructor ─────────────────────────────────
    private constructor(params: {
        id: string;
        channelId: string;
        userId: string;
        messages: readonly Message[];
        state: ConversationState;
        currentAgent: AgentType | null;
        currentTopic: ConversationTopic;
        responseTimes: readonly number[];
        agentsUsed: readonly AgentType[];
        startedAt: Date;
        lastActivityAt: Date;
    }) {
        this.id = params.id;
        this.channelId = params.channelId;
        this.userId = params.userId;
        this.messages = params.messages;
        this.state = params.state;
        this.currentAgent = params.currentAgent;
        this.currentTopic = params.currentTopic;
        this.responseTimes = params.responseTimes;
        this.agentsUsed = params.agentsUsed;
        this.startedAt = params.startedAt;
        this.lastActivityAt = params.lastActivityAt;
    }

    // ============================================================
    // 🏭 FACTORIES
    // ============================================================

    /**
     * شروع مکالمه جدید
     *
     * @example
     * ```typescript
     * const conv = Conversation.create("ch_123", "usr_456");
     * ```
     */
    static create(channelId: string, userId: string): Conversation {
        const now = new Date();

        return new Conversation({
            id: `conv_${channelId}_${Date.now().toString(36)}`,
            channelId,
            userId,
            messages: [],
            state: "idle",
            currentAgent: null,
            currentTopic: "unknown",
            responseTimes: [],
            agentsUsed: [],
            startedAt: now,
            lastActivityAt: now,
        });
    }

    /**
     * بازسازی مکالمه از پیام‌های موجود
     * (مثلاً وقتی ربات restart می‌شود)
     *
     * @example
     * ```typescript
     * const conv = Conversation.fromMessages(
     *   "ch_123",
     *   "usr_456",
     *   existingMessages,
     * );
     * ```
     */
    static fromMessages(
        channelId: string,
        userId: string,
        messages: Message[],
    ): Conversation {
        const sorted = [...messages].sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
        );

        const now = new Date();
        const firstMsg = sorted[0]?.timestamp ?? now;
        const lastMsg = sorted[sorted.length - 1]?.timestamp ?? now;

        // استنباط agentsUsed
        const agents = new Set<AgentType>();
        for (const msg of sorted) {
            if (msg.processing.routedTo) {
                agents.add(msg.processing.routedTo);
            }
        }

        // استنباط topic
        const topic = Conversation.detectTopic(sorted);

        return new Conversation({
            id: `conv_${channelId}_${firstMsg.getTime().toString(36)}`,
            channelId,
            userId,
            messages: sorted,
            state: "idle",
            currentAgent: null,
            currentTopic: topic,
            responseTimes: [],
            agentsUsed: [...agents],
            startedAt: firstMsg,
            lastActivityAt: lastMsg,
        });
    }

    // ============================================================
    // 📝 MESSAGE MANAGEMENT
    // ============================================================

    /**
     * اضافه کردن پیام کاربر
     *
     * @example
     * ```typescript
     * conv = conv.addUserMessage(message);
     * ```
     */
    addUserMessage(message: Message): Conversation {
        // جلوگیری از duplicate
        if (this.hasMessage(message.id)) return this;

        const newTopic = Conversation.detectTopicFromMessage(
            message,
            this.currentTopic,
        );

        return this.clone({
            messages: [...this.messages, message],
            state: "active",
            currentTopic: newTopic,
            lastActivityAt: new Date(),
        });
    }

    /**
     * اضافه کردن پاسخ ویرا
     *
     * @example
     * ```typescript
     * conv = conv.addBotResponse(responseMessage, {
     *   agentType: "dev",
     *   model: "llama3.1:8b",
     *   provider: "ollama",
     *   latencyMs: 1200,
     *   promptTokens: 450,
     *   completionTokens: 230,
     * });
     * ```
     */
    addBotResponse(message: Message, meta: ResponseMeta): Conversation {
        if (this.hasMessage(message.id)) return this;

        // به‌روزرسانی پیام با metadata
        const enrichedMessage = message
            .withRouting(meta.agentType, 1.0, "rule-based")
            .withProcessing(meta.model, meta.provider)
            .withCompletion(
                meta.latencyMs,
                meta.promptTokens,
                meta.completionTokens,
                meta.toolsUsed,
            );

        // به‌روزرسانی لیست agent‌ها
        const newAgents = this.agentsUsed.includes(meta.agentType)
            ? this.agentsUsed
            : [...this.agentsUsed, meta.agentType];

        return this.clone({
            messages: [...this.messages, enrichedMessage],
            state: "cooldown",
            currentAgent: meta.agentType,
            responseTimes: [...this.responseTimes, meta.latencyMs],
            agentsUsed: newAgents,
            lastActivityAt: new Date(),
        });
    }

    /**
     * اضافه کردن پیام سیستمی
     */
    addSystemMessage(content: string): Conversation {
        const sysMsg = Message.system(content, {
            id: this.channelId,
            name: "system",
        });

        return this.clone({
            messages: [...this.messages, sysMsg],
            lastActivityAt: new Date(),
        });
    }

    /**
     * برگشت به حالت idle
     */
    markIdle(): Conversation {
        return this.clone({ state: "idle" });
    }

    /**
     * شروع استریم
     */
    markStreaming(): Conversation {
        return this.clone({ state: "streaming" });
    }

    // ============================================================
    // 🔍 HISTORY RETRIEVAL
    // ============================================================

    /**
     * دریافت N پیام اخیر
     *
     * @example
     * ```typescript
     * const recent = conv.getRecentMessages(10);
     * ```
     */
    getRecentMessages(count: number): readonly Message[] {
        if (count >= this.messages.length) return this.messages;
        return this.messages.slice(-count);
    }

    /**
     * دریافت پیام‌های اخیر با محدودیت توکن
     *
     * از آخر (جدیدترین) شروع و به عقب تا بودجه تمام شود
     *
     * @example
     * ```typescript
     * const { messages, totalTokens } = conv.getRecentHistory(2048);
     * ```
     */
    getRecentHistory(maxTokens: number): MessageWindow {
        const result: Message[] = [];
        let totalTokens = 0;

        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            const msgTokens = msg.estimatedTokens;

            if (totalTokens + msgTokens > maxTokens) break;

            result.unshift(msg);
            totalTokens += msgTokens;
        }

        return {
            messages: result,
            totalTokens,
            startIndex: this.messages.length - result.length,
            endIndex: this.messages.length - 1,
        };
    }

    /**
     * دریافت پیام‌ها با ترکیب count و token limit
     *
     * @example
     * ```typescript
     * const window = conv.getHistoryWindow({
     *   maxMessages: 30,
     *   maxTokens: 2048,
     * });
     * ```
     */
    getHistoryWindow(limits: {
        maxMessages?: number;
        maxTokens?: number;
    }): MessageWindow {
        const maxMessages = limits.maxMessages ?? SYSTEM_LIMITS.MAX_CONTEXT_MESSAGES;
        const maxTokens = limits.maxTokens ?? SYSTEM_LIMITS.MAX_CONTEXT_TOKENS;

        const result: Message[] = [];
        let totalTokens = 0;
        let count = 0;

        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (count >= maxMessages) break;

            const msg = this.messages[i];
            const msgTokens = msg.estimatedTokens;

            if (totalTokens + msgTokens > maxTokens) break;

            result.unshift(msg);
            totalTokens += msgTokens;
            count++;
        }

        return {
            messages: result,
            totalTokens,
            startIndex: this.messages.length - result.length,
            endIndex: this.messages.length - 1,
        };
    }

    /**
     * فیلتر کردن پیام‌ها
     *
     * @example
     * ```typescript
     * // فقط پیام‌های کاربر
     * const userMsgs = conv.filterMessages({ role: "user" });
     *
     * // فقط پیام‌های با کد
     * const codeMsgs = conv.filterMessages({ hasCode: true });
     *
     * // فقط پیام‌های dev agent
     * const devMsgs = conv.filterMessages({ agentType: "dev" });
     * ```
     */
    filterMessages(filter: MessageFilter): readonly Message[] {
        let result = [...this.messages];

        if (filter.role) {
            result = result.filter((msg) => {
                switch (filter.role) {
                    case "user":
                        return !msg.author.isBot && !msg.isSystem();
                    case "bot":
                        return msg.author.isBot && !msg.isSystem();
                    case "system":
                        return msg.isSystem();
                    default:
                        return true;
                }
            });
        }

        if (filter.source) {
            result = result.filter((msg) => msg.source === filter.source);
        }

        if (filter.hasCode !== undefined) {
            result = result.filter((msg) => msg.hasCode() === filter.hasCode);
        }

        if (filter.agentType) {
            result = result.filter(
                (msg) => msg.processing.routedTo === filter.agentType,
            );
        }

        if (filter.after) {
            result = result.filter((msg) => msg.timestamp > filter.after!);
        }

        if (filter.before) {
            result = result.filter((msg) => msg.timestamp < filter.before!);
        }

        if (filter.limit) {
            result = result.slice(-filter.limit);
        }

        return result;
    }

    // ============================================================
    // 🎯 SPECIFIC RETRIEVALS
    // ============================================================

    /**
     * آخرین پیام کاربر
     */
    get lastUserMessage(): Message | undefined {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            if (!msg.author.isBot && !msg.isSystem()) return msg;
        }
        return undefined;
    }

    /**
     * آخرین پاسخ ویرا
     */
    get lastBotResponse(): Message | undefined {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            if (msg.author.isBot && !msg.isSystem()) return msg;
        }
        return undefined;
    }

    /**
     * آخرین پیام (هر نوع)
     */
    get lastMessage(): Message | undefined {
        return this.messages[this.messages.length - 1];
    }

    /**
     * آخرین جفت پیام (user + bot)
     */
    getLastExchange(): { user: Message; bot: Message } | null {
        const user = this.lastUserMessage;
        const bot = this.lastBotResponse;

        if (!user || !bot) return null;
        if (user.timestamp > bot.timestamp) return null;

        return { user, bot };
    }

    /**
     * تمام بلاک‌های کد در مکالمه
     */
    getAllCodeBlocks(): Array<{
        messageId: string;
        language: string;
        content: string;
    }> {
        const blocks: Array<{
            messageId: string;
            language: string;
            content: string;
        }> = [];

        for (const msg of this.messages) {
            for (const block of msg.codeBlocks) {
                blocks.push({
                    messageId: msg.id,
                    language: block.language,
                    content: block.content,
                });
            }
        }

        return blocks;
    }

    /**
     * N پیام آخر به فرمت LLM
     */
    getRecentLLMMessages(count: number): Array<{
        role: "user" | "assistant" | "system";
        content: string;
    }> {
        return this.getRecentMessages(count).map((msg) => msg.toLLMFormat());
    }

    // ============================================================
    // ✂️ TRIMMING
    // ============================================================

    /**
     * Trim مکالمه تا تعداد مشخص
     *
     * پیام‌های قدیمی‌تر حذف می‌شوند
     * پیام‌های سیستمی مهم حفظ می‌شوند
     *
     * @example
     * ```typescript
     * const { conversation, result } = conv.trimToCount(30);
     * console.log(`${result.trimmedCount} messages removed`);
     * ```
     */
    trimToCount(maxMessages: number): {
        conversation: Conversation;
        result: TrimResult;
    } {
        if (this.messages.length <= maxMessages) {
            return {
                conversation: this,
                result: {
                    removed: [],
                    kept: this.messages,
                    freedTokens: 0,
                    trimmedCount: 0,
                },
            };
        }

        const kept = this.messages.slice(-maxMessages);
        const removed = this.messages.slice(0, -maxMessages);
        const freedTokens = removed.reduce(
            (sum, msg) => sum + msg.estimatedTokens,
            0,
        );

        return {
            conversation: this.clone({ messages: kept }),
            result: {
                removed,
                kept,
                freedTokens,
                trimmedCount: removed.length,
            },
        };
    }

    /**
     * Trim تا بودجه توکن
     *
     * @example
     * ```typescript
     * const { conversation, result } = conv.trimToTokenBudget(4096);
     * ```
     */
    trimToTokenBudget(maxTokens: number): {
        conversation: Conversation;
        result: TrimResult;
    } {
        if (this.totalTokens <= maxTokens) {
            return {
                conversation: this,
                result: {
                    removed: [],
                    kept: this.messages,
                    freedTokens: 0,
                    trimmedCount: 0,
                },
            };
        }

        // از آخر شروع و به عقب
        const kept: Message[] = [];
        let currentTokens = 0;

        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            const msgTokens = msg.estimatedTokens;

            if (currentTokens + msgTokens > maxTokens) break;

            kept.unshift(msg);
            currentTokens += msgTokens;
        }

        const removed = this.messages.slice(
            0,
            this.messages.length - kept.length,
        );
        const freedTokens = removed.reduce(
            (sum, msg) => sum + msg.estimatedTokens,
            0,
        );

        return {
            conversation: this.clone({ messages: kept }),
            result: {
                removed,
                kept,
                freedTokens,
                trimmedCount: removed.length,
            },
        };
    }

    /**
     * Trim ترکیبی (هم count هم token)
     */
    trim(limits?: {
        maxMessages?: number;
        maxTokens?: number;
    }): {
        conversation: Conversation;
        result: TrimResult;
    } {
        const maxMessages = limits?.maxMessages ?? SYSTEM_LIMITS.MAX_CONTEXT_MESSAGES;
        const maxTokens = limits?.maxTokens ?? SYSTEM_LIMITS.MAX_CONTEXT_TOKENS;

        // اول count trim
        const afterCount = this.trimToCount(maxMessages);

        // بعد token trim
        const afterTokens = afterCount.conversation.trimToTokenBudget(maxTokens);

        // ترکیب نتایج
        const totalRemoved = [
            ...afterCount.result.removed,
            ...afterTokens.result.removed,
        ];

        return {
            conversation: afterTokens.conversation,
            result: {
                removed: totalRemoved,
                kept: afterTokens.result.kept,
                freedTokens:
                    afterCount.result.freedTokens + afterTokens.result.freedTokens,
                trimmedCount: totalRemoved.length,
            },
        };
    }

    // ============================================================
    // 📊 QUERIES & STATS
    // ============================================================

    /**
     * آیا پیام با این ID وجود دارد؟
     */
    hasMessage(messageId: string): boolean {
        return this.messages.some((m) => m.id === messageId);
    }

    /**
     * تعداد کل پیام‌ها
     */
    get size(): number {
        return this.messages.length;
    }

    /**
     * آیا مکالمه خالی است؟
     */
    get isEmpty(): boolean {
        return this.messages.length === 0;
    }

    /**
     * مجموع توکن‌ها
     */
    get totalTokens(): number {
        return this.messages.reduce(
            (sum, msg) => sum + msg.estimatedTokens,
            0,
        );
    }

    /**
     * مدت مکالمه (ms)
     */
    get duration(): number {
        return Date.now() - this.startedAt.getTime();
    }

    /**
     * زمان از آخرین فعالیت (ms)
     */
    get idleTime(): number {
        return Date.now() - this.lastActivityAt.getTime();
    }

    /**
     * آیا مکالمه stale شده؟ (بیش از ۳۰ دقیقه بدون فعالیت)
     */
    isStale(thresholdMs: number = 30 * 60 * 1000): boolean {
        return this.idleTime > thresholdMs;
    }

    /**
     * آیا مکالمه فعال است؟
     */
    get isActive(): boolean {
        return this.state === "active" || this.state === "streaming";
    }

    /**
     * تعداد پیام‌های کاربر
     */
    get userMessageCount(): number {
        return this.messages.filter(
            (m) => !m.author.isBot && !m.isSystem(),
        ).length;
    }

    /**
     * تعداد پاسخ‌های ویرا
     */
    get botMessageCount(): number {
        return this.messages.filter(
            (m) => m.author.isBot && !m.isSystem(),
        ).length;
    }

    /**
     * میانگین زمان پاسخ (ms)
     */
    get averageResponseTime(): number {
        if (this.responseTimes.length === 0) return 0;
        const sum = this.responseTimes.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.responseTimes.length);
    }

    /**
     * آمار کامل مکالمه
     */
    get stats(): ConversationStats {
        return {
            totalMessages: this.size,
            userMessages: this.userMessageCount,
            botMessages: this.botMessageCount,
            systemMessages: this.messages.filter((m) => m.isSystem()).length,
            totalTokens: this.totalTokens,
            averageResponseTime: this.averageResponseTime,
            codeBlockCount: this.getAllCodeBlocks().length,
            voiceMessageCount: this.messages.filter((m) => m.isVoice()).length,
            duration: this.duration,
            messagesPerMinute: this.duration > 0
                ? Math.round((this.size / (this.duration / 60_000)) * 100) / 100
                : 0,
            dominantTopic: this.currentTopic,
            agentsUsed: [...this.agentsUsed],
        };
    }

    // ============================================================
    // 🧠 TOPIC DETECTION
    // ============================================================

    /**
     * تشخیص موضوع مکالمه از پیام‌ها
     */
    private static detectTopic(messages: readonly Message[]): ConversationTopic {
        if (messages.length === 0) return "unknown";

        let codeScore = 0;
        let gamingScore = 0;
        let emotionalScore = 0;

        const codingKeywords = [
            "باگ", "خطا", "کد", "error", "bug", "debug",
            "دیباگ", "داکر", "docker", "api", "function",
            "typescript", "javascript", "python", "react",
        ];

        const gamingKeywords = [
            "بازی", "گیم", "ماینکرفت", "minecraft", "game",
            "مپ", "سرور", "ماین", "pvp", "survival",
            "redstone", "nether", "creeper",
        ];

        const emotionalKeywords = [
            "خسته", "ناراحت", "خوشحال", "دلتنگ", "عصبانی",
            "ممنون", "دوست", "عشق", "حال", "احساس",
            "tired", "happy", "sad", "love", "feel",
        ];

        for (const msg of messages) {
            const content = msg.content.toLowerCase();

            if (msg.hasCode()) codeScore += 3;

            for (const kw of codingKeywords) {
                if (content.includes(kw)) codeScore++;
            }
            for (const kw of gamingKeywords) {
                if (content.includes(kw)) gamingScore++;
            }
            for (const kw of emotionalKeywords) {
                if (content.includes(kw)) emotionalScore++;
            }
        }

        const maxScore = Math.max(codeScore, gamingScore, emotionalScore);

        if (maxScore === 0) return "casual-chat";
        if (codeScore === maxScore) {
            return codeScore > gamingScore * 2 ? "debugging" : "coding";
        }
        if (gamingScore === maxScore) return "gaming";
        if (emotionalScore === maxScore) return "emotional";

        return "casual-chat";
    }

    /**
     * به‌روزرسانی topic با پیام جدید
     */
    private static detectTopicFromMessage(
        message: Message,
        currentTopic: ConversationTopic,
    ): ConversationTopic {
        const content = message.content.toLowerCase();

        // اگر کد داره → coding/debugging
        if (message.hasCode()) return "debugging";

        // بررسی کلیدواژه‌های قوی
        const strongCodingSignals = [
            "باگ", "error", "خطا", "debug", "```",
            "undefined", "null", "exception",
        ];
        const strongGamingSignals = [
            "ماینکرفت", "minecraft", "بازی", "game",
            "گیم", "ماین",
        ];
        const strongEmotionalSignals = [
            "خسته", "ناراحت", "خوشحال", "ممنون",
            "دلتنگ", "عصبانی",
        ];

        for (const signal of strongCodingSignals) {
            if (content.includes(signal)) return "debugging";
        }
        for (const signal of strongGamingSignals) {
            if (content.includes(signal)) return "gaming";
        }
        for (const signal of strongEmotionalSignals) {
            if (content.includes(signal)) return "emotional";
        }

        // اگر سیگنال قوی نبود، topic فعلی رو نگه دار
        return currentTopic;
    }

    // ============================================================
    // 📦 SERIALIZATION
    // ============================================================

    /**
     * تبدیل به مارک‌داون (برای ذخیره در memory)
     *
     * @example
     * ```markdown
     * ### 💬 مکالمه اخیر
     * - **[14:30] Ali:** سلام ویرا
     * - **[14:30] Vira:** سلام! چطوری؟ 💚
     * - **[14:31] Ali:** یه باگ دارم
     * ```
     */
    toMarkdown(): string {
        if (this.isEmpty) return "";

        const lines: string[] = ["### 💬 مکالمه اخیر", ""];

        for (const msg of this.messages) {
            if (msg.isSystem()) continue;
            lines.push(msg.toMemoryFormat());
        }

        return lines.join("\n");
    }

    /**
     * خروجی خلاصه برای logging
     */
    toSummaryLine(): string {
        const topic = this.currentTopic;
        const msgs = this.size;
        const tokens = this.totalTokens;
        const agent = this.currentAgent ?? "none";
        const avgResponse = this.averageResponseTime;

        return `[${this.channelId}] ${topic} | ${msgs} msgs | ${tokens} tok | agent: ${agent} | avg: ${avgResponse}ms`;
    }

    /**
     * خروجی JSON
     */
    toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            channelId: this.channelId,
            userId: this.userId,
            state: this.state,
            currentAgent: this.currentAgent,
            currentTopic: this.currentTopic,
            messageCount: this.size,
            totalTokens: this.totalTokens,
            userMessages: this.userMessageCount,
            botMessages: this.botMessageCount,
            averageResponseTime: this.averageResponseTime,
            agentsUsed: [...this.agentsUsed],
            duration: this.duration,
            idleTime: this.idleTime,
            isStale: this.isStale(),
            startedAt: this.startedAt.toISOString(),
            lastActivityAt: this.lastActivityAt.toISOString(),
        };
    }

    // ============================================================
    // 🔧 PRIVATE HELPERS
    // ============================================================

    /**
     * ساخت کپی با تغییرات
     */
    private clone(
        overrides: Partial<{
            messages: readonly Message[];
            state: ConversationState;
            currentAgent: AgentType | null;
            currentTopic: ConversationTopic;
            responseTimes: readonly number[];
            agentsUsed: readonly AgentType[];
            lastActivityAt: Date;
        }>,
    ): Conversation {
        return new Conversation({
            id: this.id,
            channelId: this.channelId,
            userId: this.userId,
            messages: overrides.messages ?? this.messages,
            state: overrides.state ?? this.state,
            currentAgent: overrides.currentAgent ?? this.currentAgent,
            currentTopic: overrides.currentTopic ?? this.currentTopic,
            responseTimes: overrides.responseTimes ?? this.responseTimes,
            agentsUsed: overrides.agentsUsed ?? this.agentsUsed,
            startedAt: this.startedAt,
            lastActivityAt: overrides.lastActivityAt ?? this.lastActivityAt,
        });
    }
}