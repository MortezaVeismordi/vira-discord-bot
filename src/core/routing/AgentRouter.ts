// src/core/routing/AgentRouter.ts

import type { Message } from "@/core/domain/entities/Message";
import type { Conversation } from "@/core/domain/entities/Conversation";
import type { AgentType } from "@/core/domain/types/AgentType";
import type { IAgent } from "@/core/contracts/IAgent";
import type {
    IAgentRouter,
    RoutingContext,
    RoutingResult,
    RoutingSignal,
    RoutingRule,
    RouterConfig,
    RouterMetrics,
    AgentSwitchDecision,
} from "@/core/contracts/IAgentRouter";
import {
    createDefaultRouting,
    createRuleBasedRouting,
    combineSignals,
    detectCodeSignal,
} from "@/core/contracts/IAgentRouter";

// ============================================================
// 🧭 AGENT ROUTER - Rule-Based + Hybrid
// ============================================================

/**
 * پیاده‌سازی روتر ترکیبی (Hybrid Router)
 *
 * الگوریتم روتینگ:
 * ۱. تشخیص سیگنال‌های پیام (کلیدواژه‌ها، آی‌دی یا نام کانال، کدهای برنامه‌نویسی، الگوهای خطا)
 * ۲. وزن‌دهی و امتیازدهی به هر یک از ایجنت‌ها
 * ۳. انتخاب ایجنت با بیشترین امتیاز در صورت گذشتن از حد آستانه (Threshold)
 * ۴. در غیر این صورت استفاده از ایجنت پیش‌فرض (Companion)
 */
export class AgentRouter implements IAgentRouter {
    private readonly agents: Map<AgentType, IAgent>;
    private readonly rules: Map<string, RoutingRule> = new Map();
    private readonly keywordMap: Map<AgentType, string[]> = new Map();
    private readonly channelMap: Map<AgentType, string[]> = new Map();
    private readonly cache: Map<string, RoutingResult> = new Map();

    private routerConfig: RouterConfig;

    // ─── متریک‌ها و متغیرهای مانیتورینگ ──────────────────────
    private totalRoutings = 0;
    private ruleBasedCount = 0;
    private fallbackCount = 0;
    private totalLatency = 0;
    private totalConfidence = 0;
    private perAgentCount: Record<AgentType, number> = { dev: 0, gamer: 0, companion: 0 };
    private perAgentConfidence: Record<AgentType, number> = { dev: 0, gamer: 0, companion: 0 };

    constructor(agents: Map<AgentType, IAgent>, config?: Partial<RouterConfig>) {
        this.agents = agents;
        this.routerConfig = {
            strategy: "hybrid",
            ruleConfidenceThreshold: 0.5,
            llmConfidenceThreshold: 0.7,
            defaultAgent: "companion",
            llmTimeout: 5000,
            llmFallbackEnabled: false,
            cachingEnabled: true,
            cacheTTL: 30_000,
            ...config,
        };

        // لود کلیدواژه‌های پیش‌فرض از ایجنت‌ها
        this.initKeywordsFromAgents();
    }

    // ============================================================
    // 🎯 CORE ROUTING
    // ============================================================

    async route(context: RoutingContext): Promise<RoutingResult> {
        const start = Date.now();

        const result = this.routeFast(context) ?? createDefaultRouting(this.routerConfig.defaultAgent);

        const latencyMs = Date.now() - start;
        const finalResult: RoutingResult = { ...result, latencyMs };

        this.trackRouting(finalResult);
        if (this.routerConfig.cachingEnabled) {
            this.cache.set(context.message.id, finalResult);
        }

        return finalResult;
    }

    routeFast(context: RoutingContext): RoutingResult | null {
        const signals = this.detectSignals(
            context.message,
            context.channelName,
            context.conversation,
        );

        if (signals.length === 0) return null;

        const scores = this.scoreAgents(signals);
        const sorted = (Object.entries(scores) as [AgentType, number][])
            .sort(([, a], [, b]) => b - a);

        const [topAgent, topScore] = sorted[0];

        if (topScore < this.routerConfig.ruleConfidenceThreshold) {
            return null;
        }

        const signalDesc = signals
            .slice(0, 3)
            .map((s) => `${s.type}:"${s.value}"`)
            .join(", ");

        return createRuleBasedRouting(
            topAgent,
            topScore,
            `Signals: [${signalDesc}]`,
            signals,
        );
    }

