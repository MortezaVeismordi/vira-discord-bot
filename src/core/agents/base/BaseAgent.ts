// src/core/agents/base/BaseAgent.ts

import type {
    IAgent,
    AgentConfig,
    AgentContext,
    AgentResponse,
    AgentStreamCallbacks,
    AgentStreamController,
    AgentCapabilities,
    AgentStatus,
    AgentMetrics,
    AgentError,
    AgentErrorType,
    ToolCallRecord,
} from "@/core/contracts/IAgent";
import { createAgentError } from "@/core/contracts/IAgent";
import type {
    ILLMPort,
    LLMRequest,
    LLMResponse,
    LLMStreamCallbacks,
    LLMStreamChunk,
    LLMToolDefinition,
    LLMMessage,
} from "@/core/contracts/ILLMPort";
import type { IToolRegistry, ToolResult } from "@/core/contracts/ITool";
import type { IPromptStorage } from "@/core/contracts/IStorage";
import type { IEventBus } from "@/core/contracts/IEventBus";
import type { Message } from "@/core/domain/entities/Message";
import type { AgentType } from "@/core/domain/types/AgentType";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * وابستگی‌های BaseAgent
 */
export interface AgentDependencies {
    readonly llm: ILLMPort;
    readonly toolRegistry: IToolRegistry | null;
    readonly prompts: IPromptStorage;
    readonly eventBus: IEventBus;
}

// ============================================================
// 🤖 BASE AGENT
// ============================================================

/**
 * کلاس پایه برای تمام Agentهای ویرا
 *
 * هر Agent (Dev, Gamer, Companion) از این کلاس extend می‌کنه.
 * منطق مشترک شامل:
 *   - بارگذاری و cache کردن system prompt
 *   - ساخت LLM request
 *   - مدیریت streaming + sentence detection
 *   - Tool calling loop
 *   - Error handling
 *   - Metrics tracking
 *   - Personality application
 *
 * ```
 * AgentContext
 *     │
 *     ▼
 * ┌──────────────────────────────────────────┐
 * │              BaseAgent                   │
 * │                                          │
 * │  1. getSystemPrompt()                    │
 * │  2. buildLLMRequest(context)             │
 * │  3. llm.generate() or llm.stream()      │
 * │  4. handleToolCalls() (if any)           │
 * │  5. applyPersonality()                   │
 * │  6. buildResponse()                      │
 * └──────────────────────────────────────────┘
 *     │
 *     ▼
 * AgentResponse
 * ```
 *
 * @example
 * ```typescript
 * class CompanionAgent extends BaseAgent {
 *   readonly config: AgentConfig = { ... };
 *   readonly capabilities: AgentCapabilities = { ... };
 *
 *   // فقط keyword‌ها و شخصیت خاص خودشو override می‌کنه
 *   getTriggerKeywords(): string[] {
 *     return ["سلام", "حالت", "خسته", ...];
 *   }
 *
 *   applyPersonality(response: string): string {
 *     return addEmojis(response);
 *   }
 * }
 * ```
 */
export abstract class BaseAgent implements IAgent {
    // ─── Abstract (هر Agent خودش تعریف می‌کنه) ──────────
    abstract readonly config: AgentConfig;
    abstract readonly capabilities: AgentCapabilities;

    // ─── Dependencies ────────────────────────────────────
    protected readonly llm: ILLMPort;
    protected readonly toolRegistry: IToolRegistry | null;
    protected readonly prompts: IPromptStorage;
    protected readonly eventBus: IEventBus;

    // ─── State ───────────────────────────────────────────
    private status: AgentStatus = "idle";
    private cachedSystemPrompt: string | null = null;
    private promptLastLoaded: number = 0;
    private readonly PROMPT_CACHE_TTL = 5 * 60 * 1000; // 5 دقیقه

    // ─── Metrics ─────────────────────────────────────────
    private metrics: {
        totalRequests: number;
        successCount: number;
        errorCount: number;
        totalLatencyMs: number;
        totalTokensUsed: number;
        toolCallCount: number;
        streamCount: number;
        lastUsedAt: Date | null;
    };

    constructor(deps: AgentDependencies) {
        this.llm = deps.llm;
        this.toolRegistry = deps.toolRegistry;
        this.prompts = deps.prompts;
        this.eventBus = deps.eventBus;

        this.metrics = {
            totalRequests: 0,
            successCount: 0,
            errorCount: 0,
            totalLatencyMs: 0,
            totalTokensUsed: 0,
            toolCallCount: 0,
            streamCount: 0,
            lastUsedAt: null,
        };
    }

