// src/infrastructure/llm/providers/BaseLLMClient.ts

import type {
    ILLMPort,
    LLMRequest,
    LLMResponse,
    LLMStreamCallbacks,
    LLMStreamController,
    LLMStreamChunk,
    LLMHealthStatus,
    LLMModelInfo,
    LLMTokenUsage,
    LLMTiming,
    LLMError,
    LLMRetryConfig,
    LLMMessage,
} from "@/core/contracts/ILLMPort";
import {
    createLLMError,
    isRetryableError,
    DEFAULT_RETRY_CONFIG,
} from "@/core/contracts/ILLMPort";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * تنظیمات پایه هر LLM Client
 */
export interface BaseLLMConfig {
    readonly provider: string;
    readonly defaultModel: string;
    readonly maxTokens: number;
    readonly temperature: number;
    readonly timeout: number;
    readonly retryConfig?: LLMRetryConfig;
}

/**
 * آمار داخلی client
 */
export interface ClientStats {
    totalRequests: number;
    successCount: number;
    errorCount: number;
    totalTokensUsed: number;
    totalLatencyMs: number;
    lastRequestAt: Date | null;
    lastError: LLMError | null;
}

// ============================================================
// 🏗️ BASE LLM CLIENT
// ============================================================

/**
 * کلاس پایه برای تمام LLM Clientها
 *
 * وظایف مشترک:
 * - Retry logic
 * - Error handling
 * - Metrics tracking
 * - Sentence detection (برای TTS)
 * - Token estimation
 *
 * @example
 * ```typescript
 * class OllamaClient extends BaseLLMClient {
 *   protected async doGenerate(request: LLMRequest): Promise<LLMResponse> {
 *     // پیاده‌سازی واقعی Ollama
 *   }
 *
 *   protected async doStream(request: LLMRequest, callbacks: ...): Promise<...> {
 *     // پیاده‌سازی واقعی streaming
 *   }
 * }
 * ```
 */
export abstract class BaseLLMClient implements ILLMPort {
    protected readonly config: BaseLLMConfig;
    protected readonly retryConfig: LLMRetryConfig;
    protected readonly stats: ClientStats;

    constructor(config: BaseLLMConfig) {
        this.config = config;
        this.retryConfig = config.retryConfig ?? DEFAULT_RETRY_CONFIG;
        this.stats = {
            totalRequests: 0,
            successCount: 0,
            errorCount: 0,
            totalTokensUsed: 0,
            totalLatencyMs: 0,
            lastRequestAt: null,
            lastError: null,
        };
    }

    // ============================================================
    // 🔧 ABSTRACT METHODS (باید پیاده‌سازی بشه)
    // ============================================================

    /**
     * تولید پاسخ (پیاده‌سازی واقعی)
     */
    protected abstract doGenerate(request: LLMRequest): Promise<LLMResponse>;

    /**
     * استریم پاسخ (پیاده‌سازی واقعی)
     */
    protected abstract doStream(
        request: LLMRequest,
        callbacks: LLMStreamCallbacks,
    ): Promise<LLMStreamController>;

    /**
     * بررسی سلامت (پیاده‌سازی واقعی)
     */
    protected abstract doHealthCheck(): Promise<LLMHealthStatus>;

    /**
     * لیست مدل‌ها (پیاده‌سازی واقعی)
     */
    protected abstract doListModels(): Promise<LLMModelInfo[]>;

    // ============================================================
    // 🎯 PUBLIC METHODS (ILLMPort)
    // ============================================================

    async generate(request: LLMRequest): Promise<LLMResponse> {
        const startTime = Date.now();

        this.stats.totalRequests++;
        this.stats.lastRequestAt = new Date();

        const enrichedRequest = this.enrichRequest(request);

        try {
            const response = await this.withRetry(
                () => this.doGenerate(enrichedRequest),
                `generate:${enrichedRequest.model ?? this.config.defaultModel}`,
            );

            this.trackSuccess(response, startTime);

            return response;
        } catch (error: any) {
            const llmError = this.toLLMError(error);
            this.trackError(llmError);
            throw llmError;
        }
    }

    async stream(
        request: LLMRequest,
        callbacks: LLMStreamCallbacks,
    ): Promise<LLMStreamController> {
        const startTime = Date.now();

        this.stats.totalRequests++;
        this.stats.lastRequestAt = new Date();

        const enrichedRequest = this.enrichRequest({
            ...request,
            stream: true,
        });

        // Sentence detection wrapper
        const wrappedCallbacks = this.wrapCallbacksWithSentenceDetection(
            callbacks,
        );

        try {
            const controller = await this.doStream(enrichedRequest, wrappedCallbacks);

            // وقتی استریم تمام شد، metrics ثبت کن
            controller.completed
                .then((response) => this.trackSuccess(response, startTime))
                .catch((error) => this.trackError(this.toLLMError(error)));

            return controller;
        } catch (error: any) {
            const llmError = this.toLLMError(error);
            this.trackError(llmError);
            throw llmError;
        }
    }

    async healthCheck(): Promise<LLMHealthStatus> {
        try {
            return await this.doHealthCheck();
        } catch (error: any) {
            return {
                provider: this.config.provider,
                isAvailable: false,
                error: error.message,
                lastChecked: new Date(),
            };
        }
    }

    async listModels(): Promise<LLMModelInfo[]> {
        return this.doListModels();
    }

    getCurrentModel(): LLMModelInfo {
        return {
            id: this.config.defaultModel,
            name: this.config.defaultModel,
            provider: this.config.provider,
            contextLength: 8192,
            supportsTool: false,
            supportsStreaming: true,
            supportsJsonMode: false,
        };
    }

    getProvider(): string {
        return this.config.provider;
    }

