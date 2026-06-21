// src/infrastructure/llm/providers/OpenRouterClient.ts

import {
    BaseLLMClient,
    type BaseLLMConfig,
} from "./BaseLLMClient";
import type {
    LLMRequest,
    LLMResponse,
    LLMStreamCallbacks,
    LLMStreamController,
    LLMStreamChunk,
    LLMHealthStatus,
    LLMModelInfo,
    LLMTokenUsage,
    LLMTiming,
    LLMToolDefinition,
    LLMToolCall,
    LLMMessage,
} from "@/core/contracts/ILLMPort";
import { createLLMError } from "@/core/contracts/ILLMPort";

// ============================================================
// 📐 TYPES - OpenRouter API
// ============================================================

/**
 * تنظیمات OpenRouter
 */
export interface OpenRouterConfig extends BaseLLMConfig {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly models: {
        readonly heavy: string;
        readonly light: string;
        readonly routing: string;
    };
    readonly rateLimit?: {
        readonly requestsPerMinute: number;
        readonly tokensPerMinute: number;
    };
    readonly appName?: string;
    readonly appUrl?: string;
}

/**
 * ساختار درخواست OpenRouter (OpenAI-compatible)
 */
interface OpenRouterChatRequest {
    model: string;
    messages: Array<{
        role: "system" | "user" | "assistant" | "tool";
        content: string;
        name?: string;
        tool_call_id?: string;
    }>;
    stream: boolean;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string[];
    tools?: OpenRouterToolDef[];
    tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
    response_format?: { type: "json_object" };
}

/**
 * Tool definition برای OpenRouter
 */
interface OpenRouterToolDef {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

/**
 * ساختار پاسخ OpenRouter (non-streaming)
 */
interface OpenRouterChatResponse {
    id: string;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string | null;
            tool_calls?: Array<{
                id: string;
                type: "function";
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
        };
        finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * ساختار هر chunk استریم OpenRouter (SSE)
 */
interface OpenRouterStreamChunk {
    id: string;
    model: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: "function";
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason: "stop" | "length" | "tool_calls" | null;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * ساختار پاسخ /api/v1/models
 */
interface OpenRouterModelsResponse {
    data: Array<{
        id: string;
        name: string;
        context_length: number;
        pricing: {
            prompt: string;
            completion: string;
        };
        top_provider?: {
            max_completion_tokens?: number;
        };
        architecture?: {
            modality: string;
            tokenizer: string;
        };
    }>;
}

/**
 * Rate limit tracking
 */
interface RateLimitState {
    requestsRemaining: number;
    tokensRemaining: number;
    resetAt: Date | null;
    lastRequestAt: Date | null;
}

// ============================================================
// 🌐 OPENROUTER CLIENT
// ============================================================

/**
 * OpenRouter LLM Client
 *
 * ارتباط با OpenRouter API (OpenAI-compatible)
 *
 * ```
 * OpenRouterClient → https://openrouter.ai/api/v1/chat/completions
 *                                                 /models
 * ```
 *
 * ویژگی‌ها:
 * - OpenAI-compatible API
 * - Multi-model support (heavy/light/routing)
 * - Tool calling support
 * - SSE streaming
 * - Rate limit tracking
 * - Free model support (:free suffix)
 *
 * @example
 * ```typescript
 * const openRouter = new OpenRouterClient({
 *   apiKey: "sk-or-...",
 *   baseUrl: "https://openrouter.ai/api/v1",
 *   provider: "openrouter",
 *   defaultModel: "meta-llama/llama-3.1-8b-instruct:free",
 *   models: {
 *     heavy: "qwen/qwen-2.5-coder-32b-instruct",
 *     light: "meta-llama/llama-3.1-8b-instruct:free",
 *     routing: "meta-llama/llama-3.1-8b-instruct:free",
 *   },
 *   maxTokens: 2048,
 *   temperature: 0.7,
 *   timeout: 30000,
 * });
 *
 * // استفاده با مدل پیش‌فرض
 * const response = await openRouter.generate({
 *   messages: [{ role: "user", content: "سلام!" }],
 * });
 *
 * // استفاده با مدل سنگین (برای کدنویسی)
 * const codeResponse = await openRouter.generate({
 *   messages: [...],
 *   model: openRouter.getModel("heavy"),
 * });
 * ```
 */
export class OpenRouterClient extends BaseLLMClient {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly models: OpenRouterConfig["models"];
    private readonly appName: string;
    private readonly appUrl: string;
    private readonly rateLimit: RateLimitState;
    private readonly rateLimitConfig: {
        requestsPerMinute: number;
        tokensPerMinute: number;
    };