    // ============================================================
    // 🎯 CORE PROCESSING
    // ============================================================

    /**
     * پردازش پیام (Non-streaming)
     */
    async process(context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();

        this.status = "processing";
        this.metrics.totalRequests++;
        this.metrics.lastUsedAt = new Date();

        try {
            // ۱. System prompt
            const systemPrompt = await this.getSystemPrompt(
                this.buildPromptVariables(context),
            );

            // ۲. LLM Request
            const request = this.buildLLMRequest(context, systemPrompt);

            // ۳. Event
            this.eventBus.emitAsync("agent.processing", {
                agentType: this.config.type,
                messageId: context.message.id,
                model: request.model ?? "default",
            });

            // ۴. LLM Generate
            let response = await this.llm.generate(request);

            // ۵. Tool Calling Loop
            const toolRecords: ToolCallRecord[] = [];

            if (response.toolCalls && response.toolCalls.length > 0) {
                const toolResult = await this.handleToolCalls(
                    context,
                    response,
                    request,
                );

                response = toolResult.finalResponse;
                toolRecords.push(...toolResult.records);
            }

            // ۶. Personality
            let content = response.content;
            if (this.config.applyPersonality) {
                content = this.applyPersonality(content);
            }

            // ۷. Build Response
            const agentResponse = this.buildAgentResponse(
                content,
                response,
                toolRecords,
                false,
                startTime,
            );

            this.trackSuccess(agentResponse, startTime);

            // ۸. Event
            this.eventBus.emitAsync("agent.responded", {
                agentType: this.config.type,
                messageId: context.message.id,
                responseLength: content.length,
                latencyMs: agentResponse.latencyMs,
                tokensUsed: agentResponse.usage.totalTokens,
            });

            this.status = "idle";
            return agentResponse;
        } catch (error: any) {
            this.status = "error";
            this.metrics.errorCount++;

            const agentError = createAgentError(
                this.classifyError(error),
                this.config.type,
                error.message ?? String(error),
            );

            this.status = "idle";
            throw agentError;
        }
    }

    /**
     * پردازش پیام (Streaming)
     */
    async stream(
        context: AgentContext,
        callbacks: AgentStreamCallbacks,
    ): Promise<AgentStreamController> {
        const startTime = Date.now();

        this.status = "streaming";
        this.metrics.totalRequests++;
        this.metrics.streamCount++;
        this.metrics.lastUsedAt = new Date();

        try {
            // ۱. System prompt
            const systemPrompt = await this.getSystemPrompt(
                this.buildPromptVariables(context),
            );

            // ۲. LLM Request
            const request = this.buildLLMRequest(context, systemPrompt);

            // ۳. Event
            this.eventBus.emitAsync("agent.processing", {
                agentType: this.config.type,
                messageId: context.message.id,
                model: request.model ?? "default",
            });

            // ۴. Stream
            let accumulated = "";
            const toolRecords: ToolCallRecord[] = [];

            const llmCallbacks: LLMStreamCallbacks = {
                onChunk: (chunk: LLMStreamChunk) => {
                    accumulated += chunk.content;

                    callbacks.onChunk(chunk.content, accumulated);

                    // Tool call detection
                    if (chunk.toolCall?.name && callbacks.onToolCall) {
                        callbacks.onToolCall(
                            chunk.toolCall.name,
                            chunk.toolCall.arguments ?? {},
                        );
                    }
                },

                onSentence: callbacks.onSentence
                    ? (sentence: string, index?: number) => callbacks.onSentence!(sentence, index ?? 0)
                    : undefined,

                onComplete: async (llmResponse: LLMResponse) => {
                    // Tool calling بعد از streaming
                    let finalContent = accumulated;

                    if (
                        llmResponse.toolCalls &&
                        llmResponse.toolCalls.length > 0
                    ) {
                        this.status = "tool-calling";

                        const toolResult = await this.handleToolCalls(
                            context,
                            llmResponse,
                            request,
                        );

                        finalContent = toolResult.finalResponse.content;
                        toolRecords.push(...toolResult.records);
                    }

                    // Personality
                    if (this.config.applyPersonality) {
                        finalContent = this.applyPersonality(finalContent);
                    }

                    const agentResponse = this.buildAgentResponse(
                        finalContent,
                        llmResponse,
                        toolRecords,
                        true,
                        startTime,
                    );

                    this.trackSuccess(agentResponse, startTime);

                    this.eventBus.emitAsync("agent.responded", {
                        agentType: this.config.type,
                        messageId: context.message.id,
                        responseLength: finalContent.length,
                        latencyMs: agentResponse.latencyMs,
                        tokensUsed: agentResponse.usage.totalTokens,
                    });

                    this.status = "idle";
                    callbacks.onComplete?.(agentResponse);
                },

                onError: (error) => {
                    this.status = "error";
                    this.metrics.errorCount++;

                    const agentError = createAgentError(
                        "llm-error",
                        this.config.type,
                        error.message,
                    );

                    this.status = "idle";
                    callbacks.onError?.(agentError);
                },
            };

            const controller = await this.llm.stream(request, llmCallbacks);

            // Wrap controller
            return {
                abort: () => {
                    controller.abort();
                    this.status = "idle";
                },
                get isAborted() {
                    return controller.isAborted;
                },
                completed: controller.completed.then((llmResponse) =>
                    this.buildAgentResponse(
                        accumulated,
                        llmResponse,
                        toolRecords,
                        true,
                        startTime,
                    ),
                ),
            };
        } catch (error: any) {
            this.status = "error";
            this.metrics.errorCount++;

            const agentError = createAgentError(
                this.classifyError(error),
                this.config.type,
                error.message ?? String(error),
            );

            this.status = "idle";
            throw agentError;
        }
    }

