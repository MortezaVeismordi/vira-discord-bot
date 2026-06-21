// src/core/orchestration/AgentOrchestrator.ts

import type { IEventBus } from "@/core/contracts/IEventBus";
import type { IAgentRouter, RoutingContext } from "@/core/contracts/IAgentRouter";
import type { IAgent, AgentContext } from "@/core/contracts/IAgent";
import type { IContextManager } from "@/core/contracts/IContextManager";
import type { AgentType } from "@/core/domain/types/AgentType";
import type { Message } from "@/core/domain/entities/Message";
import type { Conversation } from "@/core/domain/entities/Conversation";
import { createAgentContext } from "@/core/contracts/IAgent";
import type { LLMResponse } from "@/core/contracts/ILLMPort";

// ============================================================
// 📐 TYPES
// ============================================================

export interface OrchestratorConfig {
    /** آیا لاگ debug فعال باشد؟ */
    readonly debug?: boolean;

    /** آیا بعد از هر پیام حافظه ذخیره شود؟ */
    readonly saveContextAfterResponse?: boolean;

    /** آیا در صورت خطا، پیام fallback ارسال شود؟ */
    readonly sendFallbackOnError?: boolean;

    /** متن پیام fallback در صورت خطا */
    readonly fallbackMessage?: string;

    /** آی‌دی دیسکورد مرتضی برای فعال کردن حالت دوستی صمیمی عاطفی */
    readonly mortezaId?: string;
}

// ============================================================
// 🎼 AGENT ORCHESTRATOR
// ============================================================

/**
 * هماهنگ‌کننده اصلی سیستم ویرا (Orchestrator)
 */
export class AgentOrchestrator {
    private readonly eventBus: IEventBus;
    private readonly router: IAgentRouter;
    private readonly agents: Map<AgentType, IAgent>;
    private readonly contextManager: IContextManager;
    private readonly config: Required<OrchestratorConfig>;

    private isRunning = false;
    private processedCount = 0;
    private errorCount = 0;

    constructor(
        eventBus: IEventBus,
        router: IAgentRouter,
        agents: Map<AgentType, IAgent>,
        contextManager: IContextManager,
        config?: OrchestratorConfig,
    ) {
        this.eventBus = eventBus;
        this.router = router;
        this.agents = agents;
        this.contextManager = contextManager;
        this.config = {
            debug: config?.debug ?? false,
            saveContextAfterResponse: config?.saveContextAfterResponse ?? true,
            sendFallbackOnError: config?.sendFallbackOnError ?? true,
            fallbackMessage: config?.fallbackMessage ?? "اوه، یه مشکلی پیش اومد 😅 دوباره امتحان کن!",
            mortezaId: config?.mortezaId ?? "",
        };
    }

    // ============================================================
    // 🚀 LIFECYCLE
    // ============================================================

    /**
     * شروع ارکستریتور و اشتراک در EventBus
     */
    start(): void {
        if (this.isRunning) {
            console.warn("[Orchestrator] Already running.");
            return;
        }

        this.eventBus.on(
            "message.received",
            async (payload) => {
                await this.handleMessage(payload.message, payload.conversation);
            },
            { name: "orchestrator:message.received", priority: 10 },
        );

        this.isRunning = true;
        console.log("[Orchestrator] Started — listening for messages.");
    }

    /**
     * توقف ارکستریتور
     */
    stop(): void {
        this.isRunning = false;
        console.log("[Orchestrator] Stopped.");
    }

    // ============================================================
    // 🔄 CORE PIPELINE
    // ============================================================