    constructor(config: OpenRouterConfig) {
        super(config);
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.models = config.models;
        this.appName = config.appName ?? "Vira Discord Bot";
        this.appUrl = config.appUrl ?? "https://github.com/vira-bot";

        this.rateLimitConfig = {
            requestsPerMinute: config.rateLimit?.requestsPerMinute ?? 20,
            tokensPerMinute: config.rateLimit?.tokensPerMinute ?? 100_000,
        };

        this.rateLimit = {
            requestsRemaining: this.rateLimitConfig.requestsPerMinute,
            tokensRemaining: this.rateLimitConfig.tokensPerMinute,
            resetAt: null,
            lastRequestAt: null,
        };
    }

    // ============================================================
    // 🎯 MODEL SELECTION
    // ============================================================

    /**
     * دریافت مدل بر اساس نوع
     *
     * @example
     * ```typescript
     * openRouter.getModel("heavy")   // "qwen/qwen-2.5-coder-32b-instruct"
     * openRouter.getModel("light")   // "meta-llama/llama-3.1-8b-instruct:free"
     * openRouter.getModel("routing") // "meta-llama/llama-3.1-8b-instruct:free"
     * ```
     */
    getModel(type: "heavy" | "light" | "routing"): string {
        return this.models[type];
    }

    // ============================================================
    // 🔧 CORE IMPLEMENTATIONS
    // ============================================================

    protected async doGenerate(request: LLMRequest): Promise<LLMResponse> {
        await this.checkRateLimit();

        const startTime = Date.now();
        const model = request.model ?? this.config.defaultModel;
        const openRouterRequest = this.buildRequest(request, false);

        const response = await this.fetchAPI<OpenRouterChatResponse>(
            "/chat/completions",
            openRouterRequest,
        );

        const choice = response.choices[0];
        const content = choice?.message?.content ?? "";

        // Tool calls
        const toolCalls: LLMToolCall[] = (choice?.message?.tool_calls ?? []).map(
            (tc) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: this.safeParseJSON(tc.function.arguments),
            }),
        );

        // Finish reason
        let finishReason: LLMResponse["finishReason"] = "stop";
        if (choice?.finish_reason === "length") finishReason = "length";
        if (choice?.finish_reason === "tool_calls") finishReason = "tool_calls";
        if (choice?.finish_reason === "content_filter") finishReason = "error";

        // Usage
        const usage: LLMTokenUsage = {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
            totalTokens: response.usage?.total_tokens ?? 0,
        };

        this.updateRateLimit(usage);

        // Timing
        const totalMs = Date.now() - startTime;
        const timing: LLMTiming = {
            totalMs,
            tokensPerSecond: usage.completionTokens > 0
                ? Math.round((usage.completionTokens / totalMs) * 1000)
                : 0,
        };

        return {
            content,
            model: response.model ?? model,
            provider: "openrouter",
            finishReason,
            usage,
            timing,
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
    }

