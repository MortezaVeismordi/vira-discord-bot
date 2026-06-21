// src/index.ts

// اولویت اول: مقداردهی به متغیرهای محیطی قبل از لود شدن هرگونه کانفیگ
import dotenv from "dotenv";
dotenv.config();

import { config, isDevelopment } from "@/config";
import { createEventBus } from "@/infrastructure/events/NodeEventBus";
import { createLLMFactory } from "@/infrastructure/llm/LLMFactory";
import { createStorageInstances } from "@/infrastructure/context/storage/FileStorage";
import { createContextManager } from "@/infrastructure/context/managers/ContextManager";
import { createAgentRouter } from "@/core/routing/AgentRouter";
import { AgentOrchestrator } from "@/core/orchestration/AgentOrchestrator";
import { DiscordClient } from "@/infrastructure/discord/DiscordClient";
import { GamerAgent } from "@/core/agents/GamerAgent";
import { DevAgent } from "@/core/agents/DevAgent";
import { CompanionAgent } from "@/core/agents/CompanionAgent";
import type { AgentType } from "@/core/domain/types/AgentType";
import type { IAgent } from "@/core/contracts/IAgent";

// ============================================================
// 🚀 BOOTSTRAP SYSTEM
// ============================================================

async function bootstrap(): Promise<void> {
    console.log("[Vira] Starting...");

    // ─── 🛠️ پچ کاملاً پویا بدون هاردکد ───
    // در این بخش مقدار پرووایدر دقیقاً و کاملاً داینامیک از فایل .env خوانده شده و به کانفیگ تزریق می‌شود.
    const rawLlmConfig = config.llm || {};
    const envProvider = process.env.LLM_PROVIDER;

    const llmConfig = {
        ...rawLlmConfig,
        defaultProvider: (envProvider || rawLlmConfig.defaultProvider || "ollama") as "ollama" | "openrouter",
    };

    console.log("[Vira System] Dynamic Config Initialized:", {
        activeProvider: llmConfig.defaultProvider,
        loadedFromEnv: !!envProvider
    });

    // ─── ۱. ساخت یا دریافت باس رویدادها (EventBus) ────────────────────
    const eventBus = createEventBus({ debug: isDevelopment });

    // ─── ۲. ایجاد کانکتور مدل‌های زبانی با کانفیگ اصلاح شده ─────────────────
    const llm = await createLLMFactory(llmConfig);

    // ─── ۳. ایجاد لایه فایلی استوریج برای متن‌ها و پرامپت‌ها ───────────────
    const storages = createStorageInstances({
        runtimeDir: "./runtime",
        promptsDir: "./prompts",
    });

    // ─── ۴. تنظیم و پیکربندی نمونه‌های ایجنت ──────────────────────────
    const deps = {
        llm,
        toolRegistry: null,
        prompts: storages.prompts,
        eventBus,
    };

    const agents = new Map<AgentType, IAgent>([
        ["gamer", new GamerAgent(deps)],
        ["dev", new DevAgent(deps)],
        ["companion", new CompanionAgent(deps)],
    ]);

    // ─── ۵. تنظیم مپ کانال‌ها بر اساس متغیرهای محیطی لود شده ───────────
    const channelMapping: Partial<Record<AgentType, string[]>> = {
        dev: config.discord.channels.dev,
        gamer: config.discord.channels.gamer,
        companion: config.discord.channels.companion,
    };

    // ─── ۶. ساخت نمونه کلاس روتر ───────────────────────────────
    const router = createAgentRouter(agents, channelMapping);

    // ─── ۷. ایجاد ابزار مدیریت حافظه (ContextManager) ─────────────────
    const contextManager = createContextManager({
        storage: storages.contexts,
        llm,
        eventBus,
        memoryConfig: config.memory,
    });

    // ─── ۸. راه‌اندازی ارکستریتور و پاس دادن آیدی دیسکورد مرتضی ───────────
    const orchestrator = new AgentOrchestrator(
        eventBus,
        router,
        agents,
        contextManager,
        {
            debug: isDevelopment,
            saveContextAfterResponse: true,
            sendFallbackOnError: true,
            mortezaId: process.env.MORTEZA_ID || undefined, // لود مستقیم آیدی مرتضی از env
        },
    );
    orchestrator.start();

    // ─── ۹. روشن کردن نهایی و استارت کلاینت دیسکورد ────────────────────
    const discord = new DiscordClient(config.discord.token, eventBus);
    await discord.start();

    console.log("[Vira] Ready ✓");

    // ─── ۱۰. خاموش کردن امن بات (Graceful Shutdown) ───────────────────
    const shutdown = async (signal: string): Promise<void> => {
        console.log(`\n[Vira] ${signal} received — shutting down...`);
        orchestrator.stop();
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
    console.error("[Vira] Fatal error during bootstrap:", err);
    process.exit(1);
});