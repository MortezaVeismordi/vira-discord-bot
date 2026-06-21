// src/infrastructure/llm/providers/OllamaClient.ts

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
    LLMMessage,
} from "@/core/contracts/ILLMPort";
import { createLLMError } from "@/core/contracts/ILLMPort";

// ============================================================
// 📐 TYPES - Ollama API
// ============================================================

/**
 * تنظیمات Ollama
 */
export interface OllamaConfig extends BaseLLMConfig {
    readonly host: string;
    readonly keepAlive?: string;
}

/**
 * ساختار درخواست Ollama /api/chat
 */
interface OllamaChatRequest {
    model: string;
    messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
    }>;
    stream: boolean;
    options?: {
        temperature?: number;
        top_p?: number;
        top_k?: number;
        num_predict?: number;
        stop?: string[];
        frequency_penalty?: number;
        presence_penalty?: number;
    };
    format?: "json";
    keep_alive?: string;
}

/**
 * ساختار پاسخ Ollama /api/chat (non-streaming)
 */
interface OllamaChatResponse {
    model: string;
    message: {
        role: string;
        content: string;
    };
    done: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

/**
 * ساختار هر chunk استریم Ollama
 */
interface OllamaStreamChunk {
    model: string;
    message: {
        role: string;
        content: string;
    };
    done: boolean;
    total_duration?: number;
    prompt_eval_count?: number;
    eval_count?: number;
}

/**
 * ساختار پاسخ /api/tags
 */
interface OllamaTagsResponse {
    models: Array<{
        name: string;
        size: number;
        digest: string;
        modified_at: string;
        details?: {
            format: string;
            family: string;
            parameter_size: string;
            quantization_level: string;
        };
    }>;
}

// ============================================================
// 🦙 OLLAMA CLIENT
// ============================================================

/**
 * Ollama LLM Client
 *
 * ارتباط با Ollama API لوکال
 *
 * ```
 * OllamaClient → http://localhost:11434/api/chat
 *                                       /api/tags
 *                                       /api/show
 * ```
 *
 * @example
 * ```typescript
 * const ollama = new OllamaClient({
 *   host: "http://localhost:11434",
 *   provider: "ollama",
 *   defaultModel: "llama3.1:8b",
 *   maxTokens: 2048,
 *   temperature: 0.7,
 *   timeout: 30000,
 *   keepAlive: "5m",
 * });
 *
 * const response = await ollama.generate({
 *   messages: [
 *     { role: "system", content: "تو ویرا هستی" },
 *     { role: "user", content: "سلام!" },
 *   ],
 * });
 *
 * console.log(response.content);
 * ```
 */
export class OllamaClient extends BaseLLMClient {
    private readonly host: string;
    private readonly keepAlive: string;

    constructor(config: OllamaConfig) {
        super(config);
        this.host = config.host.replace(/\/+$/, ""); // حذف / آخر
        this.keepAlive = config.keepAlive ?? "5m";
    }

    // ============================================================
    // 🔧 CORE IMPLEMENTATIONS
    // ============================================================