    // بازگردانی حالت پایه برای سازگاری با اینترفیس
    async routeWithLLM(context: RoutingContext): Promise<RoutingResult> {
        return this.route(context);
    }

    // ============================================================
    // 🔍 SIGNAL DETECTION
    // ============================================================

    detectSignals(
        message: Message,
        channelName: string,
        _conversation?: Conversation,
    ): RoutingSignal[] {
        const signals: RoutingSignal[] = [];
        const content = message.content.toLowerCase();

        // ─── ۱. روتینگ جغرافیایی: آی‌دی کانال یا نام کانال (اولویت اول) ───
        for (const [agentType, channels] of this.channelMap) {
            for (const ch of channels) {
                // بررسی مطابقت مطلق با آی‌دی عددی دیسکورد یا شباهت نام کانال
                const isIdMatch = message.channel && message.channel.id === ch;
                const isNameMatch = channelName.toLowerCase().includes(ch.toLowerCase());

                if (isIdMatch || isNameMatch) {
                    signals.push({
                        type: "channel-name",
                        value: isIdMatch ? `ID:${ch}` : channelName,
                        weight: 0.95, // وزن و اولویت بسیار بالا برای هدایت دقیق بر اساس آیدی کانال
                        suggestsAgent: agentType,
                    });
                }
            }
        }

        // ─── ۲. روتینگ معنایی: کلیدواژه‌های فارسی و انگلیسی ──────────────────
        for (const [agentType, keywords] of this.keywordMap) {
            let matchCount = 0;
            const matchedWords: string[] = [];

            // افزودن کلیدواژه‌های تکمیلی فارسی جهت بهبود تشخیص بات
            const combinedKeywords = [...keywords];
            if (agentType === "dev") {
                combinedKeywords.push("خطا", "ارور", "باگ", "کد", "برنامه نویسی", "پایتون", "تایپ اسکریپت", "رن", "کامپایل");
            } else if (agentType === "gamer") {
                combinedKeywords.push("بازی", "ماینکرفت", "گیم", "پینگ", "اف پی اس", "استیم", "پلی");
            }

            for (const kw of combinedKeywords) {
                if (content.includes(kw.toLowerCase())) {
                    matchCount++;
                    matchedWords.push(kw);
                }
            }

            if (matchCount > 0) {
                const weight = Math.min(0.6 + matchCount * 0.1, 0.9);
                signals.push({
                    type: "keyword",
                    value: matchedWords.slice(0, 3).join(", "),
                    weight,
                    suggestsAgent: agentType,
                });
            }
        }

        // ─── ۳. وجود کدهای برنامه‌نویسی (→ DevAgent) ─────────────────────
        const codeSignal = detectCodeSignal(message);
        if (codeSignal) signals.push(codeSignal);

        // ─── ۴. شناسایی الگوهای خطا و استک تریس‌ها (→ DevAgent) ──────────────────
        const errorPatterns = [
            /error[:\s]/i, /exception/i, /باگ/, /خطا/, /ارور/,
            /undefined/i, /cannot read/i, /stack trace/i,
        ];
        if (errorPatterns.some((p) => p.test(message.content))) {
            signals.push({
                type: "error-pattern",
                value: "error detected",
                weight: 0.8,
                suggestsAgent: "dev",
            });
        }

        // ─── ۵. شناسایی ایموجی‌های گیمینگ (→ GamerAgent) ────────
        const gamingEmojis = /[🎮🕹️🏆🎯👾⚔️🏹]/u;
        if (gamingEmojis.test(message.content)) {
            signals.push({
                type: "emoji",
                value: "gaming emoji",
                weight: 0.55,
                suggestsAgent: "gamer",
            });
        }

        return signals;
    }

