// src/config/index.ts

import { loadConfig } from "./env";
import { SYSTEM_LIMITS } from "./defaults";
import type { Config } from "./schema";

// ============================================================
// 🔒 SINGLETON - یک بار load، همه جا استفاده
// ============================================================

let _config: Config | null = null;

function getConfig(): Config {
    if (!_config) {
        _config = loadConfig();
    }
    return _config;
}

// ============================================================
// 📦 MAIN EXPORT - تنها چیزی که بقیه فایل‌ها import می‌کنند
// ============================================================

export const config = getConfig();

// ============================================================
// 🔑 NAMED EXPORTS - برای دسترسی راحت‌تر
// ============================================================

export const discordConfig = config.discord;
export const llmConfig = config.llm;
export const voiceConfig = config.voice;
export const memoryConfig = config.memory;
export const agentsConfig = config.agents;
export const personalityConfig = config.personality;
export const observability = config.observability;

// ─── SYSTEM_LIMITS هم از همینجا ──────────────────────────
export { SYSTEM_LIMITS } from "./defaults";

// ─── Types هم از همینجا ───────────────────────────────────
export type {
    Config,
    DiscordConfig,
    LLMConfig,
    VoiceConfig,
    MemoryConfig,
    AgentsConfig,
    PersonalityConfig,
    ObservabilityConfig,
} from "./schema";

// ============================================================
// 🛠️ HELPERS - shortcutهای پرکاربرد
// ============================================================

// LLM
export const isOllamaEnabled = config.llm.ollama.enabled;
export const isOpenRouterEnabled = config.llm.openRouter.enabled;
export const defaultLLMProvider = config.llm.defaultProvider;

// Voice
export const isVoiceEnabled = config.voice.enabled;
export const ttsProvider = config.voice.tts.provider;
export const sttProvider = config.voice.stt.provider;

// Agents
export const routingStrategy = config.agents.routing.strategy;
export const defaultAgent = "companion" as const;

// Env
export const isDevelopment = config.env === "development";
export const isProduction = config.env === "production";
export const isTest = config.env === "test";