    protected async doStream(
        request: LLMRequest,
        callbacks: LLMStreamCallbacks,
    ): Promise<LLMStreamController> {
        await this.checkRateLimit();

        const startTime = Date.now();
        const model = request.model ?? this.config.defaultModel;
        const openRouterRequest = this.buildRequest(request, true);

        let aborted = false;
        let abortController: AbortController | null = new AbortController();
        let accumulated = "";
        let firstTokenTime: number | null = null;

        // Tool call accumulation
        let accumulatedToolCalls: Map<number, {
            id: string;
            name: string;
            arguments: string;
        }> = new Map();

        let finalUsage: LLMTokenUsage | null = null;
        let finalFinishReason: LLMResponse["finishReason"] = "stop";

        const completed = new Promise<LLMResponse>(async (resolve, reject) => {
            try {
                const response = await fetch(`${this.baseUrl}/chat/completions`, {
                    method: "POST",
                    headers: this.buildHeaders(),
                    body: JSON.stringify(openRouterRequest),
                    signal: abortController!.signal,
                });

                if (!response.ok) {
                    const errorBody = await response.text().catch(() => "");
                    throw this.handleHTTPError(response.status, errorBody);
                }

                if (!response.body) {
                    throw new Error("OpenRouter response has no body");
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (!aborted) {
                    const { value, done: streamDone } = await reader.read();
                    if (streamDone) break;

                    buffer += decoder.decode(value, { stream: true });

                    // SSE format: "data: {...}\n\n"
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        const trimmed = line.trim();

                        // SSE comment یا خالی
                        if (!trimmed || trimmed.startsWith(":")) continue;

                        // پایان stream
                        if (trimmed === "data: [DONE]") continue;

                        // حذف prefix "data: "
                        if (!trimmed.startsWith("data: ")) continue;
                        const jsonStr = trimmed.slice(6);

                        let chunk: OpenRouterStreamChunk;
                        try {
                            chunk = JSON.parse(jsonStr);
                        } catch {
                            continue;
                        }

                        if (aborted) break;

                        const choice = chunk.choices?.[0];
                        if (!choice) continue;

                        // Content
                        const content = choice.delta?.content ?? "";
                        if (content) {
                            accumulated += content;

                            if (!firstTokenTime) {
                                firstTokenTime = Date.now();
                            }
                        }

                        // Tool calls (accumulate chunks)
                        if (choice.delta?.tool_calls) {
                            for (const tc of choice.delta.tool_calls) {
                                const existing = accumulatedToolCalls.get(tc.index);
                                if (existing) {
                                    existing.arguments += tc.function?.arguments ?? "";
                                } else {
                                    accumulatedToolCalls.set(tc.index, {
                                        id: tc.id ?? `call_${tc.index}`,
                                        name: tc.function?.name ?? "",
                                        arguments: tc.function?.arguments ?? "",
                                    });
                                }
                            }
                        }

                        // Finish reason
                        if (choice.finish_reason) {
                            finalFinishReason = (choice.finish_reason as string) === "content_filter"
                                ? "error"
                                : choice.finish_reason;
                        }

                        // Usage (معمولاً در آخرین chunk)
                        if (chunk.usage) {
                            finalUsage = {
                                promptTokens: chunk.usage.prompt_tokens,
                                completionTokens: chunk.usage.completion_tokens,
                                totalTokens: chunk.usage.total_tokens,
                            };
                        }

                        // Callback
                        const isDone = choice.finish_reason !== null;

                        const streamChunk: LLMStreamChunk = {
                            content,
                            done: isDone,
                            usage: isDone ? finalUsage ?? undefined : undefined,
                            finishReason: isDone ? finalFinishReason : undefined,
                            toolCall: choice.delta?.tool_calls?.[0]
                                ? {
                                    id: choice.delta.tool_calls[0].id,
                                    name: choice.delta.tool_calls[0].function?.name,
                                    arguments: this.safeParseJSON(
                                        choice.delta.tool_calls[0].function?.arguments ?? "{}",
                                    ),
                                }
                                : undefined,
                        };

                        callbacks.onChunk(streamChunk);
                    }
                }

                // ─── Final Response ────────────────────────────
                const totalMs = Date.now() - startTime;

                const usage = finalUsage ?? {
                    promptTokens: this.estimateMessagesTokens(request.messages),
                    completionTokens: this.estimateTokens(accumulated),
                    totalTokens: this.estimateMessagesTokens(request.messages) + this.estimateTokens(accumulated),
                };

                this.updateRateLimit(usage);

                // Parse accumulated tool calls
                const toolCalls: LLMToolCall[] = [...accumulatedToolCalls.values()].map(
                    (tc) => ({
                        id: tc.id,
                        name: tc.name,
                        arguments: this.safeParseJSON(tc.arguments),
                    }),
                );

                const finalResponse: LLMResponse = {
                    content: accumulated,
                    model: model,
                    provider: "openrouter",
                    finishReason: finalFinishReason,
                    usage,
                    timing: {
                        totalMs,
                        firstTokenMs: firstTokenTime
                            ? firstTokenTime - startTime
                            : undefined,
                        tokensPerSecond: usage.completionTokens > 0
                            ? Math.round((usage.completionTokens / totalMs) * 1000)
                            : 0,
                    },
                    ...(toolCalls.length > 0 ? { toolCalls } : {}),
                };

                callbacks.onComplete?.(finalResponse);
                resolve(finalResponse);
            } catch (error: any) {
                if (error.name === "AbortError") {
                    const partialResponse: LLMResponse = {
                        content: accumulated,
                        model,
                        provider: "openrouter",
                        finishReason: "stop",
                        usage: {
                            promptTokens: this.estimateMessagesTokens(request.messages),
                            completionTokens: this.estimateTokens(accumulated),
                            totalTokens: 0,
                        },
                        timing: { totalMs: Date.now() - startTime },
                    };
                    resolve(partialResponse);
                    return;
                }

                const llmError = this.toLLMError(error);
                callbacks.onError?.(llmError);
                reject(llmError);
            }
        });

        return {
            abort: () => {
                aborted = true;
                abortController?.abort();
                abortController = null;
            },
            get isAborted() {
                return aborted;
            },
            completed,
        };
    }

