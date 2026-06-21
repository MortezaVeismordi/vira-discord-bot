// src/core/contracts/IAgentRouter.ts

import type { Message } from "../domain/entities/Message";
import type { Conversation } from "../domain/entities/Conversation";
import type { AgentType } from "../domain/types/AgentType";
import type { IAgent, AgentConfig } from "./IAgent";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * استراتژی روتینگ
 */
export type RoutingStrategy =
    | "rule-based"       // فقط keyword + channel
    | "llm"              // فقط LLM
    | "hybrid";          // اول rule، بعد LLM اگر مطمئن نبود

/**
 * نتیجه روتینگ
 */
export interface RoutingResult {
    /** Agent انتخاب شده */
    readonly agentType: AgentType;

    /** اطمینان (0-1) */
    readonly confidence: number;

    /** استراتژی استفاده شده */
    readonly strategy: RoutingStrategy;

    /** دلیل انتخاب */
    readonly reason: string;

    /** زمان روتینگ (ms) */
    readonly latencyMs: number;

    /** آیا به fallback رفت؟ */
    readonly usedFallback: boolean;

    /** گزینه‌های جایگزین */
    readonly alternatives: RoutingAlternative[];

    /** سیگنال‌هایی که تشخیص داده شد */
    readonly signals: RoutingSignal[];
}

/**
 * یک گزینه جایگزین
 */
export interface RoutingAlternative {
    readonly agentType: AgentType;
    readonly confidence: number;
    readonly reason: string;
}

/**
 * یک سیگنال تشخیص داده شده
 */
export interface RoutingSignal {
    /** نوع سیگنال */
    readonly type: SignalType;

    /** مقدار سیگنال */
    readonly value: string;

    /** وزن (0-1) */
    readonly weight: number;

    /** Agent مرتبط */
    readonly suggestsAgent: AgentType;
}

/**
 * انواع سیگنال روتینگ
 */
export type SignalType =
    | "channel-name"     // نام کانال
    | "keyword"          // کلیدواژه فارسی/انگلیسی
    | "code-block"       // بلاک کد ```
    | "error-pattern"    // الگوی خطا
    | "emoji"            // اموجی مرتبط
    | "mention"          // منشن خاص
    | "reply-context"    // reply به پیام قبلی
    | "conversation-topic" // موضوع فعلی مکالمه
    | "llm-classification" // تشخیص LLM
    | "user-preference"; // ترجیح کاربر

/**
 * قوانین روتینگ
 */
export interface RoutingRule {
    /** نام قانون */
    readonly name: string;

    /** توضیح */
    readonly description: string;

    /** Agent مقصد */
    readonly agentType: AgentType;

    /** اولویت (بالاتر = مهم‌تر) */
    readonly priority: number;

    /** شرایط فعال شدن */
    readonly conditions: RoutingCondition[];

    /** آیا فعال هست؟ */
    readonly enabled: boolean;
}

/**
 * شرط روتینگ
 */
export interface RoutingCondition {
    readonly type: ConditionType;
    readonly value: string | string[] | RegExp;
    readonly weight: number;
}

/**
 * انواع شرط
 */
export type ConditionType =
    | "channel-name-equals"
    | "channel-name-contains"
    | "content-contains-keyword"
    | "content-matches-pattern"
    | "has-code-block"
    | "has-error-pattern"
    | "conversation-topic-is"
    | "message-source-is";

/**
 * متریک‌های روتینگ
 */
export interface RouterMetrics {
    readonly totalRoutings: number;
    readonly ruleBasedCount: number;
    readonly llmCount: number;
    readonly fallbackCount: number;
    readonly averageLatencyMs: number;
    readonly averageConfidence: number;
    readonly perAgent: Record<AgentType, {
        count: number;
        averageConfidence: number;
    }>;
    readonly perStrategy: Record<RoutingStrategy, number>;
    readonly topSignals: Array<{
        signal: string;
        count: number;
        agent: AgentType;
    }>;
}

/**
 * تنظیمات Router
 */
export interface RouterConfig {
    /** استراتژی پیش‌فرض */
    readonly strategy: RoutingStrategy;

    /** آستانه اطمینان rule-based */
    readonly ruleConfidenceThreshold: number;

    /** آستانه اطمینان LLM */
    readonly llmConfidenceThreshold: number;

    /** Agent پیش‌فرض (وقتی هیچ‌کدام match نشد) */
    readonly defaultAgent: AgentType;

