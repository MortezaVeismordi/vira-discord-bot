// src/config/defaults.ts

import type {
    DiscordConfig,
    LLMConfig,
    VoiceConfig,
    MemoryConfig,
    AgentsConfig,
    PersonalityConfig,
    ObservabilityConfig,
    Config,
} from "./schema";

// ============================================================
// 🤖 DISCORD DEFAULTS
// ============================================================

export const DISCORD_DEFAULTS: Partial<DiscordConfig> = {
    channels: {
        dev: ["dev", "coding", "debug", "برنامه‌نویسی", "کد"],
        gamer: ["gaming", "game", "minecraft", "گیمینگ", "بازی"],
        companion: ["general", "chat", "عمومی", "گپ"],
    },

    presence: {
        status: "online",
        activityType: "PLAYING",
        activityName: "با دوستام 🎮",
    },
} as const;

// ============================================================
// 🧠 LLM DEFAULTS
// ============================================================

export const LLM_DEFAULTS: Partial<LLMConfig> = {
    // اول Local، بعد Cloud
    defaultProvider: "ollama",
    fallbackProvider: "openrouter",

    ollama: {
        enabled: true,
        host: "http://localhost:11434",
        model: "llama3.1:8b",
        timeout: 30_000,
        keepAlive: "5m",
    },

    openRouter: {
        enabled: false,
        baseUrl: "https://openrouter.ai/api/v1",
        models: {
            // کدنویسی → مدل سنگین
            heavy: "qwen/qwen-2.5-coder-32b-instruct",
            // مکالمه → مدل سبک
            light: "meta-llama/llama-3.1-8b-instruct:free",
            // روتینگ → سریع و ارزون
            routing: "meta-llama/llama-3.1-8b-instruct:free",
        },
        rateLimit: {
            requestsPerMinute: 20,
            tokensPerMinute: 100_000,
        },
    },

    generation: {
        maxTokens: 2048,
        temperature: 0.7,
        streamingEnabled: true,
        streamChunkSize: 10,
    },
} as const;

// ============================================================
// 🎙️ VOICE DEFAULTS
// ============================================================

export const VOICE_DEFAULTS: Partial<VoiceConfig> = {
    // opt-in - کاربر باید خودش فعال کند
    enabled: false,

    vad: {
        enabled: true,
        provider: "silero",
        silenceThreshold: 0.5,
        // حداقل ۲۵۰ms گفتار تا شروع به پردازش
        minSpeechDuration: 250,
        // بعد از ۱.۵ ثانیه سکوت، گفتار تموم شده
        silenceDuration: 1500,
    },

    stt: {
        provider: "whisper-local",
        whisper: {
            // base = تعادل بین سرعت و دقت
            model: "base",
            language: "fa",
            device: "cpu",
        },
        deepgram: {
            model: "nova-2",
            language: "fa",
        },
    },

    tts: {
        // edge-tts = رایگان + فارسی خوب + بدون نیاز به API
        provider: "edge-tts",

        streaming: {
            enabled: true,
            // این کاراکترها = پایان یک chunk
            sentenceBreakers: [".", "!", "?", "،", "؟", "\n", "..."],
            // حداقل ۲۰ کاراکتر تا chunk ارسال بشه
            minChunkLength: 20,
        },

        elevenlabs: {
            modelId: "eleven_multilingual_v2",
            stability: 0.5,
            similarityBoost: 0.75,
        },

        piper: {
            executablePath: "piper",
            sampleRate: 22_050,
        },

        edgeTTS: {
            // بهترین صدای فارسی در Edge TTS
            voice: "fa-IR-DilaraNeural",
            rate: "+0%",
            volume: "+0%",
            pitch: "+0Hz",
        },
    },
} as const;

// ============================================================
// 💾 MEMORY DEFAULTS
// ============================================================

export const MEMORY_DEFAULTS: Partial<MemoryConfig> = {
    contextDirectory: "./runtime/contexts",

    // ~4096 توکن = تقریباً ۱۶ هزار کاراکتر
    // کافیه برای یک مکالمه کامل بدون گم شدن اطلاعات
    maxContextTokens: 4096,
    maxContextMessages: 50,

    summarization: {
        enabled: true,
        // وقتی به ۴۰ پیام رسید، خلاصه کن
        triggerAtMessages: 40,
        // اما ۱۰ پیام آخر رو دست نزن
        keepRecentMessages: 10,
    },

    sections: {
        userProfile: true,
        conversationHistory: true,
        pinnedFacts: true,
        sessionSummaries: true,
        relationshipStatus: true,
    },

    persistence: "file",
} as const;

// ============================================================
// 🤖 AGENTS DEFAULTS
// ============================================================