    scoreAgents(signals: RoutingSignal[]): Record<AgentType, number> {
        return combineSignals(signals);
    }

    // ============================================================
    // 📋 RULE MANAGEMENT
    // ============================================================

    addRule(rule: RoutingRule): void {
        this.rules.set(rule.name, rule);
    }

    removeRule(name: string): boolean {
        return this.rules.delete(name);
    }

    getRules(): RoutingRule[] {
        return [...this.rules.values()];
    }

    toggleRule(name: string, enabled: boolean): boolean {
        const rule = this.rules.get(name);
        if (!rule) return false;
        this.rules.set(name, { ...rule, enabled });
        return true;
    }

    setKeywords(agentType: AgentType, keywords: string[]): void {
        this.keywordMap.set(agentType, keywords);
    }

    getKeywords(agentType: AgentType): string[] {
        return this.keywordMap.get(agentType) ?? [];
    }

    setChannelMapping(agentType: AgentType, channelNames: string[]): void {
        this.channelMap.set(agentType, channelNames);
    }

    getChannelMapping(agentType: AgentType): string[] {
        return this.channelMap.get(agentType) ?? [];
    }

    // ============================================================
    // ⚙️ CONFIG
    // ============================================================

    setConfidenceThreshold(threshold: number): void {
        this.routerConfig = { ...this.routerConfig, ruleConfidenceThreshold: threshold };
    }

    getConfidenceThreshold(): number {
        return this.routerConfig.ruleConfidenceThreshold;
    }

    setDefaultAgent(agentType: AgentType): void {
        this.routerConfig = { ...this.routerConfig, defaultAgent: agentType };
    }

    getDefaultAgent(): AgentType {
        return this.routerConfig.defaultAgent;
    }

    getConfig(): RouterConfig {
        return this.routerConfig;
    }

    updateConfig(config: Partial<RouterConfig>): void {
        this.routerConfig = { ...this.routerConfig, ...config };
    }

    // ============================================================
    // 🔄 CONTEXT-AWARE
    // ============================================================

    shouldSwitchAgent(
        currentAgent: AgentType,
        message: Message,
        conversation: Conversation,
    ): AgentSwitchDecision {
        const signals = this.detectSignals(message, message.channel.name, conversation);
        const scores = this.scoreAgents(signals);
        const topEntry = (Object.entries(scores) as [AgentType, number][])
            .sort(([, a], [, b]) => b - a)[0];

        if (!topEntry) {
            return { switch: false, from: currentAgent, to: currentAgent, reason: "No signal", confidence: 0, signals };
        }

        const [topAgent, topScore] = topEntry;

        if (topAgent !== currentAgent && topScore >= 0.7) {
            return {
                switch: true,
                from: currentAgent,
                to: topAgent,
                reason: `Strong signal for ${topAgent}: ${topScore.toFixed(2)}`,
                confidence: topScore,
                signals,
            };
        }

        return {
            switch: false,
            from: currentAgent,
            to: currentAgent,
            reason: `Staying with ${currentAgent} (score: ${topScore?.toFixed(2) ?? 0})`,
            confidence: scores[currentAgent] ?? 0,
            signals,
        };
    }

    suggestAgentForReply(
        _replyToMessage: Message,
        currentMessage: Message,
    ): AgentType {
        const signals = this.detectSignals(currentMessage, currentMessage.channel.name);
        const scores = this.scoreAgents(signals);
        const top = (Object.entries(scores) as [AgentType, number][])
            .sort(([, a], [, b]) => b - a)[0];
        return top?.[0] ?? this.routerConfig.defaultAgent;
    }

    // ============================================================
    // 💾 CACHE
    // ============================================================

    cacheResult(messageId: string, result: RoutingResult): void {
        this.cache.set(messageId, result);
        setTimeout(() => this.cache.delete(messageId), this.routerConfig.cacheTTL);
    }

    getCachedResult(messageId: string): RoutingResult | undefined {
        return this.cache.get(messageId);
    }

    clearCache(): void {
        this.cache.clear();
    }