    /** حداکثر زمان مجاز برای LLM routing (ms) */
    readonly llmTimeout: number;

    /** آیا LLM fallback فعاله؟ */
    readonly llmFallbackEnabled: boolean;

    /** cache فعال باشه؟ */
    readonly cachingEnabled: boolean;

    /** TTL کش (ms) */
    readonly cacheTTL: number;
}

/**
 * Context روتینگ
 */
export interface RoutingContext {
    /** پیام فعلی */
    readonly message: Message;

    /** مکالمه فعلی */
    readonly conversation: Conversation;

    /** نام کانال */
    readonly channelName: string;

    /** Agent فعلی مکالمه (اگر بود) */
    readonly currentAgent?: AgentType;

    /** آیا reply به پیام قبلی هست؟ */
    readonly isReply: boolean;

    /** Agent پیام reply شده (اگر reply بود) */
    readonly replyAgent?: AgentType;

    /** ترجیح کاربر (اگر تنظیم کرده باشه) */
    readonly userPreference?: AgentType;
}

// ============================================================
// 🧭 MAIN INTERFACE - IAgentRouter
// ============================================================

/**
 * روتر اصلی Agent
 *
 * تعیین می‌کنه هر پیام باید به کدوم Agent ارسال بشه.
 *
 * ```
 * Message → IAgentRouter.route() → AgentType
 *                │
 *                ├── 1. Rule-Based (سریع)
 *                │   ├── Channel Name Match?
 *                │   ├── Keyword Match?
 *                │   ├── Code Block Detected?
 *                │   └── Conversation Topic?
 *                │
 *                ├── 2. اگر confidence < threshold
 *                │   └── LLM Classification (کندتر)
 *                │
 *                └── 3. اگر هنوز مطمئن نیست
 *                    └── Default Agent (companion)
 * ```
 *
 * @example
 * ```typescript
 * class ResponsePipeline {
 *   constructor(
 *     private router: IAgentRouter,
 *     private agents: Map<AgentType, IAgent>,
 *   ) {}
 *
 *   async handle(message: Message, conversation: Conversation) {
 *     // ۱. روتینگ
 *     const routing = await this.router.route({
 *       message,
 *       conversation,
 *       channelName: message.channel.name,
 *     });
 *
 *     console.log(`→ ${routing.agentType} (${routing.confidence})`);
 *     console.log(`  Strategy: ${routing.strategy}`);
 *     console.log(`  Reason: ${routing.reason}`);
 *
 *     // ۲. Agent انتخاب شده رو صدا بزن
 *     const agent = this.agents.get(routing.agentType)!;
 *     const response = await agent.process(context);
 *   }
 * }
 * ```
 */
export interface IAgentRouter {
    // ─── Core Routing ─────────────────────────────────────

    /**
     * روتینگ یک پیام
     *
     * @example
     * ```typescript
     * const result = await router.route({
     *   message,
     *   conversation,
     *   channelName: "dev-chat",
     * });
     *
     * // result:
     * // {
     * //   agentType: "dev",
     * //   confidence: 0.95,
     * //   strategy: "rule-based",
     * //   reason: "Channel name 'dev-chat' + keyword 'باگ'",
     * //   latencyMs: 2,
     * //   signals: [
     * //     { type: "channel-name", value: "dev-chat", weight: 0.8 },
     * //     { type: "keyword", value: "باگ", weight: 0.9 },
     * //   ],
     * // }
     * ```
     */
    route(context: RoutingContext): Promise<RoutingResult>;

    /**
     * روتینگ سریع (فقط Rule-based)
     *
     * بدون هیچ IO - برای زمانی که سرعت مهمه
     * اگر مطمئن نبود، null برمی‌گردونه
     *
     * @example
     * ```typescript
     * const result = router.routeFast(context);
     * if (result && result.confidence > 0.7) {
     *   // استفاده کن
     * } else {
     *   // به LLM بده
     * }
     * ```
     */
    routeFast(context: RoutingContext): RoutingResult | null;

    /**
     * روتینگ با LLM (فقط Intent Classification)
     *
     * کندتر ولی دقیق‌تر
     */
    routeWithLLM(context: RoutingContext): Promise<RoutingResult>;

    // ─── Signal Detection ─────────────────────────────────

