// src/core/domain/entities/Message.ts

import type { AgentType } from "../types/AgentType";

// ============================================================
// 📐 TYPES & ENUMS
// ============================================================

/**
 * منبع پیام - از کجا اومده؟
 */
export type MessageSource = "text" | "voice" | "slash-command" | "system";

/**
 * وضعیت پردازش پیام در pipeline
 */
export type MessageStatus =
    | "received"      // دریافت شد
    | "routing"       // در حال روتینگ
    | "processing"    // Agent داره پردازش می‌کنه
    | "streaming"     // داره استریم میشه
    | "completed"     // تمام شد
    | "failed";       // خطا داد

/**
 * نوع محتوای پیام
 */
export type ContentType =
    | "plain"         // متن ساده
    | "code"          // شامل بلاک کد
    | "mixed";        // ترکیبی

/**
 * اطلاعات بلاک‌های کد استخراج‌شده
 */
export interface CodeBlock {
    readonly language: string;
    readonly content: string;
    readonly startIndex: number;
    readonly endIndex: number;
}

/**
 * اطلاعات نویسنده پیام
 */
export interface MessageAuthor {
    readonly id: string;
    readonly username: string;
    readonly displayName: string;
    readonly isBot: boolean;
}

/**
 * اطلاعات کانال
 */
export interface MessageChannel {
    readonly id: string;
    readonly name: string;
    readonly guildId?: string;
}

/**
 * متادیتای پردازش - توسط pipeline پر می‌شود
 */
export interface ProcessingMetadata {
    routedTo?: AgentType;
    routingConfidence?: number;
    routingStrategy?: "rule-based" | "llm" | "default";
    modelUsed?: string;
    providerUsed?: "ollama" | "openrouter";
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    toolsUsed?: string[];
}

/**
 * متادیتای صوتی - فقط برای پیام‌های voice
 */
export interface VoiceMetadata {
    duration: number;          // مدت صدا به ms
    sttLatency: number;        // تاخیر تبدیل صدا به متن
    sttConfidence: number;     // اطمینان STT (0-1)
    sttProvider: string;       // whisper-local | deepgram
}

// ============================================================
// 📝 MESSAGE ENTITY
// ============================================================

/**
 * موجودیت پیام - Primitive اصلی کل سیستم ویرا
 *
 * این کلاس Immutable است.
 * هر تغییر = یک instance جدید.
 *
 * @example
 * ```typescript
 * const msg = Message.fromDiscord(discordMessage);
 * const routed = msg.withRouting("dev", 0.95, "rule-based");
 * const completed = routed.withCompletion(1240, 450, 230);
 * ```
 */
export class Message {
    // ─── Core Fields ─────────────────────────────────────────
    public readonly id: string;
    public readonly content: string;
    public readonly author: MessageAuthor;
    public readonly channel: MessageChannel;
    public readonly source: MessageSource;
    public readonly timestamp: Date;

    // ─── Analysis Fields ─────────────────────────────────────
    public readonly contentType: ContentType;
    public readonly codeBlocks: readonly CodeBlock[];
    public readonly mentionsBot: boolean;
    public readonly replyToMessageId?: string;

    // ─── Pipeline State ──────────────────────────────────────
    public readonly status: MessageStatus;
    public readonly processing: ProcessingMetadata;
    public readonly voice?: VoiceMetadata;

    // ─── Private Constructor ─────────────────────────────────
    private constructor(params: {
        id: string;
        content: string;
        author: MessageAuthor;
        channel: MessageChannel;
        source: MessageSource;
        timestamp: Date;
        contentType: ContentType;
        codeBlocks: readonly CodeBlock[];
        mentionsBot: boolean;
        replyToMessageId?: string;
        status: MessageStatus;
        processing: ProcessingMetadata;
        voice?: VoiceMetadata;
    }) {
        this.id = params.id;
        this.content = params.content;
        this.author = params.author;
        this.channel = params.channel;
        this.source = params.source;
        this.timestamp = params.timestamp;
        this.contentType = params.contentType;
        this.codeBlocks = params.codeBlocks;
        this.mentionsBot = params.mentionsBot;
        this.replyToMessageId = params.replyToMessageId;
        this.status = params.status;
        this.processing = params.processing;
        this.voice = params.voice;
    }

    // ============================================================
    // 🏭 STATIC FACTORIES
    // ============================================================