    protected async doHealthCheck(): Promise<LLMHealthStatus> {
        const startTime = Date.now();

        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: this.buildHeaders(),
                signal: AbortSignal.timeout(10_000),
            });

            if (!response.ok) {
                return {
                    provider: "openrouter",
                    isAvailable: false,
                    error: `HTTP ${response.status}`,
                    lastChecked: new Date(),
                };
            }

            const data = await response.json() as OpenRouterModelsResponse;

            // چک آیا مدل‌های ما موجودن
            const availableIds = new Set(data.data.map((m) => m.id));
            const missingModels: string[] = [];

            for (const [type, modelId] of Object.entries(this.models)) {
                if (!availableIds.has(modelId)) {
                    missingModels.push(`${type}: ${modelId}`);
                }
            }

            return {
                provider: "openrouter",
                isAvailable: true,
                latencyMs: Date.now() - startTime,
                model: this.config.defaultModel,
                lastChecked: new Date(),
                ...(missingModels.length > 0
                    ? { error: `Missing models: ${missingModels.join(", ")}` }
                    : {}),
            };
        } catch (error: any) {
            return {
                provider: "openrouter",
                isAvailable: false,
                error: error.message,
                lastChecked: new Date(),
            };
        }
    }

    protected async doListModels(): Promise<LLMModelInfo[]> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: this.buildHeaders(),
                signal: AbortSignal.timeout(10_000),
            });

            if (!response.ok) return [];

            const data = await response.json() as OpenRouterModelsResponse;

            return data.data.map((model) => ({
                id: model.id,
                name: model.name,
                provider: "openrouter",
                contextLength: model.context_length,
                supportsTool: true,
                supportsStreaming: true,
                supportsJsonMode: true,
            }));
        } catch {
            return [];
        }
    }

    // ============================================================
    // 🔒 RATE LIMITING
    // ============================================================

    /**
     * چک rate limit قبل از هر request
     */
    private async checkRateLimit(): Promise<void> {
        // ریست اگر ۱ دقیقه گذشته
        if (
            this.rateLimit.resetAt &&
            Date.now() > this.rateLimit.resetAt.getTime()
        ) {
            this.rateLimit.requestsRemaining = this.rateLimitConfig.requestsPerMinute;
            this.rateLimit.tokensRemaining = this.rateLimitConfig.tokensPerMinute;
            this.rateLimit.resetAt = null;
        }

        // چک requests
        if (this.rateLimit.requestsRemaining <= 0) {
            const waitMs = this.rateLimit.resetAt
                ? this.rateLimit.resetAt.getTime() - Date.now()
                : 60_000;

            throw createLLMError(
                "rate-limit",
                `Rate limit exceeded. Wait ${Math.ceil(waitMs / 1000)}s`,
                "openrouter",
                { retryAfterMs: Math.max(waitMs, 1000) },
            );
        }
    }

    /**
     * به‌روزرسانی rate limit بعد از هر request
     */
    private updateRateLimit(usage: LLMTokenUsage): void {
        this.rateLimit.requestsRemaining--;
        this.rateLimit.tokensRemaining -= usage.totalTokens;
        this.rateLimit.lastRequestAt = new Date();

        if (!this.rateLimit.resetAt) {
            this.rateLimit.resetAt = new Date(Date.now() + 60_000);
        }
    }

    /**
     * دریافت وضعیت rate limit
     */
    getRateLimitState(): RateLimitState {
        return { ...this.rateLimit };
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    /**
     * ساخت headers
     */
    private buildHeaders(): Record<string, string> {
        return {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
            "HTTP-Referer": this.appUrl,
            "X-Title": this.appName,
        };
    }

    /**
     * ساخت درخواست OpenRouter
     */
    private buildRequest(
        request: LLMRequest,
        stream: boolean,
    ): OpenRouterChatRequest {
        const result: OpenRouterChatRequest = {
            model: request.model ?? this.config.defaultModel,
            messages: request.messages.map((msg) => ({
                role: msg.role,
                content: msg.content,
                ...(msg.name ? { name: msg.name } : {}),
            })),
            stream,
            max_tokens: request.params?.maxTokens ?? this.config.maxTokens,
            temperature: request.params?.temperature ?? this.config.temperature,
        };

        // Optional params
        if (request.params?.topP !== undefined) result.top_p = request.params.topP;
        if (request.params?.topK !== undefined) result.top_k = request.params.topK;
        if (request.params?.frequencyPenalty !== undefined) {
            result.frequency_penalty = request.params.frequencyPenalty;
        }
        if (request.params?.presencePenalty !== undefined) {
            result.presence_penalty = request.params.presencePenalty;
        }
        if (request.params?.stopSequences) {
            result.stop = request.params.stopSequences;
        }

        // JSON mode
        if (request.params?.jsonMode) {
            result.response_format = { type: "json_object" };
        }

        // Tools
        if (request.tools && request.tools.length > 0) {
            result.tools = request.tools.map((tool) => ({
                type: "function" as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters as unknown as Record<string, unknown>,
                },
            }));
            result.tool_choice = "auto";
        }

        return result;
    }

    /**
     * HTTP request به OpenRouter
     */
    private async fetchAPI<T>(
        endpoint: string,
        body: unknown,
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;

        const response = await fetch(url, {
            method: "POST",
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.config.timeout),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw this.handleHTTPError(response.status, errorBody);
        }

        return response.json() as Promise<T>;
    }

    /**
     * مدیریت خطاهای HTTP
     */
    private handleHTTPError(status: number, body: string): Error {
        // Parse error body
        let errorMessage = body;
        try {
            const parsed = JSON.parse(body);
            errorMessage = parsed.error?.message ?? parsed.message ?? body;
        } catch { }

        switch (status) {
            case 401:
                return new Error(createLLMError(
                    "auth",
                    `Authentication failed: ${errorMessage}`,
                    "openrouter",
                    { statusCode: 401 },
                ).message);

            case 402:
                return new Error(createLLMError(
                    "auth",
                    `Insufficient credits: ${errorMessage}`,
                    "openrouter",
                    { statusCode: 402 },
                ).message);

            case 404:
                return new Error(createLLMError(
                    "model-not-found",
                    `Model not found: ${errorMessage}`,
                    "openrouter",
                    { statusCode: 404 },
                ).message);

            case 429:
                // Parse retry-after
                let retryAfterMs = 60_000;
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.error?.metadata?.retry_after) {
                        retryAfterMs = parsed.error.metadata.retry_after * 1000;
                    }
                } catch { }

                return new Error(createLLMError(
                    "rate-limit",
                    `Rate limited: ${errorMessage}`,
                    "openrouter",
                    { statusCode: 429, retryAfterMs },
                ).message);

            case 413:
                return new Error(createLLMError(
                    "context-length",
                    `Context too long: ${errorMessage}`,
                    "openrouter",
                    { statusCode: 413 },
                ).message);

            case 500:
            case 502:
            case 503: {
                const llmErr = createLLMError(
                    "server",
                    `Server error (${status}): ${errorMessage}`,
                    "openrouter",
                    { statusCode: status },
                );
                return Object.assign(new Error(llmErr.message), llmErr);
            }

            default: {
                const llmErr = createLLMError(
                    "unknown",
                    `HTTP ${status}: ${errorMessage}`,
                    "openrouter",
                    { statusCode: status },
                );
                return Object.assign(new Error(llmErr.message), llmErr);
            }
        }
    }

    /**
     * Parse JSON امن
     */
    private safeParseJSON(str: string): Record<string, unknown> {
        try {
            return JSON.parse(str);
        } catch {
            return { raw: str };
        }
    }
}

