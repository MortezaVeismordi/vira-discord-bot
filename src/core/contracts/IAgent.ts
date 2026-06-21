// src/core/contracts/IAgent.ts

import type { Message } from "../domain/entities/Message";
import type { Conversation } from "../domain/entities/Conversation";
import type { MemorySnapshot } from "../domain/entities/memory/MemorySnapshot";
import type { ContextWindow } from "../domain/entities/memory/ContextWindow";
import type { AgentType } from "../domain/types/AgentType";
import type {
    ILLMPort,
    LLMResponse,
    LLMStreamCallbacks,
    LLMStreamController,
    LLMToolDefinition,
} from "./ILLMPort";
import type { IToolRegistry, ToolResult } from "./ITool";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * وضعیت Agent
 */
export type AgentStatus =
    | "idle"
    | "processing"
    | "streaming"
    | "tool-calling"
    | "error";

/**
 * نتیجه پردازش Agent
 */
export interface AgentResponse {
    /** متن پاسخ */
    readonly content: string;

    /** Agent مسئول */
    readonly agentType: AgentType;

    /** مدل استفاده شده */
    readonly model: string;

    /** پروایدر */
    readonly provider: string;

    /** زمان پردازش (ms) */
    readonly latencyMs: number;

    /** مصرف توکن */
    readonly usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };

    /** ابزارهای استفاده شده */
    readonly toolsUsed: ToolCallRecord[];

    /** آیا پاسخ استریم شده؟ */
    readonly streamed: boolean;

    /** آیا توسط personality engine اصلاح شده؟ */
    readonly personalityApplied: boolean;

    /** metadata اضافی */
    readonly metadata: Record<string, unknown>;
}

/**
 * ثبت فراخوانی ابزار
 */
export interface ToolCallRecord {
    readonly toolName: string;
    readonly arguments: Record<string, unknown>;
    readonly result: ToolResult;
    readonly latencyMs: number;
}

/**
 * Callbacks استریم Agent
 */
export interface AgentStreamCallbacks {
    /** هر chunk متنی */
    onChunk: (chunk: string, accumulated: string) => void | Promise<void>;

    /** یک جمله کامل آماده شد (برای TTS) */
    onSentence?: (sentence: string, index: number) => void | Promise<void>;

    /** Agent داره tool صدا می‌زنه */
    onToolCall?: (toolName: string, args: Record<string, unknown>) => void;

    /** نتیجه tool برگشت */
    onToolResult?: (toolName: string, result: ToolResult) => void;

    /** پاسخ کامل شد */
    onComplete?: (response: AgentResponse) => void;

    /** خطا */
    onError?: (error: AgentError) => void;
}

/**
 * کنترلر استریم Agent
 */
export interface AgentStreamController {
    /** لغو پردازش */
    abort: () => void;

    /** آیا لغو شده؟ */
    readonly isAborted: boolean;

    /** Promise نهایی */
    readonly completed: Promise<AgentResponse>;
}

/**
 * Context ورودی Agent
 *
 * همه اطلاعاتی که Agent برای پردازش نیاز داره
 */
export interface AgentContext {
    /** پیام فعلی */
    readonly message: Message;

    /** مکالمه فعلی */
    readonly conversation: Conversation;

    /** حافظه بلندمدت */
    readonly memory: MemorySnapshot;

    /** Context Window آماده شده */
    readonly contextWindow: ContextWindow;

    /** شناسه کانال */
    readonly channelId: string;

    /** شناسه کاربر */
    readonly userId: string;

    /** شناسه guild */
    readonly guildId?: string;

    /** آیا از voice اومده؟ */
    readonly isVoice: boolean;

    /** metadata اضافی */
    readonly metadata?: Record<string, unknown>;
}

/**
 * تنظیمات Agent
 */
export interface AgentConfig {
    /** نوع Agent */
    readonly type: AgentType;

    /** نام نمایشی */
    readonly displayName: string;

    /** توضیح */
    readonly description: string;

    /** مسیر فایل system prompt */
    readonly systemPromptPath: string;

    /** مدل ترجیحی */
    readonly preferredModel: "heavy" | "light";

    /** Temperature پیش‌فرض */
    readonly defaultTemperature: number;

    /** حداکثر توکن خروجی */
    readonly maxOutputTokens: number;