    // ============================================================
    // 🔧 TOOL CALLING
    // ============================================================

    /**
     * مدیریت tool calling loop
     *
     * ۱. LLM میگه tool_call
     * ۲. ما tool رو اجرا می‌کنیم
     * ۳. نتیجه رو به LLM برمی‌گردونیم
     * ۴. LLM پاسخ نهایی میده
     */
    private async handleToolCalls(
        context: AgentContext,
        llmResponse: LLMResponse,
        originalRequest: LLMRequest,
    ): Promise<{
        finalResponse: LLMResponse;
        records: ToolCallRecord[];
    }> {
        if (!this.toolRegistry || !llmResponse.toolCalls) {
            return { finalResponse: llmResponse, records: [] };
        }

        const records: ToolCallRecord[] = [];
        const toolMessages: LLMMessage[] = [];
        let callCount = 0;

        // اجرای هر tool call
        for (const toolCall of llmResponse.toolCalls) {
            if (callCount >= this.config.maxToolCalls) break;

            const toolStartTime = Date.now();

            this.eventBus.emitAsync("agent.tool.called", {
                agentType: this.config.type,
                toolName: toolCall.name,
                arguments: toolCall.arguments,
            });

            // اجرا
            const result = await this.toolRegistry.executeFromLLM(
                toolCall,
                {
                    message: context.message,
                    conversation: context.conversation,
                    memory: context.memory,
                    agentType: this.config.type,
                    channelId: context.channelId,
                    userId: context.userId,
                    guildId: context.guildId,
                },
            );

            const toolLatency = Date.now() - toolStartTime;

            records.push({
                toolName: toolCall.name,
                arguments: toolCall.arguments,
                result,
                latencyMs: toolLatency,
            });

            this.metrics.toolCallCount++;

            this.eventBus.emitAsync("agent.tool.completed", {
                agentType: this.config.type,
                toolName: toolCall.name,
                success: result.success,
                latencyMs: toolLatency,
            });

            // اضافه کردن نتیجه به messages
            toolMessages.push({
                role: "tool",
                content: result.formattedOutput,
                name: toolCall.name,
            });

            callCount++;
        }

        // ارسال مجدد به LLM با نتایج tools
        const followUpRequest: LLMRequest = {
            ...originalRequest,
            messages: [
                ...originalRequest.messages,
                {
                    role: "assistant",
                    content: llmResponse.content,
                },
                ...toolMessages,
            ],
            // دیگه tool نخواد
            tools: undefined,
        };

        const finalResponse = await this.llm.generate(followUpRequest);

        return { finalResponse, records };
    }

    getAvailableTools(): LLMToolDefinition[] {
        if (!this.toolRegistry || !this.config.toolCallingEnabled) {
            return [];
        }

        return this.toolRegistry.toLLMDefinitions(this.config.type);
    }