    // ============================================================
    // 📊 METRICS & DEBUG
    // ============================================================

    getMetrics(): RouterMetrics {
        const perAgent = {} as Record<AgentType, { count: number; averageConfidence: number }>;

        for (const agent of (["dev", "gamer", "companion"] as AgentType[])) {
            const count = this.perAgentCount[agent];
            perAgent[agent] = {
                count,
                averageConfidence: count > 0
                    ? Math.round((this.perAgentConfidence[agent] / count) * 100) / 100
                    : 0,
            };
        }

        return {
            totalRoutings: this.totalRoutings,
            ruleBasedCount: this.ruleBasedCount,
            llmCount: 0,
            fallbackCount: this.fallbackCount,
            averageLatencyMs: this.totalRoutings > 0
                ? Math.round(this.totalLatency / this.totalRoutings) : 0,
            averageConfidence: this.totalRoutings > 0
                ? Math.round((this.totalConfidence / this.totalRoutings) * 100) / 100 : 0,
            perAgent,
            perStrategy: {
                "rule-based": this.ruleBasedCount,
                "llm": 0,
                "hybrid": this.totalRoutings - this.ruleBasedCount,
            },
            topSignals: [],
        };
    }

    resetMetrics(): void {
        this.totalRoutings = 0;
        this.ruleBasedCount = 0;
        this.fallbackCount = 0;
        this.totalLatency = 0;
        this.totalConfidence = 0;
        this.perAgentCount = { dev: 0, gamer: 0, companion: 0 };
        this.perAgentConfidence = { dev: 0, gamer: 0, companion: 0 };
    }

    async explain(context: RoutingContext): Promise<string> {
        const signals = this.detectSignals(
            context.message,
            context.channelName,
            context.conversation,
        );
        const scores = this.scoreAgents(signals);
        const result = this.routeFast(context);

        const lines: string[] = [
            `🧭 Routing Analysis`,
            `Message: "${context.message.content.slice(0, 50)}..."`,
            `Channel: "${context.channelName}"`,
            ``,
            `Signals Detected (${signals.length}):`,
        ];

        for (const s of signals) {
            lines.push(`  • [${s.type}] "${s.value}" → ${s.suggestsAgent} (w:${s.weight})`);
        }

        lines.push(``, `Scores:`);
        for (const [agent, score] of Object.entries(scores)) {
            lines.push(`  ${agent.padEnd(12)} ${(score * 100).toFixed(0)}%`);
        }

        lines.push(
            ``,
            `Decision: ${result?.agentType ?? "companion"} ` +
            `(confidence: ${((result?.confidence ?? 0.5) * 100).toFixed(0)}%, ` +
            `strategy: ${result?.strategy ?? "fallback"})`,
        );

        return lines.join("\n");
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    private initKeywordsFromAgents(): void {
        for (const [agentType, agent] of this.agents) {
            const keywords = agent.getTriggerKeywords();
            if (keywords.length > 0) {
                this.keywordMap.set(agentType, keywords);
            }
        }
    }

    private trackRouting(result: RoutingResult): void {
        this.totalRoutings++;
        this.totalLatency += result.latencyMs;
        this.totalConfidence += result.confidence;

        if (result.strategy === "rule-based") this.ruleBasedCount++;
        if (result.usedFallback) this.fallbackCount++;

        this.perAgentCount[result.agentType]++;
        this.perAgentConfidence[result.agentType] += result.confidence;
    }
}

// ============================================================
// 🏭 FACTORY
// ============================================================

/**
 * ایجاد سازنده‌ی روتر به صورت امن با متادیتاها
 */
export function createAgentRouter(
    agents: Map<AgentType, IAgent>,
    channelMapping?: Partial<Record<AgentType, string[]>>,
    config?: Partial<RouterConfig>,
): AgentRouter {
    const router = new AgentRouter(agents, config);

    if (channelMapping) {
        for (const [agentType, channels] of Object.entries(channelMapping) as [AgentType, string[]][]) {
            router.setChannelMapping(agentType, channels);
        }
    }

    return router;
}