// src/infrastructure/llm/LLMFactory.ts

import type {
    ILLMPort,
    ILLMPortWithFallback,
    LLMRequest,
    LLMResponse,
    LLMStreamCallbacks,
    LLMStreamController,
    LLMHealthStatus,
    LLMModelInfo,
} from "@/core/contracts/ILLMPort";
import { isRetryableError } from "@/core/contracts/ILLMPort";
import { OllamaClient, createOllamaClient } from "./providers/OllamaClient";
import { OpenRouterClient, createOpenRouterClient } from "./providers/OpenRouterClient";
import type { LLMConfig } from "@/config/schema";

// ============================================================
// 📐 TYPES
// ============================================================

export type ProviderName = "ollama" | "openrouter";

/**
 * آمار هر Provider
 */
interface ProviderStats {
    requests: number;
    errors: number;
}

/**
 * آمار LLMFactory
 */
export interface LLMFactoryStats {
    readonly activeProvider: ProviderName;
    readonly fallbackCount: number;
    readonly totalRequests: number;
    readonly providerSwitchCount: number;
    readonly perProvider: Record<ProviderName, {
        requests: number;
        errors: number;
        available: boolean;
        registered: boolean;
    }>;
}

// ============================================================
// 🏭 LLM FACTORY
// ============================================================

/**
 * Factory و Manager برای LLM Providers
 *
 * مسئولیت‌ها:
 * - ساخت client مناسب بر اساس config
 * - سوئیچ خودکار بین providers (fallback)
 * - مدیریت health check
 * - انتخاب مدل بر اساس purpose
 * - ارائه interface یکپارچه
 *
 * ```
 * LLMFactory (ILLMPortWithFallback)
 *     │
 *     ├── OllamaClient (primary / local)
 *     │   └── http://localhost:11434
 *     │       └── llama3.1:8b
 *     │
 *     └── OpenRouterClient (fallback / cloud)
 *         └── https://openrouter.ai/api/v1
 *             ├── heavy: qwen-coder-32b
 *             ├── light: llama-3.1-8b:free
 *             └── routing: llama-3.1-8b:free
 * ```
 *
 * @example
 * ```typescript
 * const llm = await createLLMFactory(llmConfig);
 *
 * // ساده‌ترین استفاده
 * const response = await llm.generate({
 *   messages: [{ role: "user", content: "سلام" }],
 * });
 *
 * // با مدل مناسب
 * const codeResponse = await llm.generate({
 *   messages: [...],
 *   model: llm.getModelForPurpose("heavy"),
 * });
 *
 * // با fallback خودکار
 * const safeResponse = await llm.generateWithFallback(request);
 *
 * // استریم برای TTS
 * const controller = await llm.stream(request, {
 *   onChunk: (chunk) => { ... },
 *   onSentence: (s) => { tts.speak(s) },
 * });
 * ```
 */
export class LLMFactory implements ILLMPortWithFallback {
    private readonly config: LLMConfig;
    private readonly providers: Map<ProviderName, ILLMPort>;

    // ─── State ───────────────────────────────────────────
    private activeProvider: ProviderName;
    private initialized: boolean = false;

    // ─── Tracking ────────────────────────────────────────
    private fallbackCount: number = 0;
    private totalRequests: number = 0;
    private providerSwitchCount: number = 0;
    private perProviderStats: Map<ProviderName, ProviderStats>;

    constructor(config: LLMConfig) {
        this.config = config;
        this.providers = new Map();
        this.perProviderStats = new Map();
        this.activeProvider = config.defaultProvider as ProviderName;
    }

    // ============================================================
    // 🚀 INITIALIZATION
    // ============================================================

