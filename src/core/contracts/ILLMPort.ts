// src/core/contracts/ILLMPort.ts

import type { AgentType } from "../domain/types/AgentType";

// ============================================================
// 📐 TYPES - ورودی‌ها
// ============================================================

/**
 * یک پیام در فرمت LLM
 */
export interface LLMMessage {
    readonly role: "system" | "user" | "assistant" | "tool";
    readonly content: string;
    readonly name?: string;           // برای tool messages
}

/**
 * پارامترهای تولید متن
 */
export interface GenerationParams {
    /** حداکثر توکن خروجی */
    readonly maxTokens?: number;

    /** دمای تولید (0 = قطعی، 2 = خلاقانه) */
    readonly temperature?: number;

    /** Top-p sampling */
    readonly topP?: number;

    /** Top-k sampling */
    readonly topK?: number;

    /** تکرار penalty */
    readonly frequencyPenalty?: number;

    /** حضور penalty */
    readonly presencePenalty?: number;

    /** توکن‌های stop */
    readonly stopSequences?: string[];

    /** JSON mode فعال باشه؟ */
    readonly jsonMode?: boolean;
}

/**
 * درخواست کامل به LLM
 */
export interface LLMRequest {
    /** لیست پیام‌ها */
    readonly messages: LLMMessage[];

    /** مدل مورد نظر (اختیاری - از config می‌خونه) */
    readonly model?: string;

    /** پارامترهای تولید */
    readonly params?: GenerationParams;

    /** استریم فعال باشه؟ */
    readonly stream?: boolean;

    /** تعریف ابزارها برای tool calling */
    readonly tools?: LLMToolDefinition[];

    /** metadata برای tracking */
    readonly metadata?: LLMRequestMetadata;
}

/**
 * متادیتای درخواست (برای observability)
 */
export interface LLMRequestMetadata {
    /** کدوم Agent درخواست داده */
    readonly agentType?: AgentType;

    /** شناسه مکالمه */
    readonly conversationId?: string;

    /** شناسه کانال */
    readonly channelId?: string;

    /** شناسه کاربر */
    readonly userId?: string;

    /** هدف درخواست */
    readonly purpose?: "chat" | "routing" | "summarization" | "extraction" | "tool-call";

    /** اولویت (برای queue management) */
    readonly priority?: "high" | "normal" | "low";
}

// ============================================================
// 📐 TYPES - خروجی‌ها
// ============================================================

/**
 * پاسخ کامل LLM
 */
export interface LLMResponse {
    /** متن پاسخ */
    readonly content: string;

    /** مدل استفاده شده */
    readonly model: string;

    /** پروایدر */
    readonly provider: string;

    /** آیا به دلیل محدودیت توکن متوقف شد؟ */
    readonly finishReason: "stop" | "length" | "tool_calls" | "error";

    /** مصرف توکن */
    readonly usage: LLMTokenUsage;

    /** زمان پردازش */
    readonly timing: LLMTiming;

    /** فراخوانی ابزارها (اگر بود) */
    readonly toolCalls?: LLMToolCall[];
}

/**
 * مصرف توکن
 */
export interface LLMTokenUsage {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
}

/**
 * زمان‌بندی پردازش
 */
export interface LLMTiming {
    /** زمان کل (ms) */
    readonly totalMs: number;

    /** زمان تا اولین توکن (ms) */
    readonly firstTokenMs?: number;

    /** توکن بر ثانیه */
    readonly tokensPerSecond?: number;
}

// ============================================================
// 📐 TYPES - استریمینگ
// ============================================================

/**
 * یک chunk از استریم
 */
export interface LLMStreamChunk {
    /** محتوای این chunk */
    readonly content: string;

    /** آیا آخرین chunk هست؟ */
    readonly done: boolean;

    /** اگر done=true، اطلاعات نهایی */
    readonly usage?: LLMTokenUsage;

    /** اگر done=true، دلیل پایان */
    readonly finishReason?: "stop" | "length" | "tool_calls" | "error";

    /** فراخوانی ابزار (ممکنه chunk به chunk بیاد) */
    readonly toolCall?: Partial<LLMToolCall>;
}

/**
 * Callback‌های استریم
 */
export interface LLMStreamCallbacks {
    /** هر chunk جدید */
    onChunk: (chunk: LLMStreamChunk) => void;