    /**
     * تشخیص سیگنال‌های پیام
     *
     * بدون تصمیم‌گیری - فقط سیگنال‌ها رو شناسایی می‌کنه
     *
     * @example
     * ```typescript
     * const signals = router.detectSignals(message, "dev-chat");
     * // [
     * //   { type: "channel-name", value: "dev-chat", weight: 0.8, suggestsAgent: "dev" },
     * //   { type: "keyword", value: "docker", weight: 0.7, suggestsAgent: "dev" },
     * //   { type: "code-block", value: "typescript", weight: 0.9, suggestsAgent: "dev" },
     * // ]
     * ```
     */
    detectSignals(
        message: Message,
        channelName: string,
        conversation?: Conversation,
    ): RoutingSignal[];

    /**
     * محاسبه امتیاز هر Agent بر اساس سیگنال‌ها
     *
     * @example
     * ```typescript
     * const scores = router.scoreAgents(signals);
     * // { dev: 0.95, gamer: 0.1, companion: 0.3 }
     * ```
     */
    scoreAgents(
        signals: RoutingSignal[],
    ): Record<AgentType, number>;

    // ─── Rule Management ──────────────────────────────────

    /**
     * اضافه کردن قانون جدید
     *
     * @example
     * ```typescript
     * router.addRule({
     *   name: "minecraft-channel",
     *   description: "پیام‌های کانال minecraft → GamerAgent",
     *   agentType: "gamer",
     *   priority: 90,
     *   conditions: [
     *     {
     *       type: "channel-name-contains",
     *       value: "minecraft",
     *       weight: 0.9,
     *     },
     *   ],
     *   enabled: true,
     * });
     * ```
     */
    addRule(rule: RoutingRule): void;

    /**
     * حذف قانون
     */
    removeRule(name: string): boolean;

    /**
     * دریافت تمام قوانین
     */
    getRules(): RoutingRule[];

    /**
     * فعال/غیرفعال کردن قانون
     */
    toggleRule(name: string, enabled: boolean): boolean;

    /**
     * تنظیم keyword‌های یک Agent
     *
     * @example
     * ```typescript
     * router.setKeywords("dev", [
     *   "باگ", "خطا", "error", "debug", "docker", "api",
     * ]);
     * ```
     */
    setKeywords(agentType: AgentType, keywords: string[]): void;

    /**
     * دریافت keyword‌های یک Agent
     */
    getKeywords(agentType: AgentType): string[];

    /**
     * تنظیم channel mapping
     *
     * @example
     * ```typescript
     * router.setChannelMapping("dev", ["dev", "coding", "debug"]);
     * router.setChannelMapping("gamer", ["gaming", "minecraft"]);
     * ```
     */
    setChannelMapping(
        agentType: AgentType,
        channelNames: string[],
    ): void;

    /**
     * دریافت channel mapping
     */
    getChannelMapping(agentType: AgentType): string[];

    // ─── Confidence Tuning ────────────────────────────────

    /**
     * تنظیم آستانه اطمینان
     */
    setConfidenceThreshold(threshold: number): void;

    /**
     * دریافت آستانه اطمینان فعلی
     */
    getConfidenceThreshold(): number;

    /**
     * تنظیم Agent پیش‌فرض
     */
    setDefaultAgent(agentType: AgentType): void;

    /**
     * دریافت Agent پیش‌فرض
     */
    getDefaultAgent(): AgentType;

    // ─── Context-Aware Routing ────────────────────────────

    /**
     * آیا باید Agent عوض بشه؟ (Context Switch Detection)
     *
     * مثلاً مکالمه درباره کد بود، ولی الان کاربر گفت "بریم ماینکرفت"
     *
     * @example
     * ```typescript
     * const shouldSwitch = router.shouldSwitchAgent(
     *   currentAgent,
     *   message,
     *   conversation,
     * );
     *
     * if (shouldSwitch.switch) {
     *   console.log(`Switch: ${shouldSwitch.from} → ${shouldSwitch.to}`);
     *   console.log(`Reason: ${shouldSwitch.reason}`);
     * }
     * ```
     */
    shouldSwitchAgent(
        currentAgent: AgentType,
        message: Message,
        conversation: Conversation,
    ): AgentSwitchDecision;

    /**
     * پیشنهاد Agent برای reply
     *
     * وقتی کاربر reply به پیام قبلی می‌زنه
     */
    suggestAgentForReply(
        replyToMessage: Message,
        currentMessage: Message,
    ): AgentType;

    // ─── Caching ──────────────────────────────────────────

    /**
     * cache کردن نتیجه routing
     *
     * پیام‌های مشابه در یک بازه زمانی → همون Agent
     */
    cacheResult(
        messageId: string,
        result: RoutingResult,
    ): void;