    /**
     * مقداردهی اولیه providers
     *
     * @example
     * ```typescript
     * const factory = new LLMFactory(llmConfig);
     * await factory.initialize();
     * // [LLMFactory] Ollama registered: http://localhost:11434 (llama3.1:8b)
     * // [LLMFactory] OpenRouter registered: https://openrouter.ai/api/v1
     * // [LLMFactory] Ready! Active: ollama (45ms)
     * ```
     */
    async initialize(): Promise<void> {
        // ─── Ollama ──────────────────────────────────────────
        if (this.config.ollama.enabled) {
            const ollama = createOllamaClient({
                host: this.config.ollama.host,
                model: this.config.ollama.model,
                timeout: this.config.ollama.timeout,
                keepAlive: this.config.ollama.keepAlive,
                maxTokens: this.config.generation.maxTokens,
                temperature: this.config.generation.temperature,
            });

            this.providers.set("ollama", ollama);
            this.perProviderStats.set("ollama", { requests: 0, errors: 0 });

            console.log(
                `[LLMFactory] Ollama registered: ${this.config.ollama.host} ` +
                `(${this.config.ollama.model})`,
            );
        }

        // ─── OpenRouter ──────────────────────────────────────
        if (this.config.openRouter.enabled && this.config.openRouter.apiKey) {
            const openRouter = createOpenRouterClient({
                apiKey: this.config.openRouter.apiKey,
                baseUrl: this.config.openRouter.baseUrl,
                models: this.config.openRouter.models,
                maxTokens: this.config.generation.maxTokens,
                temperature: this.config.generation.temperature,
                rateLimit: this.config.openRouter.rateLimit,
            });

            this.providers.set("openrouter", openRouter);
            this.perProviderStats.set("openrouter", { requests: 0, errors: 0 });

            console.log(
                `[LLMFactory] OpenRouter registered: ${this.config.openRouter.baseUrl} ` +
                `(heavy: ${this.config.openRouter.models.heavy}, ` +
                `light: ${this.config.openRouter.models.light})`,
            );
        }

        // ─── Validation ──────────────────────────────────────
        if (this.providers.size === 0) {
            throw new Error(
                "[LLMFactory] No LLM providers configured! " +
                "Enable at least one of: ollama, openrouter",
            );
        }

        // ─── Health Check اولیه ──────────────────────────────
        await this.performInitialHealthCheck();

        this.initialized = true;
    }

    /**
     * Health check اولیه و fallback خودکار
     */
    private async performInitialHealthCheck(): Promise<void> {
        const primaryHealth = await this.healthCheck().catch(() => null);

        if (primaryHealth?.isAvailable) {
            console.log(
                `[LLMFactory] Ready! Active: ${this.activeProvider} ` +
                `(${primaryHealth.latencyMs}ms)`,
            );
            return;
        }

        console.warn(
            `[LLMFactory] Primary provider "${this.activeProvider}" is not available!`,
        );

        // تلاش برای fallback
        const fallbackName = this.config.fallbackProvider as ProviderName | undefined;

        if (!fallbackName || !this.providers.has(fallbackName)) {
            console.error(
                `[LLMFactory] No fallback provider available. ` +
                `System will retry on first request.`,
            );
            return;
        }

        const fallbackClient = this.providers.get(fallbackName)!;
        const fallbackHealth = await fallbackClient
            .healthCheck()
            .catch(() => null);

        if (fallbackHealth?.isAvailable) {
            const previous = this.activeProvider;
            this.activeProvider = fallbackName;
            this.providerSwitchCount++;

            console.log(
                `[LLMFactory] Switched to fallback: ${previous} → ${fallbackName} ` +
                `(${fallbackHealth.latencyMs}ms)`,
            );
        } else {
            console.error(
                `[LLMFactory] Both providers unavailable! ` +
                `Primary: ${this.activeProvider}, Fallback: ${fallbackName}`,
            );
        }
    }

    // ============================================================
    // 🎯 ILLMPort IMPLEMENTATION
    // ============================================================

    async generate(request: LLMRequest): Promise<LLMResponse> {
        this.ensureInitialized();

        const provider = this.getActiveClient();

        this.totalRequests++;
        this.trackRequest(this.activeProvider);

        try {
            return await provider.generate(request);
        } catch (error) {
            this.trackError(this.activeProvider);
            throw error;
        }
    }

    async stream(
        request: LLMRequest,
        callbacks: LLMStreamCallbacks,
    ): Promise<LLMStreamController> {
        this.ensureInitialized();

        const provider = this.getActiveClient();

        this.totalRequests++;
        this.trackRequest(this.activeProvider);

        try {
            return await provider.stream(request, callbacks);
        } catch (error) {
            this.trackError(this.activeProvider);
            throw error;
        }
    }

    async healthCheck(): Promise<LLMHealthStatus> {
        const provider = this.providers.get(this.activeProvider);

        if (!provider) {
            return {
                provider: this.activeProvider,
                isAvailable: false,
                error: `Provider "${this.activeProvider}" is not registered`,
                lastChecked: new Date(),
            };
        }

        return provider.healthCheck();
    }

    async listModels(): Promise<LLMModelInfo[]> {
        const allModels: LLMModelInfo[] = [];

        for (const [, provider] of this.providers) {
            const models = await provider.listModels().catch(() => []);
            allModels.push(...models);
        }

        return allModels;
    }