    /** آیا tool calling فعاله؟ */
    readonly toolCallingEnabled: boolean;

    /** آیا streaming فعاله؟ */
    readonly streamingEnabled: boolean;

    /** آیا personality اعمال بشه؟ */
    readonly applyPersonality: boolean;

    /** حداکثر تعداد tool call در یک پاسخ */
    readonly maxToolCalls: number;

    /** timeout (ms) */
    readonly timeout: number;
}

/**
 * خطای Agent
 */
export interface AgentError {
    readonly type: AgentErrorType;
    readonly message: string;
    readonly agentType: AgentType;
    readonly recoverable: boolean;
    readonly details?: Record<string, unknown>;
}

/**
 * انواع خطای Agent
 */
export type AgentErrorType =
    | "llm-error"
    | "tool-error"
    | "context-error"
    | "prompt-error"
    | "timeout"
    | "cancelled"
    | "unknown";

/**
 * قابلیت‌های Agent
 */
export interface AgentCapabilities {
    readonly canStream: boolean;
    readonly canCallTools: boolean;
    readonly canHandleCode: boolean;
    readonly canHandleVoice: boolean;
    readonly supportedDomains: string[];
    readonly supportedLanguages: string[];
}

/**
 * متریک‌های Agent
 */
export interface AgentMetrics {
    readonly totalRequests: number;
    readonly successCount: number;
    readonly errorCount: number;
    readonly averageLatencyMs: number;
    readonly averageTokensUsed: number;
    readonly toolCallCount: number;
    readonly streamCount: number;
    readonly lastUsedAt: Date | null;
}

// ============================================================
// 🤖 MAIN INTERFACE - IAgent
// ============================================================

/**
 * Interface اصلی Agent
 *
 * هر Agent یک شخصیت و تخصص متفاوت دارد:
 * - DevAgent: دستیار برنامه‌نویسی
 * - GamerAgent: همراه گیمینگ
 * - CompanionAgent: دوست‌دختر گیمر
 *
 * اما همه از یک Interface مشترک پیروی می‌کنند.
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │                  IAgent                      │
 * │                                              │
 * │  AgentContext ──▶ process() ──▶ AgentResponse│
 * │                                              │
 * │  AgentContext ──▶ stream()  ──▶ Chunks...   │
 * │                                              │
 * │  ┌──────────────────────────────────────┐   │
 * │  │         Internal Pipeline            │   │
 * │  │                                      │   │
 * │  │  1. Load System Prompt               │   │
 * │  │  2. Apply Personality                │   │
 * │  │  3. Build LLM Request               │   │
 * │  │  4. Call LLM                         │   │
 * │  │  5. Handle Tool Calls (if any)       │   │
 * │  │  6. Return Response                  │   │
 * │  └──────────────────────────────────────┘   │
 * └──────────────────────────────────────────────┘
 * ```
 *
 * @example
 * ```typescript
 * class DevAgent implements IAgent {
 *   readonly config: AgentConfig = {
 *     type: "dev",
 *     displayName: "🛠️ دستیار برنامه‌نویسی",
 *     systemPromptPath: "agents/dev/system.md",
 *     preferredModel: "heavy",
 *     defaultTemperature: 0.3,
 *     toolCallingEnabled: true,
 *     // ...
 *   };
 *
 *   async process(context: AgentContext): Promise<AgentResponse> {
 *     const prompt = await this.loadPrompt();
 *     const request = this.buildRequest(context, prompt);
 *     const response = await this.llm.generate(request);
 *     return this.formatResponse(response);
 *   }
 * }
 * ```
 */
export interface IAgent {
    // ─── Identity ─────────────────────────────────────────

    /** تنظیمات Agent */
    readonly config: AgentConfig;

    /** قابلیت‌ها */
    readonly capabilities: AgentCapabilities;

    // ─── Core Processing ──────────────────────────────────

    /**
     * پردازش پیام (Non-streaming)
     *
     * کل پاسخ رو یکجا تولید و برمی‌گردونه
     *
     * @example
     * ```typescript
     * const response = await agent.process(context);
     * console.log(response.content);
     * console.log(`Latency: ${response.latencyMs}ms`);
     * ```
     */
    process(context: AgentContext): Promise<AgentResponse>;