    async processToolResult(
        context: AgentContext,
        toolResults: ToolCallRecord[],
    ): Promise<AgentResponse> {
        const startTime = Date.now();

        const systemPrompt = await this.getSystemPrompt(
            this.buildPromptVariables(context),
        );

        // ساخت messages با نتایج tools
        const toolMessages: LLMMessage[] = toolResults.map((tr) => ({
            role: "tool" as const,
            content: tr.result.formattedOutput,
            name: tr.toolName,
        }));

        const request: LLMRequest = {
            messages: [
                ...context.contextWindow.toLLMPayload(),
                ...toolMessages,
            ],
            params: {
                temperature: this.config.defaultTemperature,
                maxTokens: this.config.maxOutputTokens,
            },
            metadata: {
                agentType: this.config.type,
                purpose: "tool-call",
                channelId: context.channelId,
                userId: context.userId,
            },
        };

        const response = await this.llm.generate(request);

        let content = response.content;
        if (this.config.applyPersonality) {
            content = this.applyPersonality(content);
        }

        return this.buildAgentResponse(
            content,
            response,
            toolResults,
            false,
            startTime,
        );
    }

    // ============================================================
    // 📝 PROMPT MANAGEMENT
    // ============================================================

    async getSystemPrompt(
        variables?: Record<string, string>,
    ): Promise<string> {
        const now = Date.now();

        // Cache check
        if (
            this.cachedSystemPrompt &&
            now - this.promptLastLoaded < this.PROMPT_CACHE_TTL
        ) {
            if (!variables) return this.cachedSystemPrompt;

            return this.substituteVariables(this.cachedSystemPrompt, variables);
        }

        // Load from file
        try {
            const rawPrompt = await this.prompts.loadPrompt(
                this.config.systemPromptPath,
            );

            this.cachedSystemPrompt = rawPrompt;
            this.promptLastLoaded = now;

            if (variables) {
                return this.substituteVariables(rawPrompt, variables);
            }

            return rawPrompt;
        } catch (error: any) {
            console.error(
                `[${this.config.type}] Failed to load prompt: ${error.message}`,
            );

            // Fallback prompt
            return this.getFallbackPrompt();
        }
    }

    async reloadPrompt(): Promise<void> {
        this.cachedSystemPrompt = null;
        this.promptLastLoaded = 0;

        await this.prompts.reload(this.config.systemPromptPath);
    }

    /**
     * Fallback prompt اگر فایل لود نشد
     * هر Agent می‌تونه override کنه
     */
    protected getFallbackPrompt(): string {
        return `تو ویرا هستی، یک دستیار هوشمند فارسی‌زبان.
با لحن صمیمی و دوستانه پاسخ بده.
اگر سوال فنی بود، دقیق و حرفه‌ای جواب بده.
اگر سوال شخصی بود، مهربان و حمایت‌کننده باش.`;
    }

    // ============================================================
    // 💚 PERSONALITY
    // ============================================================

    usesPersonality(): boolean {
        return this.config.applyPersonality;
    }

    /**
     * اعمال شخصیت ویرا روی پاسخ
     *
     * هر Agent می‌تونه override کنه
     * Default: بدون تغییر
     */
    applyPersonality(response: string, _mood?: string): string {
        return response;
    }

    // ============================================================
    // 🎯 RELEVANCE & ROUTING
    // ============================================================

    /**
     * امتیاز مرتبط بودن پیام با این Agent
     *
     * @returns 0-1
     */
    relevanceScore(message: Message): number {
        const content = message.content.toLowerCase();
        const keywords = this.getTriggerKeywords();

        if (keywords.length === 0) return 0;

        let matchCount = 0;

        for (const keyword of keywords) {
            if (content.includes(keyword.toLowerCase())) {
                matchCount++;
            }
        }

        // بلاک کد = بونوس برای DevAgent
        if (message.hasCode() && this.config.type === "dev") {
            matchCount += 3;
        }

        // نرمالایز
        const maxPossible = Math.min(keywords.length, 5);
        return Math.min(1, matchCount / maxPossible);
    }

    /**
     * کلیدواژه‌های فعال‌سازی
     * هر Agent باید override کنه
     */
    abstract getTriggerKeywords(): string[];

    // ============================================================
    // 📊 HEALTH & METRICS
    // ============================================================

    getStatus(): AgentStatus {
        return this.status;
    }

    getMetrics(): AgentMetrics {
        return {
            totalRequests: this.metrics.totalRequests,
            successCount: this.metrics.successCount,
            errorCount: this.metrics.errorCount,
            averageLatencyMs: this.metrics.successCount > 0
                ? Math.round(
                    this.metrics.totalLatencyMs / this.metrics.successCount,
                )
                : 0,
            averageTokensUsed: this.metrics.successCount > 0
                ? Math.round(
                    this.metrics.totalTokensUsed / this.metrics.successCount,
                )
                : 0,
            toolCallCount: this.metrics.toolCallCount,
            streamCount: this.metrics.streamCount,
            lastUsedAt: this.metrics.lastUsedAt,
        };
    }