    getCurrentModel(): LLMModelInfo {
        return this.getActiveClient().getCurrentModel();
    }

    getProvider(): string {
        return this.activeProvider;
    }

    async isAvailable(): Promise<boolean> {
        const health = await this.healthCheck();
        return health.isAvailable;
    }

    // ============================================================
    // 🔄 ILLMPortWithFallback IMPLEMENTATION
    // ============================================================

    /**
     * تولید پاسخ با fallback خودکار
     *
     * @example
     * ```typescript
     * // اول Ollama → اگر خراب بود → OpenRouter
     * const response = await llm.generateWithFallback(request);
     * ```
     */
    async generateWithFallback(request: LLMRequest): Promise<LLMResponse> {
        this.ensureInitialized();

        try {
            return await this.generate(request);
        } catch (error: any) {
            // اگر retryable نیست یا fallback نداریم → throw
            if (!this.canFallback(error)) {
                throw error;
            }

            return this.executeWithFallback(
                (provider) => provider.generate(request),
                "generate",
            );
        }
    }

    /**
     * استریم با fallback خودکار
     */
    async streamWithFallback(
        request: LLMRequest,
        callbacks: LLMStreamCallbacks,
    ): Promise<LLMStreamController> {
        this.ensureInitialized();

        try {
            return await this.stream(request, callbacks);
        } catch (error: any) {
            if (!this.canFallback(error)) {
                throw error;
            }

            return this.executeWithFallback(
                (provider) => provider.stream(request, callbacks),
                "stream",
            );
        }
    }

    /**
     * سوئیچ دستی به provider دیگه
     *
     * @example
     * ```typescript
     * llm.switchProvider("openrouter");
     * // [LLMFactory] Provider switched: ollama → openrouter
     * ```
     */
    switchProvider(provider: ProviderName): void {
        if (!this.providers.has(provider)) {
            throw new Error(
                `Provider "${provider}" is not registered. ` +
                `Available: ${this.getRegisteredProviders().join(", ")}`,
            );
        }

        const previous = this.activeProvider;
        if (previous === provider) return;

        this.activeProvider = provider;
        this.providerSwitchCount++;

        console.log(
            `[LLMFactory] Provider switched: ${previous} → ${provider}`,
        );
    }

    /**
     * پروایدر فعلی
     */
    getActiveProvider(): ProviderName {
        return this.activeProvider;
    }

    /**
     * سلامت همه پروایدرها
     *
     * @example
     * ```typescript
     * const health = await llm.healthCheckAll();
     * // {
     * //   ollama: { isAvailable: true, latencyMs: 45 },
     * //   openrouter: { isAvailable: true, latencyMs: 320 },
     * // }
     * ```
     */
    async healthCheckAll(): Promise<Record<string, LLMHealthStatus>> {
        const results: Record<string, LLMHealthStatus> = {};

        const checks = [...this.providers.entries()].map(
            async ([name, provider]) => {
                results[name] = await provider.healthCheck().catch((error) => ({
                    provider: name,
                    isAvailable: false,
                    error: error.message,
                    lastChecked: new Date(),
                }));
            },
        );

        await Promise.allSettled(checks);

        return results;
    }

    // ============================================================
    // 🎯 MODEL SELECTION
    // ============================================================

    /**
     * دریافت مدل مناسب بر اساس نوع کار
     *
     * اگر OpenRouter فعاله → از مدل‌های مختلفش استفاده می‌کنه
     * اگر فقط Ollama داریم → همون مدل واحد
     *
     * @example
     * ```typescript
     * // DevAgent → مدل سنگین (qwen-coder-32b)
     * const model = llm.getModelForPurpose("heavy");
     *
     * // CompanionAgent → مدل سبک (llama-3.1-8b)
     * const model = llm.getModelForPurpose("light");
     *
     * // Router → مدل سریع و ارزون
     * const model = llm.getModelForPurpose("routing");
     *
     * // استفاده
     * const response = await llm.generate({
     *   messages: [...],
     *   model: llm.getModelForPurpose("heavy"),
     * });
     * ```
     */
    getModelForPurpose(purpose: "heavy" | "light" | "routing"): string {
        // اگر OpenRouter فعال و ثبت شده
        const openRouter = this.providers.get("openrouter");
        if (openRouter instanceof OpenRouterClient) {
            return openRouter.getModel(purpose);
        }

        // Fallback: Ollama فقط یک مدل داره
        return this.config.ollama.model;
    }