    /**
     * پردازش پیام (Streaming)
     *
     * پاسخ رو chunk به chunk تولید می‌کنه
     * مناسب برای:
     * - تایپ تدریجی در Discord
     * - ارسال به TTS برای voice chat
     *
     * @example
     * ```typescript
     * const controller = await agent.stream(context, {
     *   onChunk: (chunk, accumulated) => {
     *     // آپدیت پیام Discord
     *     discordMessage.edit(accumulated);
     *   },
     *   onSentence: (sentence, index) => {
     *     // ارسال به TTS
     *     tts.speak(sentence);
     *   },
     *   onToolCall: (name, args) => {
     *     console.log(`Calling tool: ${name}`);
     *   },
     *   onComplete: (response) => {
     *     console.log(`Done! ${response.usage.totalTokens} tokens`);
     *   },
     * });
     *
     * // اگر کاربر interrupt کرد:
     * controller.abort();
     * ```
     */
    stream(
        context: AgentContext,
        callbacks: AgentStreamCallbacks,
    ): Promise<AgentStreamController>;

    // ─── Tool Integration ─────────────────────────────────

    /**
     * دریافت ابزارهای مجاز این Agent
     *
     * @example
     * ```typescript
     * const tools = agent.getAvailableTools();
     * // DevAgent: [search_memory, analyze_code, read_file]
     * // GamerAgent: [search_memory, minecraft_wiki]
     * ```
     */
    getAvailableTools(): LLMToolDefinition[];

    /**
     * پردازش نتیجه Tool و ادامه مکالمه
     *
     * وقتی LLM یک tool call داده، نتیجه tool اجرا شده
     * و حالا باید دوباره به LLM برگرده
     */
    processToolResult(
        context: AgentContext,
        toolResults: ToolCallRecord[],
    ): Promise<AgentResponse>;

    // ─── Prompt Management ────────────────────────────────

    /**
     * دریافت System Prompt فعلی
     *
     * شامل بارگذاری از فایل + اعمال variables
     */
    getSystemPrompt(variables?: Record<string, string>): Promise<string>;

    /**
     * بارگذاری مجدد prompt (مثلاً بعد از ویرایش فایل)
     */
    reloadPrompt(): Promise<void>;

    // ─── Personality ──────────────────────────────────────

    /**
     * آیا Agent از Personality Engine استفاده می‌کنه؟
     */
    usesPersonality(): boolean;

    /**
     * اعمال شخصیت ویرا روی پاسخ
     *
     * بعضی Agentها ممکنه personality رو متفاوت اعمال کنن:
     * - DevAgent: فقط لحن، بدون emoji
     * - CompanionAgent: کامل با emoji و teasing
     * - GamerAgent: گیمینگ slangs
     */
    applyPersonality(
        response: string,
        mood?: string,
    ): string;

    // ─── Relevance Check ──────────────────────────────────

    /**
     * آیا این پیام مربوط به حوزه این Agent هست؟
     *
     * برای Rule-based routing استفاده می‌شه
     *
     * @returns score بین 0 تا 1
     *
     * @example
     * ```typescript
     * const devScore = devAgent.relevanceScore(message);    // 0.9
     * const gamerScore = gamerAgent.relevanceScore(message); // 0.1
     * ```
     */
    relevanceScore(message: Message): number;

    /**
     * کلیدواژه‌های فعال‌سازی Agent
     */
    getTriggerKeywords(): string[];

    // ─── Health & Metrics ─────────────────────────────────

    /**
     * وضعیت Agent
     */
    getStatus(): AgentStatus;

    /**
     * متریک‌ها
     */
    getMetrics(): AgentMetrics;

    /**
     * ریست متریک‌ها
     */
    resetMetrics(): void;

    /**
     * بررسی سلامت (مثلاً آیا prompt لود شده؟)
     */
    healthCheck(): Promise<{
        healthy: boolean;
        promptLoaded: boolean;
        llmAvailable: boolean;
        toolsAvailable: number;
    }>;
}

// ============================================================
// 🏭 AGENT FACTORY INTERFACE
// ============================================================

/**
 * Factory برای ساخت Agentها
 *
 * @example
 * ```typescript
 * class AgentFactory implements IAgentFactory {
 *   create(type: "dev"): DevAgent;
 *   create(type: "gamer"): GamerAgent;
 *   create(type: "companion"): CompanionAgent;
 * }
 *
 * const factory = new AgentFactory(llm, tools, prompts);
 * const devAgent = factory.create("dev");
 * ```
 */