    /**
     * ساخت Message از پیام دیسکورد
     *
     * @param raw - اطلاعات خام از Discord.js
     *
     * @example
     * ```typescript
     * // در MessageHandler:
     * const msg = Message.fromDiscord({
     *   id: discordMsg.id,
     *   content: discordMsg.content,
     *   author: {
     *     id: discordMsg.author.id,
     *     username: discordMsg.author.username,
     *     displayName: discordMsg.member?.displayName ?? discordMsg.author.username,
     *     isBot: discordMsg.author.bot,
     *   },
     *   channel: {
     *     id: discordMsg.channel.id,
     *     name: (discordMsg.channel as TextChannel).name,
     *     guildId: discordMsg.guildId ?? undefined,
     *   },
     *   mentionsBot: discordMsg.mentions.has(client.user!.id),
     *   replyToMessageId: discordMsg.reference?.messageId,
     * });
     * ```
     */
    static fromDiscord(raw: {
        id: string;
        content: string;
        author: MessageAuthor;
        channel: MessageChannel;
        mentionsBot: boolean;
        replyToMessageId?: string;
    }): Message {
        const { contentType, codeBlocks } = Message.analyzeContent(raw.content);

        return new Message({
            id: raw.id,
            content: raw.content,
            author: raw.author,
            channel: raw.channel,
            source: "text",
            timestamp: new Date(),
            contentType,
            codeBlocks,
            mentionsBot: raw.mentionsBot,
            replyToMessageId: raw.replyToMessageId,
            status: "received",
            processing: {},
        });
    }

    /**
     * ساخت Message از ورودی صوتی (بعد از STT)
     *
     * @example
     * ```typescript
     * const msg = Message.fromVoice({
     *   content: "یه باگ دارم توی داکرم",
     *   author: { id: "123", username: "ali", ... },
     *   channel: { id: "456", name: "voice-chat" },
     *   voice: {
     *     duration: 3200,
     *     sttLatency: 450,
     *     sttConfidence: 0.92,
     *     sttProvider: "whisper-local",
     *   },
     * });
     * ```
     */
    static fromVoice(raw: {
        content: string;
        author: MessageAuthor;
        channel: MessageChannel;
        voice: VoiceMetadata;
    }): Message {
        const { contentType, codeBlocks } = Message.analyzeContent(raw.content);

        return new Message({
            id: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            content: raw.content,
            author: raw.author,
            channel: raw.channel,
            source: "voice",
            timestamp: new Date(),
            contentType,
            codeBlocks,
            mentionsBot: true,   // Voice = همیشه مستقیم با ویرا
            status: "received",
            processing: {},
            voice: raw.voice,
        });
    }

    /**
     * ساخت پیام سیستمی (مثلاً خلاصه‌سازی خودکار)
     */
    static system(content: string, channel: MessageChannel): Message {
        return new Message({
            id: `sys_${Date.now()}`,
            content,
            author: {
                id: "system",
                username: "system",
                displayName: "Vira System",
                isBot: true,
            },
            channel,
            source: "system",
            timestamp: new Date(),
            contentType: "plain",
            codeBlocks: [],
            mentionsBot: false,
            status: "received",
            processing: {},
        });
    }

    // ============================================================
    // 🔄 STATE TRANSITIONS (Immutable)
    // ============================================================

    /**
     * پیام وارد فاز روتینگ شد
     */
    withRouting(
        agentType: AgentType,
        confidence: number,
        strategy: "rule-based" | "llm" | "default",
    ): Message {
        return this.clone({
            status: "routing",
            processing: {
                ...this.processing,
                routedTo: agentType,
                routingConfidence: confidence,
                routingStrategy: strategy,
            },
        });
    }

    /**
     * پیام در حال پردازش توسط Agent
     */
    withProcessing(model: string, provider: "ollama" | "openrouter"): Message {
        return this.clone({
            status: "processing",
            processing: {
                ...this.processing,
                modelUsed: model,
                providerUsed: provider,
            },
        });
    }

    /**
     * پیام در حال استریم شدن
     */
    withStreaming(): Message {
        return this.clone({ status: "streaming" });
    }

    /**
     * پیام با موفقیت پردازش شد
     */
    withCompletion(
        latencyMs: number,
        promptTokens?: number,
        completionTokens?: number,
        toolsUsed?: string[],
    ): Message {
        return this.clone({
            status: "completed",
            processing: {
                ...this.processing,
                latencyMs,
                promptTokens,
                completionTokens,
                toolsUsed,
            },
        });
    }

    /**
     * پردازش پیام شکست خورد
     */
    withFailure(): Message {
        return this.clone({ status: "failed" });
    }

    // ============================================================
    // 🔍 QUERY METHODS
    // ============================================================

    /**
     * آیا پیام شامل کد هست؟
     */
    hasCode(): boolean {
        return this.codeBlocks.length > 0;
    }

    /**
     * آیا پیام از ویس‌چت اومده؟
     */
    isVoice(): boolean {
        return this.source === "voice";
    }

    /**
     * آیا پیام سیستمیه؟
     */
    isSystem(): boolean {
        return this.source === "system";
    }

    /**
     * آیا پیام reply به پیام دیگه‌ای هست؟
     */
    isReply(): boolean {
        return this.replyToMessageId !== undefined;
    }

    /**
     * آیا پردازش تموم شده؟
     */
    isCompleted(): boolean {
        return this.status === "completed";
    }

    /**
     * آیا پردازش شکست خورده؟
     */
    isFailed(): boolean {
        return this.status === "failed";
    }