    /** وقتی به جمله‌بند (. ! ?) رسید - مفید برای TTS */
    onSentence?: (sentence: string, index?: number) => void;

    /** وقتی استریم تمام شد */
    onComplete?: (response: LLMResponse) => void;

    /** وقتی خطا رخ داد */
    onError?: (error: LLMError) => void;
}

/**
 * کنترلر استریم (برای cancel کردن)
 */
export interface LLMStreamController {
    /** لغو استریم */
    abort: () => void;

    /** آیا لغو شده؟ */
    readonly isAborted: boolean;

    /** Promise نهایی */
    readonly completed: Promise<LLMResponse>;
}

// ============================================================
// 📐 TYPES - Tool Calling
// ============================================================

/**
 * تعریف یک ابزار برای LLM
 */
export interface LLMToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly parameters: LLMToolParameters;
}

/**
 * پارامترهای ابزار (JSON Schema)
 */
export interface LLMToolParameters {
    readonly type: "object";
    readonly properties: Record<string, {
        readonly type: string;
        readonly description: string;
        readonly enum?: string[];
    }>;
    readonly required?: string[];
}

/**
 * فراخوانی ابزار توسط LLM
 */
export interface LLMToolCall {
    readonly id: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
}

// ============================================================
// 📐 TYPES - خطاها
// ============================================================

/**
 * انواع خطاهای LLM
 */
export type LLMErrorType =
    | "connection"       // نتونست وصل بشه
    | "timeout"          // زمان تمام شد
    | "rate-limit"       // محدودیت نرخ
    | "auth"             // مشکل احراز هویت
    | "model-not-found"  // مدل پیدا نشد
    | "context-length"   // context بیش از حد بزرگ
    | "content-filter"   // فیلتر محتوا
    | "server"           // خطای سرور
    | "unknown";         // نامشخص

/**
 * خطای LLM
 */
export interface LLMError {
    readonly type: LLMErrorType;
    readonly message: string;
    readonly provider: string;
    readonly model?: string;
    readonly statusCode?: number;
    readonly retryable: boolean;
    readonly retryAfterMs?: number;
}

// ============================================================
// 📐 TYPES - سلامت و وضعیت
// ============================================================

/**
 * وضعیت سلامت یک پروایدر
 */
export interface LLMHealthStatus {
    readonly provider: string;
    readonly isAvailable: boolean;
    readonly latencyMs?: number;
    readonly model?: string;
    readonly error?: string;
    readonly lastChecked: Date;
}

/**
 * اطلاعات یک مدل
 */
export interface LLMModelInfo {
    readonly id: string;
    readonly name: string;
    readonly provider: string;
    readonly contextLength: number;
    readonly supportsTool: boolean;
    readonly supportsStreaming: boolean;
    readonly supportsJsonMode: boolean;
}

// ============================================================
// 🔌 MAIN INTERFACE - ILLMPort
// ============================================================

/**
 * پورت اصلی ارتباط با LLM
 *
 * این Interface تنها راه ارتباط Core با دنیای LLM است.
 * هیچ بخشی از Core نباید مستقیماً با Ollama یا OpenRouter صحبت کند.
 *
 * ```
 * Core Layer
 *    │
 *    ├── AgentOrchestrator
 *    ├── DevAgent
 *    ├── GamerAgent
 *    ├── CompanionAgent
 *    ├── AgentRouter (LLM routing)
 *    └── ContextSummarizer
 *         │
 *         ▼
 *    ┌─────────────┐
 *    │  ILLMPort   │  ← Contract
 *    └──────┬──────┘
 *           │
 *    ┌──────▼──────┐
 *    │ LLMFactory  │  ← Infrastructure
 *    ├─────────────┤
 *    │ OllamaClient│
 *    │ OpenRouter  │
 *    └─────────────┘
 * ```
 *
 * @example
 * ```typescript
 * class DevAgent {
 *   constructor(private llm: ILLMPort) {}
 *
 *   async process(message: Message): Promise<string> {
 *     const response = await this.llm.generate({
 *       messages: [...context, message.toLLMFormat()],
 *       params: { temperature: 0.3 },
 *       metadata: { agentType: "dev", purpose: "chat" },
 *     });
 *
 *     return response.content;
 *   }
 * }
 * ```
 */