    /**
     * دریافت از cache
     */
    getCachedResult(messageId: string): RoutingResult | undefined;

    /**
     * پاکسازی cache
     */
    clearCache(): void;

    // ─── Metrics & Debugging ──────────────────────────────

    /**
     * متریک‌های روتر
     */
    getMetrics(): RouterMetrics;

    /**
     * ریست متریک‌ها
     */
    resetMetrics(): void;

    /**
     * توضیح تصمیم روتینگ (برای debug)
     *
     * @example
     * ```typescript
     * const explanation = await router.explain(context);
     * console.log(explanation);
     * // "پیام شامل کلیدواژه 'باگ' (وزن: 0.9) و بلاک کد TypeScript (وزن: 0.95)
     * //  و در کانال 'dev-chat' (وزن: 0.8) ارسال شده.
     * //  ⟹ DevAgent انتخاب شد با اطمینان 0.95 (Rule-based)"
     * ```
     */
    explain(context: RoutingContext): Promise<string>;

    /**
     * تنظیمات فعلی Router
     */
    getConfig(): RouterConfig;

    /**
     * بروزرسانی تنظیمات
     */
    updateConfig(config: Partial<RouterConfig>): void;
}

/**
 * تصمیم تغییر Agent
 */
export interface AgentSwitchDecision {
    /** آیا باید عوض بشه؟ */
    readonly switch: boolean;

    /** از کجا */
    readonly from: AgentType;

    /** به کجا */
    readonly to: AgentType;

    /** دلیل */
    readonly reason: string;

    /** اطمینان */
    readonly confidence: number;

    /** سیگنال‌های تشخیص */
    readonly signals: RoutingSignal[];
}

// ============================================================
// 🔧 STRATEGY INTERFACES
// ============================================================

/**
 * استراتژی Rule-based
 *
 * @example
 * ```typescript
 * class RuleBasedRouter implements IRuleBasedStrategy {
 *   evaluate(context: RoutingContext): RoutingResult | null {
 *     // چک channel name
 *     // چک keywords
 *     // چک code blocks
 *     // چک conversation topic
 *   }
 * }
 * ```
 */
export interface IRuleBasedStrategy {
    /**
     * ارزیابی بر اساس قوانین
     *
     * @returns نتیجه یا null اگر مطمئن نبود
     */
    evaluate(context: RoutingContext): RoutingResult | null;

    /**
     * تشخیص سیگنال‌ها
     */
    detectSignals(
        message: Message,
        channelName: string,
    ): RoutingSignal[];

    /**
     * مدیریت قوانین
     */
    addRule(rule: RoutingRule): void;
    removeRule(name: string): boolean;
    getRules(): RoutingRule[];
}

/**
 * استراتژی LLM-based
 *
 * @example
 * ```typescript
 * class LLMRouter implements ILLMRoutingStrategy {
 *   async classify(context: RoutingContext): Promise<RoutingResult> {
 *     const response = await this.llm.classify(
 *       message.content,
 *       ["dev", "gamer", "companion"],
 *       classificationPrompt,
 *     );
 *     return {
 *       agentType: response.label as AgentType,
 *       confidence: response.confidence,
 *       strategy: "llm",
 *       reason: response.reasoning,
 *     };
 *   }
 * }
 * ```
 */
export interface ILLMRoutingStrategy {
    /**
     * طبقه‌بندی با LLM
     */
    classify(context: RoutingContext): Promise<RoutingResult>;
}

/**
 * استراتژی Hybrid
 *
 * ترکیب Rule-based و LLM
 */
export interface IHybridStrategy {
    /**
     * روتینگ هیبریدی
     *
     * 1. اول Rule-based
     * 2. اگر confidence < threshold → LLM
     * 3. اگر هنوز مطمئن نیست → Default Agent
     */
    route(context: RoutingContext): Promise<RoutingResult>;

    /** استراتژی Rule-based */
    readonly ruleStrategy: IRuleBasedStrategy;

    /** استراتژی LLM */
    readonly llmStrategy: ILLMRoutingStrategy;
}

// ============================================================
// 🛠️ HELPER FUNCTIONS
// ============================================================

/**
 * ساخت RoutingResult پیش‌فرض
 */