    /**
     * دریافت بهترین provider برای یک purpose خاص
     *
     * @example
     * ```typescript
     * // کدنویسی → ترجیحاً OpenRouter (مدل قوی‌تر)
     * const provider = llm.getBestProviderFor("heavy");
     *
     * // چت ساده → ترجیحاً Ollama (سریع‌تر، رایگان)
     * const provider = llm.getBestProviderFor("light");
     * ```
     */
    getBestProviderFor(purpose: "heavy" | "light" | "routing"): ProviderName {
        switch (purpose) {
            case "heavy":
                // برای کارهای سنگین، OpenRouter بهتره (مدل‌های بزرگ‌تر)
                if (this.providers.has("openrouter")) return "openrouter";
                return "ollama";

            case "light":
                // برای چت ساده، Ollama بهتره (سریع‌تر، بدون latency شبکه)
                if (this.providers.has("ollama")) return "ollama";
                return "openrouter";

            case "routing":
                // برای routing، سریع‌ترین (Ollama لوکال)
                if (this.providers.has("ollama")) return "ollama";
                return "openrouter";

            default:
                return this.activeProvider;
        }
    }

    /**
     * تولید پاسخ با provider بهینه برای purpose
     *
     * @example
     * ```typescript
     * // خودکار بهترین provider و مدل رو انتخاب می‌کنه
     * const response = await llm.generateForPurpose(request, "heavy");
     * ```
     */
    async generateForPurpose(
        request: LLMRequest,
        purpose: "heavy" | "light" | "routing",
    ): Promise<LLMResponse> {
        this.ensureInitialized();

        const bestProvider = this.getBestProviderFor(purpose);
        const client = this.providers.get(bestProvider);

        if (!client) {
            // fallback به active provider
            return this.generate({
                ...request,
                model: this.getModelForPurpose(purpose),
            });
        }

        const model = this.getModelForPurpose(purpose);

        this.totalRequests++;
        this.trackRequest(bestProvider);

        try {
            return await client.generate({
                ...request,
                model,
            });
        } catch (error) {
            this.trackError(bestProvider);

            // fallback
            if (this.canFallback(error)) {
                return this.executeWithFallback(
                    (provider) => provider.generate({ ...request, model }),
                    `generateForPurpose:${purpose}`,
                );
            }

            throw error;
        }
    }

    // ============================================================
    // 📊 STATS & INFO
    // ============================================================

    /**
     * آمار factory
     */
    getStats(): LLMFactoryStats {
        const perProvider: Record<string, any> = {};

        const allProviders: ProviderName[] = ["ollama", "openrouter"];

        for (const name of allProviders) {
            const stats = this.perProviderStats.get(name);
            perProvider[name] = {
                requests: stats?.requests ?? 0,
                errors: stats?.errors ?? 0,
                available: this.providers.has(name),
                registered: this.providers.has(name),
            };
        }

        return {
            activeProvider: this.activeProvider,
            fallbackCount: this.fallbackCount,
            totalRequests: this.totalRequests,
            providerSwitchCount: this.providerSwitchCount,
            perProvider: perProvider as LLMFactoryStats["perProvider"],
        };
    }

    /**
     * لیست providers ثبت شده
     */
    getRegisteredProviders(): ProviderName[] {
        return [...this.providers.keys()];
    }

    /**
     * آیا provider خاصی ثبت شده؟
     */
    hasProvider(name: ProviderName): boolean {
        return this.providers.has(name);
    }

    /**
     * دسترسی مستقیم به یک provider خاص
     *
     * @example
     * ```typescript
     * const ollama = llm.getProviderClient("ollama");
     * if (ollama) {
     *   const health = await ollama.healthCheck();
     * }
     * ```
     */
    getProviderClient(name: ProviderName): ILLMPort | undefined {
        return this.providers.get(name);
    }

    /**
     * دسترسی به OpenRouterClient (برای rate limit state)
     */
    getOpenRouterClient(): OpenRouterClient | undefined {
        const client = this.providers.get("openrouter");
        if (client instanceof OpenRouterClient) return client;
        return undefined;
    }