export interface ILLMPort {
    // ─── Core Methods ─────────────────────────────────────

    /**
     * تولید پاسخ (Non-streaming)
     *
     * برای زمانی که کل پاسخ یکجا لازمه:
     * - روتینگ
     * - خلاصه‌سازی
     * - استخراج اطلاعات
     *
     * @example
     * ```typescript
     * const response = await llm.generate({
     *   messages: [
     *     { role: "system", content: "تو یک دستیار هستی" },
     *     { role: "user", content: "سلام" },
     *   ],
     * });
     * console.log(response.content);
     * ```
     */
    generate(request: LLMRequest): Promise<LLMResponse>;

    /**
     * تولید پاسخ با استریم
     *
     * برای زمانی که باید chunk به chunk پاسخ برسه:
     * - چت معمولی (تایپ کردن تدریجی)
     * - ویس‌چت (TTS chunk به chunk)
     *
     * @example
     * ```typescript
     * const controller = await llm.stream(
     *   {
     *     messages: [...],
     *     stream: true,
     *   },
     *   {
     *     onChunk: (chunk) => {
     *       process.stdout.write(chunk.content);
     *     },
     *     onSentence: (sentence) => {
     *       tts.speak(sentence);  // ارسال به TTS
     *     },
     *     onComplete: (response) => {
     *       console.log(`\nDone! ${response.usage.totalTokens} tokens`);
     *     },
     *   },
     * );
     *
     * // اگر کاربر interrupt کرد:
     * controller.abort();
     * ```
     */
    stream(
        request: LLMRequest,
        callbacks: LLMStreamCallbacks,
    ): Promise<LLMStreamController>;

    // ─── Health & Status ──────────────────────────────────

    /**
     * بررسی سلامت پروایدر
     *
     * @example
     * ```typescript
     * const health = await llm.healthCheck();
     * if (!health.isAvailable) {
     *   // سوئیچ به fallback
     * }
     * ```
     */
    healthCheck(): Promise<LLMHealthStatus>;

    /**
     * لیست مدل‌های موجود
     */
    listModels(): Promise<LLMModelInfo[]>;

    /**
     * اطلاعات مدل فعلی
     */
    getCurrentModel(): LLMModelInfo;

    // ─── Provider Management ──────────────────────────────

    /**
     * نام پروایدر فعلی
     */
    getProvider(): string;

    /**
     * آیا پروایدر در دسترس است؟
     */
    isAvailable(): Promise<boolean>;
}

// ============================================================
// 🔌 EXTENDED INTERFACE - ILLMPortWithFallback
// ============================================================

/**
 * پورت LLM با قابلیت Fallback
 *
 * وقتی پروایدر اصلی خراب بشه، خودکار به پشتیبان سوئیچ کنه.
 *
 * @example
 * ```typescript
 * const llm: ILLMPortWithFallback = new LLMFactory(config);
 *
 * // خودکار fallback می‌کنه:
 * // Ollama خراب؟ → OpenRouter
 * // OpenRouter rate limit? → Ollama
 * const response = await llm.generate(request);
 * ```
 */
export interface ILLMPortWithFallback extends ILLMPort {
    /**
     * تولید با fallback خودکار
     *
     * اول پروایدر اصلی رو امتحان می‌کنه
     * اگر خراب بود، fallback رو امتحان می‌کنه
     */
    generateWithFallback(request: LLMRequest): Promise<LLMResponse>;

    /**
     * استریم با fallback خودکار
     */
    streamWithFallback(
        request: LLMRequest,
        callbacks: LLMStreamCallbacks,
    ): Promise<LLMStreamController>;

    /**
     * سوئیچ دستی به پروایدر دیگه
     */
    switchProvider(provider: "ollama" | "openrouter"): void;

    /**
     * پروایدر فعلی
     */
    getActiveProvider(): "ollama" | "openrouter";

    /**
     * سلامت همه پروایدرها
     */
    healthCheckAll(): Promise<Record<string, LLMHealthStatus>>;
}

// ============================================================
// 🔌 SPECIALIZED INTERFACES
// ============================================================