    /**
     * متن خالص بدون بلاک‌های کد
     */
    getTextContent(): string {
        let text = this.content;
        // از آخر شروع کن تا indexها خراب نشن
        for (let i = this.codeBlocks.length - 1; i >= 0; i--) {
            const block = this.codeBlocks[i];
            text = text.slice(0, block.startIndex) + text.slice(block.endIndex);
        }
        return text.trim();
    }

    /**
     * طول پیام به کاراکتر
     */
    get length(): number {
        return this.content.length;
    }

    /**
     * تخمین تعداد توکن (تقریبی)
     * فارسی ≈ ۱ توکن هر ۲ کاراکتر
     * انگلیسی ≈ ۱ توکن هر ۴ کاراکتر
     */
    get estimatedTokens(): number {
        const persianChars = (this.content.match(/[\u0600-\u06FF]/g) || []).length;
        const otherChars = this.content.length - persianChars;
        return Math.ceil(persianChars / 2 + otherChars / 4);
    }

    /**
     * مدت زمان از دریافت پیام (ms)
     */
    get ageMs(): number {
        return Date.now() - this.timestamp.getTime();
    }

    // ============================================================
    // 📊 SERIALIZATION
    // ============================================================

    /**
     * تبدیل به فرمت قابل ذخیره در حافظه مارک‌داون
     */
    toMemoryFormat(): string {
        const role = this.author.isBot ? "Vira" : this.author.displayName;
        const time = this.timestamp.toLocaleTimeString("fa-IR", {
            hour: "2-digit",
            minute: "2-digit",
        });
        return `- **[${time}] ${role}:** ${this.content}`;
    }

    /**
     * تبدیل به فرمت LLM (برای ارسال به مدل)
     */
    toLLMFormat(): { role: "user" | "assistant" | "system"; content: string } {
        if (this.isSystem()) {
            return { role: "system", content: this.content };
        }
        return {
            role: this.author.isBot ? "assistant" : "user",
            content: this.content,
        };
    }

    /**
     * تبدیل به JSON خالص (برای logging/metrics)
     */
    toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            content: this.content,
            author: this.author,
            channel: {
                id: this.channel.id,
                name: this.channel.name,
            },
            source: this.source,
            contentType: this.contentType,
            codeBlocksCount: this.codeBlocks.length,
            mentionsBot: this.mentionsBot,
            status: this.status,
            processing: this.processing,
            voice: this.voice,
            timestamp: this.timestamp.toISOString(),
            estimatedTokens: this.estimatedTokens,
        };
    }

    // ============================================================
    // 🔧 PRIVATE HELPERS
    // ============================================================

    /**
     * تحلیل محتوای پیام برای شناسایی بلاک‌های کد
     */
    private static analyzeContent(content: string): {
        contentType: ContentType;
        codeBlocks: CodeBlock[];
    } {
        const codeBlocks: CodeBlock[] = [];
        const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
        let match: RegExpExecArray | null;

        while ((match = codeBlockRegex.exec(content)) !== null) {
            codeBlocks.push({
                language: match[1] || "unknown",
                content: match[2].trim(),
                startIndex: match.index,
                endIndex: match.index + match[0].length,
            });
        }

        let contentType: ContentType;

        if (codeBlocks.length === 0) {
            contentType = "plain";
        } else {
            // اگر فقط کد بود و متن دیگه‌ای نبود
            const textWithoutCode = content.replace(codeBlockRegex, "").trim();
            contentType = textWithoutCode.length > 0 ? "mixed" : "code";
        }

        return { contentType, codeBlocks };
    }

    /**
     * بازسازی Message از JSON ذخیره‌شده روی دیسک
     */
    static fromJSON(data: Record<string, unknown>): Message {
        return new Message({
            id: data["id"] as string,
            content: data["content"] as string,
            author: data["author"] as MessageAuthor,
            channel: data["channel"] as MessageChannel,
            source: (data["source"] as MessageSource) ?? "text",
            timestamp: new Date(data["timestamp"] as string),
            contentType: (data["contentType"] as ContentType) ?? "plain",
            codeBlocks: [],
            mentionsBot: (data["mentionsBot"] as boolean) ?? false,
            replyToMessageId: data["replyToMessageId"] as string | undefined,
            status: (data["status"] as MessageStatus) ?? "completed",
            processing: (data["processing"] as ProcessingMetadata) ?? {},
            voice: data["voice"] as VoiceMetadata | undefined,
        });
    }

    /**
     * ساخت یک کپی با تغییرات
     */
    private clone(overrides: Partial<{
        status: MessageStatus;
        processing: ProcessingMetadata;
        voice: VoiceMetadata;
    }>): Message {
        return new Message({
            id: this.id,
            content: this.content,
            author: this.author,
            channel: this.channel,
            source: this.source,
            timestamp: this.timestamp,
            contentType: this.contentType,
            codeBlocks: this.codeBlocks,
            mentionsBot: this.mentionsBot,
            replyToMessageId: this.replyToMessageId,
            status: overrides.status ?? this.status,
            processing: overrides.processing ?? this.processing,
            voice: overrides.voice ?? this.voice,
        });
    }
}