    /**
     * آیا factory آماده‌ست؟
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Debug view
     */
    toDebugView(): string {
        const stats = this.getStats();
        const lines: string[] = [
            "┌──────────────────────────────────────────┐",
            "│         🏭 LLM FACTORY DEBUG             │",
            "├──────────────────────────────────────────┤",
            `│ Active Provider: ${stats.activeProvider.padEnd(22)}│`,
            `│ Total Requests:  ${String(stats.totalRequests).padEnd(22)}│`,
            `│ Fallback Count:  ${String(stats.fallbackCount).padEnd(22)}│`,
            `│ Switch Count:    ${String(stats.providerSwitchCount).padEnd(22)}│`,
            "├──────────────────────────────────────────┤",
            "│ Providers:                               │",
        ];

        for (const [name, info] of Object.entries(stats.perProvider)) {
            const status = info.registered
                ? (name === stats.activeProvider ? "🟢 active" : "🟡 standby")
                : "⚫ disabled";

            lines.push(
                `│   ${name.padEnd(12)} ${status.padEnd(12)} ` +
                `R:${String(info.requests).padEnd(4)} E:${String(info.errors).padEnd(4)}│`,
            );
        }

        lines.push("├──────────────────────────────────────────┤");
        lines.push("│ Models:                                  │");

        const heavy = this.getModelForPurpose("heavy");
        const light = this.getModelForPurpose("light");
        const routing = this.getModelForPurpose("routing");

        lines.push(`│   heavy:   ${heavy.slice(0, 28).padEnd(28)}│`);
        lines.push(`│   light:   ${light.slice(0, 28).padEnd(28)}│`);
        lines.push(`│   routing: ${routing.slice(0, 28).padEnd(28)}│`);

        lines.push("└──────────────────────────────────────────┘");

        return lines.join("\n");
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    /**
     * دریافت client فعال
     */
    private getActiveClient(): ILLMPort {
        const client = this.providers.get(this.activeProvider);

        if (!client) {
            throw new Error(
                `Active provider "${this.activeProvider}" is not registered. ` +
                `Available: ${this.getRegisteredProviders().join(", ")}`,
            );
        }

        return client;
    }

    /**
     * آیا می‌تونیم fallback کنیم؟
     */
    private canFallback(error: any): boolean {
        // fallback provider تنظیم شده؟
        if (!this.config.fallbackProvider) return false;

        const fallbackName = this.config.fallbackProvider as ProviderName;

        // fallback provider ثبت شده؟
        if (!this.providers.has(fallbackName)) return false;

        // همون provider فعلی نباشه
        if (fallbackName === this.activeProvider) return false;

        // خطا retryable باشه
        if (error && typeof error === "object" && "retryable" in error) {
            return error.retryable === true;
        }

        // Default: اجازه fallback بده
        return true;
    }

    /**
     * اجرا با fallback provider
     */
    private async executeWithFallback<T>(
        fn: (provider: ILLMPort) => Promise<T>,
        context: string,
    ): Promise<T> {
        const fallbackName = this.config.fallbackProvider as ProviderName;
        const fallbackClient = this.providers.get(fallbackName);

        if (!fallbackClient) {
            throw new Error(
                `Fallback provider "${fallbackName}" is not registered`,
            );
        }

        this.fallbackCount++;
        this.trackRequest(fallbackName);

        console.warn(
            `[LLMFactory] Fallback activated: ${this.activeProvider} → ${fallbackName} ` +
            `(${context}) [total fallbacks: ${this.fallbackCount}]`,
        );

        try {
            return await fn(fallbackClient);
        } catch (error) {
            this.trackError(fallbackName);
            throw error;
        }
    }

    /**
     * چک initialization
     */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                "[LLMFactory] Not initialized! Call await factory.initialize() first.",
            );
        }
    }

    /**
     * ثبت request
     */
    private trackRequest(provider: ProviderName): void {
        const stats = this.perProviderStats.get(provider);
        if (stats) stats.requests++;
    }

    /**
     * ثبت error
     */
    private trackError(provider: ProviderName): void {
        const stats = this.perProviderStats.get(provider);
        if (stats) stats.errors++;
    }
}

// ============================================================
// 🏭 FACTORY FUNCTION
// ============================================================

/**
 * ساخت و مقداردهی LLMFactory
 *
 * @example
 * ```typescript
 * import { llmConfig } from "@/config";
 *
 * const llm = await createLLMFactory(llmConfig);
 *
 * // ساده
 * const response = await llm.generate({
 *   messages: [{ role: "user", content: "سلام" }],
 * });
 *
 * // با model selection
 * const codeResponse = await llm.generateForPurpose(request, "heavy");
 *
 * // با fallback
 * const safeResponse = await llm.generateWithFallback(request);
 *
 * // Debug
 * console.log(llm.toDebugView());
 * ```
 */
export async function createLLMFactory(
    config: LLMConfig,
): Promise<LLMFactory> {
    const factory = new LLMFactory(config);
    await factory.initialize();
    return factory;
}