// ============================================================
// 🏭 FACTORY
// ============================================================

/**
 * ساخت OpenRouterClient از config پروژه
 *
 * @example
 * ```typescript
 * import { llmConfig } from "@/config";
 *
 * const openRouter = createOpenRouterClient({
 *   apiKey: llmConfig.openRouter.apiKey!,
 *   baseUrl: llmConfig.openRouter.baseUrl,
 *   models: llmConfig.openRouter.models,
 *   maxTokens: llmConfig.generation.maxTokens,
 *   temperature: llmConfig.generation.temperature,
 * });
 *
 * // مدل سنگین برای کدنویسی
 * const response = await openRouter.generate({
 *   messages: [...],
 *   model: openRouter.getModel("heavy"),
 * });
 *
 * // مدل سبک برای مکالمه
 * const response = await openRouter.generate({
 *   messages: [...],
 *   model: openRouter.getModel("light"),
 * });
 * ```
 */
export function createOpenRouterClient(config: {
    apiKey: string;
    baseUrl: string;
    models: {
        heavy: string;
        light: string;
        routing: string;
    };
    timeout?: number;
    maxTokens?: number;
    temperature?: number;
    rateLimit?: {
        requestsPerMinute: number;
        tokensPerMinute: number;
    };
}): OpenRouterClient {
    return new OpenRouterClient({
        provider: "openrouter",
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.models.light,
        models: config.models,
        maxTokens: config.maxTokens ?? 2048,
        temperature: config.temperature ?? 0.7,
        timeout: config.timeout ?? 30_000,
        rateLimit: config.rateLimit,
    });
}