export const AGENTS_DEFAULTS: Partial<AgentsConfig> = {
    routing: {
        // Hybrid = اول Rule-based، بعد LLM اگر مطمئن نبود
        strategy: "hybrid",
        llmFallbackEnabled: true,
        // اگر LLM زیر ۷۰٪ مطمئن بود، Companion انتخاب شود
        confidenceThreshold: 0.7,
    },

    dev: {
        enabled: true,
        triggerKeywords: [
            // فارسی
            "باگ", "خطا", "کد", "دیباگ", "داکر",
            "دیتابیس", "سرور", "ای‌پی‌آی",
            // انگلیسی
            "bug", "error", "code", "debug",
            "docker", "database", "api", "git",
            "typescript", "javascript", "python",
            // نشانه‌های کد
            "```", "undefined", "null", "exception",
            "stack trace", "stacktrace",
        ],
        // کدنویسی → همیشه مدل قوی‌تر
        preferredModel: "heavy",
    },

    gamer: {
        enabled: true,
        triggerKeywords: [
            // فارسی
            "ماینکرفت", "بازی", "گیم", "ماین",
            "مپ", "سرور", "بیوم", "ماد", "کرفت",
            // انگلیسی
            "minecraft", "game", "gaming", "mods",
            "biome", "redstone", "creeper", "nether",
            "enderdragon", "spawn", "pvp", "survival",
        ],
        preferredModel: "light",
    },

    companion: {
        enabled: true,
        // اگر هیچ‌کدام match نشد، ویرا به عنوان دوست‌دختر جواب بده
        isDefaultAgent: true,
        preferredModel: "light",
    },
} as const;

// ============================================================
// 💚 PERSONALITY DEFAULTS
// ============================================================

export const PERSONALITY_DEFAULTS: Partial<PersonalityConfig> = {
    name: "ویرا",

    // پرانرژی به عنوان حالت پایه
    defaultMood: "energetic",

    // ۶ از ۱۰ = شوخ هست ولی کنترل‌شده
    teasingLevel: 6,

    // casual = رفیقونه، بدون فاصله
    languageStyle: "casual",

    useEmojis: true,

    // balanced = نه خیلی کوتاه نه خیلی بلند
    responseLength: "balanced",
} as const;

// ============================================================
// 📊 OBSERVABILITY DEFAULTS
// ============================================================

export const OBSERVABILITY_DEFAULTS: Partial<ObservabilityConfig> = {
    logging: {
        level: "info",
        directory: "./runtime/logs",
        // در production غیرفعال
        prettyPrint: false,
        // ۷ روز لاگ نگه دار
        maxFiles: 7,
    },

    metrics: {
        enabled: true,
        directory: "./runtime/metrics",
        // هر ۶۰ ثانیه متریک‌ها رو flush کن
        flushInterval: 60_000,

        track: {
            llmLatency: true,
            llmTokens: true,
            sttLatency: true,
            ttsLatency: true,
            agentSelection: true,
            routingDecisions: true,
        },
    },
} as const;

// ============================================================
// 🌍 ROOT DEFAULTS
// ============================================================

export const DEFAULT_CONFIG: Partial<Config> = {
    env: "development",
    discord: DISCORD_DEFAULTS as DiscordConfig,
    llm: LLM_DEFAULTS as LLMConfig,
    voice: VOICE_DEFAULTS as VoiceConfig,
    memory: MEMORY_DEFAULTS as MemoryConfig,
    agents: AGENTS_DEFAULTS as AgentsConfig,
    personality: PERSONALITY_DEFAULTS as PersonalityConfig,
    observability: OBSERVABILITY_DEFAULTS as ObservabilityConfig,
} as const;

// ============================================================
// 📐 LIMITS - Constants که کل سیستم بهشون وابسته‌ست
// ============================================================

export const SYSTEM_LIMITS = {
    // ─── Context ───────────────────────────────────────────
    MAX_CONTEXT_TOKENS: 4096,
    MAX_CONTEXT_MESSAGES: 50,
    MAX_PINNED_FACTS: 20,
    MAX_SUMMARY_LENGTH: 500,
    SUMMARIZE_AT_MESSAGES: 40,
    KEEP_RECENT_MESSAGES: 10,

    // ─── LLM ───────────────────────────────────────────────
    MAX_TOKENS_PER_REQUEST: 2048,
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    LLM_TIMEOUT_MS: 30_000,

    // ─── Voice ─────────────────────────────────────────────
    MAX_VOICE_DURATION_SEC: 300,    // ۵ دقیقه
    MIN_SPEECH_DURATION_MS: 250,
    SILENCE_DURATION_MS: 1500,
    TTS_MIN_CHUNK_LENGTH: 20,
    AUDIO_SAMPLE_RATE: 48_000,      // Discord native sample rate

    // ─── Discord ───────────────────────────────────────────
    MAX_MESSAGE_LENGTH: 2000,       // Discord limit
    MAX_EMBED_DESCRIPTION: 4096,    // Discord embed limit
    TYPING_INDICATOR_INTERVAL: 5000,

    // ─── Routing ───────────────────────────────────────────
    ROUTING_CONFIDENCE_THRESHOLD: 0.7,
    MAX_ROUTING_RETRIES: 2,

    // ─── Cache ─────────────────────────────────────────────
    CACHE_TTL_MS: 5 * 60 * 1000,   // ۵ دقیقه
    MAX_CACHE_SIZE: 100,

    // ─── Personality ───────────────────────────────────────
    MIN_TEASING_LEVEL: 0,
    MAX_TEASING_LEVEL: 10,
    DEFAULT_TEASING_LEVEL: 6,

    // ─── Metrics ───────────────────────────────────────────
    METRICS_FLUSH_INTERVAL_MS: 60_000,
    MAX_METRIC_HISTORY: 1000,
} as const;

// ─── Type Export ───────────────────────────────────────────
export type SystemLimits = typeof SYSTEM_LIMITS;