    async isAvailable(): Promise<boolean> {
        const health = await this.healthCheck();
        return health.isAvailable;
    }

    // ============================================================
    // 🔄 RETRY LOGIC
    // ============================================================

    /**
     * اجرا با retry
     */
    protected async withRetry<T>(
        fn: () => Promise<T>,
        context: string,
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                return await this.withTimeout(
                    fn(),
                    this.config.timeout,
                    `${context} timed out after ${this.config.timeout}ms`,
                );
            } catch (error: any) {
                lastError = error;

                const llmError = this.toLLMError(error);

                // اگر retryable نیست، فوری throw کن
                if (!isRetryableError(llmError)) {
                    throw error;
                }

                // آخرین attempt بود
                if (attempt === this.retryConfig.maxRetries) {
                    break;
                }

                // محاسبه delay
                const delay = this.retryConfig.exponentialBackoff
                    ? this.retryConfig.retryDelayMs * Math.pow(2, attempt)
                    : this.retryConfig.retryDelayMs;

                // Rate limit: delay خاص
                const actualDelay = llmError.retryAfterMs ?? delay;

                console.warn(
                    `[${this.config.provider}] Retry ${attempt + 1}/${this.retryConfig.maxRetries} ` +
                    `for ${context} after ${actualDelay}ms (${llmError.type})`,
                );

                await this.sleep(actualDelay);
            }
        }

        throw lastError;
    }

    // ============================================================
    // 🎤 SENTENCE DETECTION (برای TTS)
    // ============================================================

    /**
     * Wrap callbacks با sentence detection
     *
     * وقتی به . ! ? ، ؟ رسید، onSentence صدا زده می‌شه
     */
    protected wrapCallbacksWithSentenceDetection(
        callbacks: LLMStreamCallbacks,
    ): LLMStreamCallbacks {
        if (!callbacks.onSentence) return callbacks;

        let buffer = "";
        let sentenceIndex = 0;
        const sentenceBreakers = /[.!?،؟\n]/;
        const minSentenceLength = 15;

        return {
            ...callbacks,

            onChunk: (chunk: LLMStreamChunk) => {
                // اول callback اصلی
                callbacks.onChunk(chunk);

                if (chunk.done) {
                    // آخرین chunk: flush بافر
                    if (buffer.trim().length > 0 && callbacks.onSentence) {
                        callbacks.onSentence(buffer.trim(), sentenceIndex);
                    }
                    return;
                }

                // اضافه به بافر
                buffer += chunk.content;

                // چک sentence break
                const lastChar = chunk.content.trim().slice(-1);

                if (
                    sentenceBreakers.test(lastChar) &&
                    buffer.trim().length >= minSentenceLength
                ) {
                    if (callbacks.onSentence) {
                        callbacks.onSentence(buffer.trim(), sentenceIndex);
                        sentenceIndex++;
                        buffer = "";
                    }
                }
            },

            onComplete: callbacks.onComplete,
            onError: callbacks.onError,
        };
    }

    // ============================================================
    // 🛠️ HELPERS
    // ============================================================

    /**
     * افزودن defaults به request
     */
    protected enrichRequest(request: LLMRequest): LLMRequest {
        return {
            ...request,
            model: request.model ?? this.config.defaultModel,
            params: {
                maxTokens: this.config.maxTokens,
                temperature: this.config.temperature,
                ...request.params,
            },
        };
    }

    /**
     * تبدیل خطا به LLMError
     */
    protected toLLMError(error: any): LLMError {
        if (error && typeof error === "object" && "type" in error && "provider" in error) {
            return error as LLMError;
        }

        const message = error?.message ?? String(error);

        // تشخیص نوع خطا از پیام
        if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
            return createLLMError("connection", message, this.config.provider);
        }

        if (message.includes("timed out") || message.includes("timeout")) {
            return createLLMError("timeout", message, this.config.provider);
        }

        if (message.includes("rate limit") || message.includes("429")) {
            return createLLMError("rate-limit", message, this.config.provider, {
                statusCode: 429,
                retryAfterMs: 60_000,
            });
        }

        if (message.includes("401") || message.includes("unauthorized")) {
            return createLLMError("auth", message, this.config.provider, {
                statusCode: 401,
            });
        }

        if (message.includes("model") && message.includes("not found")) {
            return createLLMError("model-not-found", message, this.config.provider);
        }

        if (message.includes("context length") || message.includes("too long")) {
            return createLLMError("context-length", message, this.config.provider);
        }

        return createLLMError("unknown", message, this.config.provider);
    }

    /**
     * Promise با timeout
     */
    protected withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        message: string,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(message));
            }, timeoutMs);

            promise
                .then((result) => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * تخمین تعداد توکن
     */
    protected estimateTokens(text: string): number {
        if (!text) return 0;
        const persianChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
        const otherChars = text.length - persianChars;
        return Math.ceil(persianChars / 2 + otherChars / 4);
    }

    /**
     * تخمین توکن messages
     */
    protected estimateMessagesTokens(messages: LLMMessage[]): number {
        let total = 0;
        for (const msg of messages) {
            total += this.estimateTokens(msg.content);
            total += 4; // overhead هر پیام
        }
        return total;
    }

    protected sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // ============================================================
    // 📊 TRACKING
    // ============================================================

    protected trackSuccess(response: LLMResponse, startTime: number): void {
        this.stats.successCount++;
        this.stats.totalTokensUsed += response.usage.totalTokens;
        this.stats.totalLatencyMs += Date.now() - startTime;
    }

    protected trackError(error: LLMError): void {
        this.stats.errorCount++;
        this.stats.lastError = error;
    }

    /**
     * دریافت آمار client
     */
    getStats(): ClientStats {
        return { ...this.stats };
    }
}