/**
 * پورت مخصوص Routing
 *
 * یک نسخه سبک‌تر از ILLMPort فقط برای intent classification
 *
 * @example
 * ```typescript
 * class LLMRouter implements IAgentRouter {
 *   constructor(private routingLLM: ILLMRoutingPort) {}
 *
 *   async route(message: Message): Promise<AgentType> {
 *     const result = await this.routingLLM.classify(
 *       message.content,
 *       ["dev", "gamer", "companion"],
 *     );
 *     return result.label as AgentType;
 *   }
 * }
 * ```
 */
export interface ILLMRoutingPort {
    /**
     * طبقه‌بندی متن
     */
    classify(
        text: string,
        labels: string[],
        systemPrompt?: string,
    ): Promise<{
        label: string;
        confidence: number;
        reasoning?: string;
    }>;
}

/**
 * پورت مخصوص Summarization
 *
 * @example
 * ```typescript
 * class ContextSummarizer {
 *   constructor(private summarizer: ILLMSummarizationPort) {}
 *
 *   async summarize(messages: Message[]): Promise<string> {
 *     const text = messages.map(m => m.content).join("\n");
 *     return this.summarizer.summarize(text, 200);
 *   }
 * }
 * ```
 */
export interface ILLMSummarizationPort {
    /**
     * خلاصه‌سازی متن
     */
    summarize(
        text: string,
        maxLength?: number,
        systemPrompt?: string,
    ): Promise<string>;
}

/**
 * پورت مخصوص Extraction
 *
 * استخراج اطلاعات ساختاریافته از متن
 *
 * @example
 * ```typescript
 * class MemoryExtractor {
 *   constructor(private extractor: ILLMExtractionPort) {}
 *
 *   async extract(conversation: string): Promise<MemoryEntry[]> {
 *     const facts = await this.extractor.extract(conversation, {
 *       type: "object",
 *       properties: {
 *         facts: { type: "array", description: "..." },
 *         skills: { type: "array", description: "..." },
 *       },
 *     });
 *     return this.toMemoryEntries(facts);
 *   }
 * }
 * ```
 */
export interface ILLMExtractionPort {
    /**
     * استخراج اطلاعات ساختاریافته
     */
    extract<T = Record<string, unknown>>(
        text: string,
        schema: LLMToolParameters,
        systemPrompt?: string,
    ): Promise<T>;
}

// ============================================================
// 🛠️ HELPER TYPES
// ============================================================

/**
 * تنظیمات retry
 */
export interface LLMRetryConfig {
    readonly maxRetries: number;
    readonly retryDelayMs: number;
    readonly retryableErrors: LLMErrorType[];
    readonly exponentialBackoff: boolean;
}

/**
 * Default retry config
 */
export const DEFAULT_RETRY_CONFIG: LLMRetryConfig = {
    maxRetries: 3,
    retryDelayMs: 1000,
    retryableErrors: ["connection", "timeout", "rate-limit", "server"],
    exponentialBackoff: true,
} as const;

/**
 * ساخت LLMError
 */
export function createLLMError(
    type: LLMErrorType,
    message: string,
    provider: string,
    options?: {
        model?: string;
        statusCode?: number;
        retryAfterMs?: number;
    },
): LLMError {
    const retryable: LLMErrorType[] = [
        "connection",
        "timeout",
        "rate-limit",
        "server",
    ];

    return {
        type,
        message,
        provider,
        model: options?.model,
        statusCode: options?.statusCode,
        retryable: retryable.includes(type),
        retryAfterMs: options?.retryAfterMs,
    };
}

/**
 * بررسی آیا خطا retryable هست
 */
export function isRetryableError(error: LLMError): boolean {
    return error.retryable;
}

/**
 * ساخت یک request ساده
 */
export function createSimpleRequest(
    systemPrompt: string,
    userMessage: string,
    options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        metadata?: LLMRequestMetadata;
    },
): LLMRequest {
    return {
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
        ],
        model: options?.model,
        params: {
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
        },
        metadata: options?.metadata,
    };
}

/**
 * ساخت request با تاریخچه مکالمه
 */
export function createChatRequest(
    systemPrompt: string,
    history: LLMMessage[],
    currentMessage: string,
    options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        stream?: boolean;
        tools?: LLMToolDefinition[];
        metadata?: LLMRequestMetadata;
    },
): LLMRequest {
    return {
        messages: [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: currentMessage },
        ],
        model: options?.model,
        params: {
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
        },
        stream: options?.stream,
        tools: options?.tools,
        metadata: options?.metadata,
    };
}