export function createDefaultRouting(
    defaultAgent: AgentType = "companion",
): RoutingResult {
    return {
        agentType: defaultAgent,
        confidence: 0.5,
        strategy: "rule-based",
        reason: "Default agent - هیچ سیگنال قوی‌ای تشخیص داده نشد",
        latencyMs: 0,
        usedFallback: true,
        alternatives: [],
        signals: [],
    };
}

/**
 * ساخت RoutingResult از Rule-based
 */
export function createRuleBasedRouting(
    agentType: AgentType,
    confidence: number,
    reason: string,
    signals: RoutingSignal[],
    latencyMs: number = 0,
): RoutingResult {
    const allAgents: AgentType[] = ["dev", "gamer", "companion"];
    const alternatives = allAgents
        .filter((a) => a !== agentType)
        .map((a) => ({
            agentType: a,
            confidence: 0,
            reason: "Not selected",
        }));

    return {
        agentType,
        confidence,
        strategy: "rule-based",
        reason,
        latencyMs,
        usedFallback: false,
        alternatives,
        signals,
    };
}

/**
 * ساخت RoutingResult از LLM
 */
export function createLLMRouting(
    agentType: AgentType,
    confidence: number,
    reason: string,
    latencyMs: number,
    alternatives?: RoutingAlternative[],
): RoutingResult {
    return {
        agentType,
        confidence,
        strategy: "llm",
        reason,
        latencyMs,
        usedFallback: false,
        alternatives: alternatives ?? [],
        signals: [{
            type: "llm-classification",
            value: agentType,
            weight: confidence,
            suggestsAgent: agentType,
        }],
    };
}

/**
 * بررسی آیا باید به LLM fallback کرد
 */
export function shouldFallbackToLLM(
    ruleResult: RoutingResult | null,
    threshold: number,
): boolean {
    if (!ruleResult) return true;
    return ruleResult.confidence < threshold;
}

/**
 * ترکیب سیگنال‌ها و محاسبه score نهایی
 */
export function combineSignals(
    signals: RoutingSignal[],
): Record<AgentType, number> {
    const scores: Record<AgentType, number> = {
        dev: 0,
        gamer: 0,
        companion: 0,
    };

    for (const signal of signals) {
        scores[signal.suggestsAgent] += signal.weight;
    }

    // نرمالایز به 0-1
    const maxScore = Math.max(...Object.values(scores), 0.001);

    for (const agent of Object.keys(scores) as AgentType[]) {
        scores[agent] = Math.round((scores[agent] / maxScore) * 100) / 100;
    }

    return scores;
}

/**
 * تشخیص بلاک کد
 */
export function detectCodeSignal(message: Message): RoutingSignal | null {
    if (!message.hasCode()) return null;

    const primaryLang = message.codeBlocks[0]?.language ?? "unknown";

    return {
        type: "code-block",
        value: primaryLang,
        weight: 0.9,
        suggestsAgent: "dev",
    };
}

/**
 * تشخیص الگوی خطا
 */
export function detectErrorSignal(content: string): RoutingSignal | null {
    const errorPatterns = [
        /error[:\s]/i,
        /exception/i,
        /stack\s?trace/i,
        /undefined is not/i,
        /cannot read propert/i,
        /typeerror/i,
        /syntaxerror/i,
        /خطا/,
        /ارور/,
        /باگ/,
    ];

    for (const pattern of errorPatterns) {
        if (pattern.test(content)) {
            return {
                type: "error-pattern",
                value: pattern.source,
                weight: 0.85,
                suggestsAgent: "dev",
            };
        }
    }

    return null;
}

/**
 * تشخیص keyword
 */
export function detectKeywordSignal(
    content: string,
    keywords: string[],
    agentType: AgentType,
    baseWeight: number = 0.7,
): RoutingSignal[] {
    const signals: RoutingSignal[] = [];
    const lowerContent = content.toLowerCase();

    for (const keyword of keywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
            signals.push({
                type: "keyword",
                value: keyword,
                weight: baseWeight,
                suggestsAgent: agentType,
            });
        }
    }

    return signals;
}

/**
 * تشخیص channel name
 */
export function detectChannelSignal(
    channelName: string,
    mapping: Record<AgentType, string[]>,
): RoutingSignal | null {
    const lowerChannel = channelName.toLowerCase();

    for (const [agent, channels] of Object.entries(mapping)) {
        for (const ch of channels) {
            if (lowerChannel.includes(ch.toLowerCase())) {
                return {
                    type: "channel-name",
                    value: channelName,
                    weight: 0.8,
                    suggestsAgent: agent as AgentType,
                };
            }
        }
    }

    return null;
}