    protected async doGenerate(request: LLMRequest): Promise<LLMResponse> {
        const startTime = Date.now();
        const model = request.model ?? this.config.defaultModel;
        const ollamaRequest = this.buildOllamaRequest(request, false);

        const response = await this.fetchOllama<OllamaChatResponse>(
            "/api/chat",
            ollamaRequest,
        );

        const content = response.message?.content ?? "";

        // محاسبه usage
        const usage: LLMTokenUsage = {
            promptTokens: response.prompt_eval_count ?? this.estimateMessagesTokens(request.messages),
            completionTokens: response.eval_count ?? this.estimateTokens(content),
            totalTokens: (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
        };

        // محاسبه timing
        const totalMs = Date.now() - startTime;
        const timing: LLMTiming = {
            totalMs,
            tokensPerSecond: usage.completionTokens > 0
                ? Math.round((usage.completionTokens / totalMs) * 1000)
                : 0,
        };

        return {
            content,
            model,
            provider: "ollama",
            finishReason: response.done ? "stop" : "length",
            usage,
            timing,
        };
    }

    protected async doStream(
        request: LLMRequest,
        callbacks: LLMStreamCallbacks,
    ): Promise<LLMStreamController> {
        const startTime = Date.now();
        const model = request.model ?? this.config.defaultModel;
        const ollamaRequest = this.buildOllamaRequest(request, true);

        let aborted = false;
        let abortController: AbortController | null = new AbortController();
        let accumulated = "";
        let firstTokenTime: number | null = null;

        const completed = new Promise<LLMResponse>(async (resolve, reject) => {
            try {
                const response = await fetch(`${this.host}/api/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(ollamaRequest),
                    signal: abortController!.signal,
                });

                if (!response.ok) {
                    throw new Error(
                        `Ollama API error: ${response.status} ${response.statusText}`,
                    );
                }

                if (!response.body) {
                    throw new Error("Ollama response has no body");
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let finalChunk: OllamaStreamChunk | null = null;

                while (!aborted) {
                    const { value, done: streamDone } = await reader.read();

                    if (streamDone) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Ollama NDJSON: هر خط یک JSON
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        let chunk: OllamaStreamChunk;
                        try {
                            chunk = JSON.parse(trimmed);
                        } catch {
                            continue;
                        }

                        if (aborted) break;

                        const content = chunk.message?.content ?? "";
                        accumulated += content;

                        // اولین توکن
                        if (!firstTokenTime && content.length > 0) {
                            firstTokenTime = Date.now();
                        }

                        const streamChunk: LLMStreamChunk = {
                            content,
                            done: chunk.done,
                            usage: chunk.done
                                ? {
                                    promptTokens: chunk.prompt_eval_count ?? 0,
                                    completionTokens: chunk.eval_count ?? 0,
                                    totalTokens:
                                        (chunk.prompt_eval_count ?? 0) +
                                        (chunk.eval_count ?? 0),
                                }
                                : undefined,
                            finishReason: chunk.done ? "stop" : undefined,
                        };

                        callbacks.onChunk(streamChunk);

                        if (chunk.done) {
                            finalChunk = chunk;
                        }
                    }
                }

                // ساخت response نهایی
                const totalMs = Date.now() - startTime;
                const promptTokens = finalChunk?.prompt_eval_count
                    ?? this.estimateMessagesTokens(request.messages);
                const completionTokens = finalChunk?.eval_count
                    ?? this.estimateTokens(accumulated);

                const finalResponse: LLMResponse = {
                    content: accumulated,
                    model,
                    provider: "ollama",
                    finishReason: aborted ? "stop" : "stop",
                    usage: {
                        promptTokens,
                        completionTokens,
                        totalTokens: promptTokens + completionTokens,
                    },
                    timing: {
                        totalMs,
                        firstTokenMs: firstTokenTime
                            ? firstTokenTime - startTime
                            : undefined,
                        tokensPerSecond: completionTokens > 0
                            ? Math.round((completionTokens / totalMs) * 1000)
                            : 0,
                    },
                };

                callbacks.onComplete?.(finalResponse);
                resolve(finalResponse);
            } catch (error: any) {
                if (error.name === "AbortError") {
                    // Abort شده → خطا نیست
                    const partialResponse: LLMResponse = {
                        content: accumulated,
                        model,
                        provider: "ollama",
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
            const response = await fetch(`${this.host}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) {
                return {
                    provider: "ollama",
                    isAvailable: false,
                    error: `HTTP ${response.status}`,
                    lastChecked: new Date(),
                };
            }
            const data = await response.json() as OllamaTagsResponse;

            // چک آیا مدل پیش‌فرض نصبه
            const hasDefaultModel = data.models.some(
                (m) => m.name === this.config.defaultModel,
            );

            return {
                provider: "ollama",
                isAvailable: true,
                latencyMs: Date.now() - startTime,
                model: hasDefaultModel
                    ? this.config.defaultModel
                    : data.models[0]?.name,
                lastChecked: new Date(),
                ...(hasDefaultModel
                    ? {}
                    : {
                        error: `Default model "${this.config.defaultModel}" not found. Available: ${data.models.map((m) => m.name).join(", ")}`,
                    }),
            };
        } catch (error: any) {
            return {
                provider: "ollama",
                isAvailable: false,
                error: error.message,
                lastChecked: new Date(),
            };
        }
    }

    protected async doListModels(): Promise<LLMModelInfo[]> {
        try {
            const response = await fetch(`${this.host}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) return [];

            const data = await response.json() as OllamaTagsResponse;

            return data.models.map((model) => ({
                id: model.name,
                name: model.name,
                provider: "ollama",
                contextLength: this.inferContextLength(model.name),
                supportsTool: false,
                supportsStreaming: true,
                supportsJsonMode: true,
            }));
        } catch {
            return [];
        }
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    /**
     * ساخت درخواست Ollama
     */
    private buildOllamaRequest(
        request: LLMRequest,
        stream: boolean,
    ): OllamaChatRequest {
        return {
            model: request.model ?? this.config.defaultModel,
            messages: request.messages.map((msg) => ({
                role: msg.role === "tool" ? "system" : msg.role,
                content: msg.content,
            })),
            stream,
            options: {
                temperature: request.params?.temperature ?? this.config.temperature,
                top_p: request.params?.topP,
                top_k: request.params?.topK,
                num_predict: request.params?.maxTokens ?? this.config.maxTokens,
                stop: request.params?.stopSequences,
                frequency_penalty: request.params?.frequencyPenalty,
                presence_penalty: request.params?.presencePenalty,
            },
            ...(request.params?.jsonMode ? { format: "json" as const } : {}),
            keep_alive: this.keepAlive,
        };
    }

    /**
     * HTTP request به Ollama
     */
    private async fetchOllama<T>(
        endpoint: string,
        body: unknown,
    ): Promise<T> {
        const url = `${this.host}${endpoint}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.config.timeout),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");

            throw createLLMError(
                response.status === 404 ? "model-not-found" : "server",
                `Ollama API error (${response.status}): ${errorText}`,
                "ollama",
                { statusCode: response.status },
            );
        }

        return response.json() as Promise<T>;
    }

    /**
     * تخمین context length از نام مدل
     */
    private inferContextLength(modelName: string): number {
        const lower = modelName.toLowerCase();

        if (lower.includes("128k")) return 131072;
        if (lower.includes("32k")) return 32768;
        if (lower.includes("16k")) return 16384;

        // مدل‌های معروف
        if (lower.includes("llama3")) return 8192;
        if (lower.includes("qwen")) return 32768;
        if (lower.includes("mistral")) return 8192;
        if (lower.includes("gemma")) return 8192;

        return 4096; // default
    }
}

// ============================================================
// 🏭 FACTORY HELPER
// ============================================================

/**
 * ساخت OllamaClient از config پروژه
 *
 * @example
 * ```typescript
 * import { llmConfig } from "@/config";
 *
 * const ollama = createOllamaClient(llmConfig);
 * ```
 */
export function createOllamaClient(config: {
    host: string;
    model: string;
    timeout: number;
    keepAlive: string;
    maxTokens?: number;
    temperature?: number;
}): OllamaClient {
    return new OllamaClient({
        provider: "ollama",
        host: config.host,
        defaultModel: config.model,
        maxTokens: config.maxTokens ?? 2048,
        temperature: config.temperature ?? 0.7,
        timeout: config.timeout,
        keepAlive: config.keepAlive,
    });
}