    /**
     * پردازش یک پیام ورودی
     */
    private async handleMessage(
        message: Message,
        conversation: Conversation,
    ): Promise<void> {
        const startTime = Date.now();
        this.debugLog(`Processing message: "${message.content.slice(0, 60)}..."`);

        try {
            // ─── ۱. بارگذاری حافظه مکالمه ──────────────────────────
            const memory = await this.contextManager.loadOrCreate(
                message.channel.id,
                message.author.id,
            );

            // ─── ۲. روتینگ پیام به ایجنت مناسب ───────────────────────
            const routingCtx: RoutingContext = {
                message,
                conversation,
                channelName: message.channel.name ?? "general",
                isReply: message.isReply(),
            };

            const routing = await this.router.route(routingCtx);

            this.debugLog(
                `Routed to: ${routing.agentType} ` +
                `(confidence: ${(routing.confidence * 100).toFixed(0)}%, ` +
                `strategy: ${routing.strategy})`,
            );

            // ─── ۳. انتشار رویداد روت شدن پیام ──────────────────────
            await this.eventBus.emit("message.routed", {
                message,
                agentType: routing.agentType,
                confidence: routing.confidence,
                strategy: (routing.strategy === "hybrid" ? "rule-based" : routing.strategy) as "rule-based" | "llm" | "default",
            });

            // ─── ۴. دریافت نمونه ایجنت هدف ───────────────────────────
            const agent = this.agents.get(routing.agentType);
            if (!agent) {
                throw new Error(`Agent not found: ${routing.agentType}`);
            }

            // ─── ۵. ساخت پرامپت اختصاصی سیستم و اعمال عاطفی صمیمیت با مرتضی ───
            const systemPrompt = await agent.getSystemPrompt();
            let finalSystemPrompt = systemPrompt;

            // قانون طلایی شخصی‌سازی رفتار بات دیسکورد با سازنده خود (مرتضی)
            if (routing.agentType === "companion") {
                if (this.config.mortezaId && message.author.id === this.config.mortezaId) {
                    finalSystemPrompt += `\n\n[DANGER - CRITICAL RULE]: کاربری که در حال حاضر با او صحبت می‌کنی "مرتضی" (Morteza) سازنده و برنامه‌نویس اصلی تو است. با او بی‌نهایت صمیمی، بامحبت، رفیق صمیمی و با لحنی کاملاً خودمانی، باحال و دلی چت کن. همیشه هوایش را داشته باش و او را با نام "مرتضی" یا "داش مرتضی" صدا بزن. بدون تعارف و کاملاً دوستانه حرف بزن.`;
                } else {
                    finalSystemPrompt += `\n\n[CRITICAL RULE]: کاربری که در حال حاضر با او صحبت می‌کنی یک عضو معمولی سرور است. با لحنی کاملاً محترمانه، مبادی آداب، مفید، با فاصله اجتماعی مناسب و بدون صمیمیت بیش از حد پاسخ بده.`;
                }
            }

            // ─── ۶. تولید کانتکست پنجره برای ارسال به LLM ───────────────────
            const contextWindow = await this.contextManager.buildContext(
                conversation,
                message,
                {
                    maxTokens: 4096,
                    agentType: routing.agentType,
                    systemPrompt: finalSystemPrompt,
                    relevantQuery: message.content,
                },
            );

            // ─── ۷. ساخت کانتکست اجرای ایجنت ───────────────────────
            const agentContext: AgentContext = createAgentContext({
                message,
                conversation,
                memory,
                contextWindow,
                metadata: {
                    routingResult: routing,
                    latencyMs: Date.now() - startTime,
                },
            });

            // ─── ۸. پردازش توسط ایجنت و گرفتن پاسخ نهایی ───────────────────
            const response = await agent.process(agentContext);

            // ─── ۹. ذخیره خودکار حافظه مکالمه ───────────────────
            if (this.config.saveContextAfterResponse) {
                await this.contextManager.save(
                    message.channel.id,
                    message.author.id,
                    { onlyIfChanged: true },
                ).catch((err) => {
                    console.warn("[Orchestrator] Failed to save context:", err);
                });
            }

            // ─── ۱۰. انتشار رویداد موفقیت آمیز اتمام پردازش پیام ──────────────
            await this.eventBus.emit("message.completed", {
                message,
                response: response.content,
                agentType: routing.agentType,
                llmResponse: response as unknown as LLMResponse,
            });

            this.processedCount++;
            this.debugLog(`Done in ${Date.now() - startTime}ms`);

        } catch (error) {
            this.errorCount++;
            const errMsg = error instanceof Error 
                    ? error.message 
                    : typeof error === "object" 
                        ? JSON.stringify(error, null, 2) 
                        : String(error);

            console.error("[Orchestrator] Error processing message:", errMsg);

            await this.eventBus.emit("message.failed", {
                message,
                error: errMsg,
                agentType: "companion",
            }).catch(() => {});

            // ارسال پیام خطا بر اساس نوع مشکل
            if (this.config.sendFallbackOnError) {
                const friendlyMessage = this.getFallbackMessage(errMsg);
                await this.eventBus.emit("message.completed", {
                    message,
                    response: friendlyMessage,
                    agentType: "companion",
                    llmResponse: { content: friendlyMessage, finishReason: "stop", timing: { total: 0, ttft: 0, tokensPerSecond: 0 } } as unknown as LLMResponse,
                }).catch(() => {});
            }
        }
    }

    // ============================================================
    // 📊 STATUS
    // ============================================================

    getStats(): {
        isRunning: boolean;
        processedCount: number;
        errorCount: number;
        agentCount: number;
    } {
        return {
            isRunning: this.isRunning,
            processedCount: this.processedCount,
            errorCount: this.errorCount,
            agentCount: this.agents.size,
        };
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    private debugLog(msg: string): void {
        if (this.config.debug) {
            console.log(`[Orchestrator] ${msg}`);
        }
    }

    private getFallbackMessage(errMsg: string): string {
        const lower = errMsg.toLowerCase();

        if (lower.includes("rate limit") || lower.includes("rate limited") || lower.includes("429")) {
            return "الان خیلی شلوغمه 😅 یه دقیقه صبر کن و دوباره امتحان کن!";
        }

        if (lower.includes("timeout") || lower.includes("timed out")) {
            return "جوابم یکم طول کشید و timeout شد ⏳ دوباره بپرس!";
        }

        if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("fetch")) {
            return "مشکل اتصال دارم 🌐 یه لحظه صبر کن و دوباره امتحان کن!";
        }

        if (lower.includes("model not found") || lower.includes("unavailable")) {
            return "مدل زبانیم الان در دسترس نیست 🤖 یه لحظه دیگه امتحان کن!";
        }

        if (lower.includes("context") || lower.includes("token")) {
            return "مکالمه‌مون خیلی طولانی شده 📝 با @Vira clear حافظه‌ام رو پاک کن و از نو شروع کنیم!";
        }

        return this.config.fallbackMessage;
    }
}