export interface IAgentFactory {
    /**
     * ساخت Agent
     */
    create(type: AgentType): IAgent;

    /**
     * ساخت تمام Agentهای فعال
     */
    createAll(): Map<AgentType, IAgent>;

    /**
     * آیا Agent از این نوع قابل ساخته؟
     */
    canCreate(type: AgentType): boolean;

    /**
     * لیست نوع‌های قابل ساخت
     */
    availableTypes(): AgentType[];
}

// ============================================================
// 🛠️ HELPER FUNCTIONS
// ============================================================

/**
 * ساخت AgentContext
 */
export function createAgentContext(params: {
    message: Message;
    conversation: Conversation;
    memory: MemorySnapshot;
    contextWindow: ContextWindow;
    metadata?: Record<string, unknown>;
}): AgentContext {
    return {
        message: params.message,
        conversation: params.conversation,
        memory: params.memory,
        contextWindow: params.contextWindow,
        channelId: params.message.channel.id,
        userId: params.message.author.id,
        guildId: params.message.channel.guildId,
        isVoice: params.message.isVoice(),
        metadata: params.metadata,
    };
}

/**
 * ساخت AgentResponse خالی
 */
export function createEmptyResponse(
    agentType: AgentType,
    content: string,
): AgentResponse {
    return {
        content,
        agentType,
        model: "unknown",
        provider: "unknown",
        latencyMs: 0,
        usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        },
        toolsUsed: [],
        streamed: false,
        personalityApplied: false,
        metadata: {},
    };
}

/**
 * ساخت AgentError
 */
export function createAgentError(
    type: AgentErrorType,
    agentType: AgentType,
    message: string,
    details?: Record<string, unknown>,
): AgentError {
    const recoverable: AgentErrorType[] = [
        "llm-error",
        "tool-error",
        "timeout",
    ];

    return {
        type,
        message,
        agentType,
        recoverable: recoverable.includes(type),
        details,
    };
}

/**
 * تنظیمات پیش‌فرض هر Agent
 */
export const DEFAULT_AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
    dev: {
        type: "dev",
        displayName: "🛠️ دستیار برنامه‌نویسی",
        description: "دیباگ، بررسی کد، و حل مشکلات فنی",
        systemPromptPath: "agents/dev/system.md",
        preferredModel: "heavy",
        defaultTemperature: 0.3,
        maxOutputTokens: 4096,
        toolCallingEnabled: true,
        streamingEnabled: true,
        applyPersonality: true,
        maxToolCalls: 5,
        timeout: 60_000,
    },

    gamer: {
        type: "gamer",
        displayName: "🎮 همراه گیمینگ",
        description: "مکانیک بازی‌ها، لور، استراتژی و ایده‌های گیمینگ",
        systemPromptPath: "agents/gamer/system.md",
        preferredModel: "light",
        defaultTemperature: 0.7,
        maxOutputTokens: 2048,
        toolCallingEnabled: true,
        streamingEnabled: true,
        applyPersonality: true,
        maxToolCalls: 3,
        timeout: 30_000,
    },

    companion: {
        type: "companion",
        displayName: "💚 دوست‌دختر گیمر",
        description: "گپ صمیمی، انگیزه‌بخشی، شوخی و حمایت عاطفی",
        systemPromptPath: "agents/companion/system.md",
        preferredModel: "light",
        defaultTemperature: 0.8,
        maxOutputTokens: 1024,
        toolCallingEnabled: false,
        streamingEnabled: true,
        applyPersonality: true,
        maxToolCalls: 0,
        timeout: 20_000,
    },
} as const;

/**
 * مقایسه AgentResponse‌ها (برای debugging)
 */
export function compareResponses(
    a: AgentResponse,
    b: AgentResponse,
): {
    fasterAgent: AgentType;
    latencyDiff: number;
    tokenDiff: number;
    longerResponse: AgentType;
} {
    return {
        fasterAgent: a.latencyMs < b.latencyMs ? a.agentType : b.agentType,
        latencyDiff: Math.abs(a.latencyMs - b.latencyMs),
        tokenDiff: Math.abs(a.usage.totalTokens - b.usage.totalTokens),
        longerResponse: a.content.length > b.content.length ? a.agentType : b.agentType,
    };
}