    resetMetrics(): void {
        this.metrics = {
            totalRequests: 0,
            successCount: 0,
            errorCount: 0,
            totalLatencyMs: 0,
            totalTokensUsed: 0,
            toolCallCount: 0,
            streamCount: 0,
            lastUsedAt: null,
        };
    }

    async healthCheck(): Promise<{
        healthy: boolean;
        promptLoaded: boolean;
        llmAvailable: boolean;
        toolsAvailable: number;
    }> {
        const promptLoaded = this.cachedSystemPrompt !== null
            || await this.prompts.promptExists(this.config.systemPromptPath);

        const llmAvailable = await this.llm.isAvailable().catch(() => false);

        const toolsAvailable = this.toolRegistry
            ? this.toolRegistry.getToolsForAgent(this.config.type).length
            : 0;

        return {
            healthy: promptLoaded && llmAvailable,
            promptLoaded,
            llmAvailable,
            toolsAvailable,
        };
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    /**
     * ساخت LLM Request
     */
    private buildLLMRequest(
        context: AgentContext,
        systemPrompt: string,
    ): LLMRequest {
        // Messages از ContextWindow
        const messages = context.contextWindow.toLLMPayload();

        // اگر system prompt خالیه، جایگزین کن
        const finalMessages: LLMMessage[] = messages.map((msg, index) => {
            if (index === 0 && msg.role === "system") {
                // merge system prompt context window با agent prompt
                return {
                    role: "system" as const,
                    content: `${systemPrompt}\n\n---\n\n${msg.content}`,
                };
            }
            return msg;
        });

        // Tools
        const tools = this.config.toolCallingEnabled
            ? this.getAvailableTools()
            : undefined;

        return {
            messages: finalMessages,
            params: {
                temperature: this.config.defaultTemperature,
                maxTokens: this.config.maxOutputTokens,
            },
            stream: false,
            tools: tools && tools.length > 0 ? tools : undefined,
            metadata: {
                agentType: this.config.type,
                purpose: "chat",
                conversationId: context.conversation.id,
                channelId: context.channelId,
                userId: context.userId,
            },
        };
    }

    /**
     * ساخت AgentResponse
     */
    private buildAgentResponse(
        content: string,
        llmResponse: LLMResponse,
        toolRecords: ToolCallRecord[],
        streamed: boolean,
        startTime: number,
    ): AgentResponse {
        return {
            content,
            agentType: this.config.type,
            model: llmResponse.model,
            provider: llmResponse.provider,
            latencyMs: Date.now() - startTime,
            usage: llmResponse.usage,
            toolsUsed: toolRecords,
            streamed,
            personalityApplied: this.config.applyPersonality,
            metadata: {
                timing: llmResponse.timing,
                finishReason: llmResponse.finishReason,
            },
        };
    }

    /**
     * ساخت prompt variables
     * هر Agent می‌تونه override کنه
     */
    protected buildPromptVariables(
        context: AgentContext,
    ): Record<string, string> {
        return {
            userName: context.message.author.displayName,
            userId: context.userId,
            channelName: context.message.channel.name,
            agentType: this.config.type,
            isVoice: String(context.isVoice),
            currentTime: new Date().toLocaleTimeString("fa-IR"),
            currentDate: new Date().toLocaleDateString("fa-IR"),
        };
    }

    /**
     * جایگزینی متغیرها
     */
    private substituteVariables(
        template: string,
        variables: Record<string, string>,
    ): string {
        let result = template;

        for (const [key, value] of Object.entries(variables)) {
            const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
            result = result.replace(pattern, value);
        }

        return result;
    }

    /**
     * طبقه‌بندی خطا
     */
    private classifyError(error: any): AgentErrorType {
        if (!error) return "unknown";

        const message = error.message ?? String(error);

        if (error.type === "timeout" || message.includes("timeout")) {
            return "timeout";
        }

        if (error.type === "connection" || message.includes("ECONNREFUSED")) {
            return "llm-error";
        }

        if (message.includes("prompt") || message.includes("not found")) {
            return "prompt-error";
        }

        if (message.includes("tool")) {
            return "tool-error";
        }

        if (message.includes("context") || message.includes("token")) {
            return "context-error";
        }

        return "llm-error";
    }

    /**
     * ثبت موفقیت
     */
    private trackSuccess(
        response: AgentResponse,
        startTime: number,
    ): void {
        this.metrics.successCount++;
        this.metrics.totalLatencyMs += Date.now() - startTime;
        this.metrics.totalTokensUsed += response.usage.totalTokens;
    }
}