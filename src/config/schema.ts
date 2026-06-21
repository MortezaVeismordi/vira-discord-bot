// src/config/schema.ts
import { z } from "zod";

// ============================================================
// 🔧 PRIMITIVE SCHEMAS
// ============================================================

const portSchema = z
    .number()
    .int()
    .min(1)
    .max(65535);

const urlSchema = z
    .string()
    .url();

const logLevelSchema = z.enum([
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
]);

// ============================================================
// 🤖 DISCORD
// ============================================================

export const discordSchema = z.object({
    token: z
        .string()
        .min(50, "Discord token seems too short")
        .describe("Discord Bot Token از Developer Portal"),

    clientId: z
        .string()
        .min(10)
        .describe("Application/Client ID"),

    guildId: z
        .string()
        .optional()
        .describe("Guild ID برای Development (اختیاری)"),

    channels: z.object({
        dev: z
            .array(z.string())
            .default([])
            .describe("نام کانال‌هایی که DevAgent فعاله"),

        gamer: z
            .array(z.string())
            .default([])
            .describe("نام کانال‌هایی که GamerAgent فعاله"),

        companion: z
            .array(z.string())
            .default([])
            .describe("نام کانال‌هایی که CompanionAgent فعاله"),
    }),

    presence: z.object({
        status: z
            .enum(["online", "idle", "dnd", "invisible"])
            .default("online"),

        activityType: z
            .enum(["PLAYING", "WATCHING", "LISTENING", "COMPETING"])
            .default("PLAYING"),

        activityName: z
            .string()
            .default("با دوستام"),
    }),
});

// ============================================================
// 🧠 LLM PROVIDERS
// ============================================================

const ollamaSchema = z.object({
    enabled: z.boolean().default(true),

    host: urlSchema.default("http://localhost:11434"),

    model: z
        .string()
        .default("llama3.1:8b")
        .describe("مدل پیش‌فرض Ollama"),

    timeout: z
        .number()
        .int()
        .positive()
        .default(30_000)
        .describe("Timeout به میلی‌ثانیه"),

    keepAlive: z
        .string()
        .default("5m")
        .describe("مدت نگهداری مدل در حافظه"),
});

const openRouterSchema = z.object({
    enabled: z.boolean().default(false),

    apiKey: z
        .string()
        .optional()
        .describe("کلید API OpenRouter"),

    baseUrl: urlSchema.default("https://openrouter.ai/api/v1"),

    models: z.object({
        heavy: z
            .string()
            .default("qwen/qwen-2.5-coder-32b-instruct")
            .describe("مدل سنگین برای دیباگ و کدنویسی"),

        light: z
            .string()
            .default("meta-llama/llama-3.1-8b-instruct")
            .describe("مدل سبک برای مکالمه"),

        routing: z
            .string()
            .default("meta-llama/llama-3.1-8b-instruct")
            .describe("مدل برای LLM-based routing"),
    }),

    rateLimit: z.object({
        requestsPerMinute: z.number().int().positive().default(20),
        tokensPerMinute: z.number().int().positive().default(100_000),
    }),
});

export const llmSchema = z.object({
    defaultProvider: z
        .enum(["ollama", "openrouter"])
        .default("ollama")
        .describe("پروایدر پیش‌فرض"),

    fallbackProvider: z
        .enum(["ollama", "openrouter"])
        .optional()
        .describe("پروایدر پشتیبان در صورت خرابی"),

    ollama: ollamaSchema,
    openRouter: openRouterSchema,

    generation: z.object({
        maxTokens: z
            .number()
            .int()
            .positive()
            .default(2048),

        temperature: z
            .number()
            .min(0)
            .max(2)
            .default(0.7),

        streamingEnabled: z
            .boolean()
            .default(true)
            .describe("فعال‌سازی استریمینگ پاسخ‌ها"),

        streamChunkSize: z
            .number()
            .int()
            .positive()
            .default(10)
            .describe("تعداد توکن در هر chunk"),
    }),
}).refine(
    (data) => {
        // اگر OpenRouter انتخاب شده، باید API Key داشته باشه
        if (
            data.defaultProvider === "openrouter" &&
            !data.openRouter.apiKey
        ) {
            return false;
        }
        return true;
    },
    {
        message: "OpenRouter API Key الزامی است وقتی پروایدر پیش‌فرض OpenRouter است",
        path: ["openRouter", "apiKey"],
    }
);

// ============================================================
// 🎙️ VOICE
// ============================================================

const vadSchema = z.object({
    enabled: z.boolean().default(true),

    provider: z
        .enum(["silero", "webrtc"])
        .default("silero"),

    silenceThreshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("آستانه تشخیص سکوت (0-1)"),

    minSpeechDuration: z
        .number()
        .int()
        .positive()
        .default(250)
        .describe("حداقل مدت گفتار به ms"),

    silenceDuration: z
        .number()
        .int()
        .positive()
        .default(1500)
        .describe("مدت سکوت برای پایان گفتار به ms"),
});

const sttSchema = z.object({
    provider: z
        .enum(["whisper-local", "whisper-api", "deepgram"])
        .default("whisper-local"),

    whisper: z.object({
        model: z
            .enum(["tiny", "base", "small", "medium", "large"])
            .default("base"),

        language: z
            .string()
            .default("fa")
            .describe("زبان پیش‌فرض (fa = فارسی)"),

        device: z
            .enum(["cpu", "cuda"])
            .default("cpu"),
    }),

    deepgram: z.object({
        apiKey: z.string().optional(),
        model: z.string().default("nova-2"),
        language: z.string().default("fa"),
    }),
});

const ttsSchema = z.object({
    provider: z
        .enum(["elevenlabs", "piper", "edge-tts"])
        .default("edge-tts"),

    streaming: z.object({
        enabled: z.boolean().default(true),

        sentenceBreakers: z
            .array(z.string())
            .default([".", "!", "?", "،", "؟", "\n"])
            .describe("کاراکترهایی که chunk جدید شروع می‌کنند"),

        minChunkLength: z
            .number()
            .int()
            .positive()
            .default(20)
            .describe("حداقل طول chunk برای ارسال به TTS"),
    }),

    elevenlabs: z.object({
        apiKey: z.string().optional(),
        voiceId: z.string().optional(),
        modelId: z.string().default("eleven_multilingual_v2"),
        stability: z.number().min(0).max(1).default(0.5),
        similarityBoost: z.number().min(0).max(1).default(0.75),
    }),

    piper: z.object({
        executablePath: z
            .string()
            .default("piper")
            .describe("مسیر اجرایی Piper"),

        modelPath: z
            .string()
            .optional()
            .describe("مسیر مدل صوتی Piper"),

        sampleRate: z.number().int().positive().default(22050),
    }),

    edgeTTS: z.object({
        voice: z
            .string()
            .default("fa-IR-DilaraNeural")
            .describe("صدای پیش‌فرض Edge TTS برای فارسی"),

        rate: z.string().default("+0%"),
        volume: z.string().default("+0%"),
        pitch: z.string().default("+0Hz"),
    }),
});

export const voiceSchema = z.object({
    enabled: z.boolean().default(false),
    vad: vadSchema,
    stt: sttSchema,
    tts: ttsSchema,
});

// ============================================================
// 💾 MEMORY & CONTEXT
// ============================================================

export const memorySchema = z.object({
    contextDirectory: z
        .string()
        .default("./runtime/contexts")
        .describe("مسیر ذخیره فایل‌های Markdown context"),

    maxContextTokens: z
        .number()
        .int()
        .positive()
        .default(4096)
        .describe("حداکثر توکن context که به LLM ارسال می‌شود"),

    maxContextMessages: z
        .number()
        .int()
        .positive()
        .default(50)
        .describe("حداکثر پیام در context window"),

    summarization: z.object({
        enabled: z.boolean().default(true),

        triggerAtMessages: z
            .number()
            .int()
            .positive()
            .default(40)
            .describe("در چه تعداد پیامی خلاصه‌سازی شروع شود"),

        keepRecentMessages: z
            .number()
            .int()
            .positive()
            .default(10)
            .describe("تعداد پیام‌های اخیر که خلاصه نشوند"),
    }),

    sections: z.object({
        // بخش‌های مختلف حافظه مارک‌داون
        userProfile: z.boolean().default(true),
        conversationHistory: z.boolean().default(true),
        pinnedFacts: z.boolean().default(true),
        sessionSummaries: z.boolean().default(true),
        relationshipStatus: z.boolean().default(true),
    }),

    persistence: z
        .enum(["file", "database"])
        .default("file")
        .describe("روش ذخیره‌سازی حافظه"),
});

// ============================================================
// 🤖 AGENTS
// ============================================================

export const agentsSchema = z.object({
    routing: z.object({
        strategy: z
            .enum(["rule-based", "llm", "hybrid"])
            .default("hybrid")
            .describe("استراتژی روتینگ پیام‌ها"),

        llmFallbackEnabled: z
            .boolean()
            .default(true)
            .describe("اگر Rule-based کار نکرد، LLM تصمیم بگیرد"),

        confidenceThreshold: z
            .number()
            .min(0)
            .max(1)
            .default(0.7)
            .describe("آستانه اطمینان برای LLM Router"),
    }),

    dev: z.object({
        enabled: z.boolean().default(true),

        triggerKeywords: z
            .array(z.string())
            .default([
                "باگ", "خطا", "error", "bug", "کد", "code",
                "debug", "دیباگ", "docker", "داکر",
                "دیتابیس", "database", "api",
            ])
            .describe("کلیدواژه‌های فعال‌سازی DevAgent"),

        preferredModel: z
            .enum(["heavy", "light"])
            .default("heavy")
            .describe("مدل ترجیحی برای کدنویسی"),
    }),

    gamer: z.object({
        enabled: z.boolean().default(true),

        triggerKeywords: z
            .array(z.string())
            .default([
                "minecraft", "ماینکرفت", "game", "بازی",
                "گیم", "ماین", "mods", "مپ", "server",
            ]),

        preferredModel: z
            .enum(["heavy", "light"])
            .default("light"),
    }),

    companion: z.object({
        enabled: z.boolean().default(true),

        isDefaultAgent: z
            .boolean()
            .default(true)
            .describe("اگر هیچ Agent دیگری match نشد، Companion انتخاب شود"),

        preferredModel: z
            .enum(["heavy", "light"])
            .default("light"),
    }),
});

// ============================================================
// 🔍 PERSONALITY
// ============================================================

export const personalitySchema = z.object({
    name: z.string().default("ویرا"),

    defaultMood: z
        .enum(["energetic", "calm", "playful", "focused", "caring"])
        .default("energetic"),

    teasingLevel: z
        .number()
        .min(0)
        .max(10)
        .default(6)
        .describe("سطح شوخ‌طبعی (0 = بدون شوخی، 10 = خیلی شوخ)"),

    languageStyle: z
        .enum(["formal", "semi-formal", "casual", "mixed"])
        .default("casual")
        .describe("سبک زبانی پیش‌فرض"),

    useEmojis: z.boolean().default(true),

    responseLength: z
        .enum(["concise", "balanced", "detailed"])
        .default("balanced"),
});

// ============================================================
// 📊 OBSERVABILITY
// ============================================================

export const observabilitySchema = z.object({
    logging: z.object({
        level: logLevelSchema.default("info"),

        directory: z
            .string()
            .default("./runtime/logs"),

        prettyPrint: z
            .boolean()
            .default(false)
            .describe("در Development فعال کن"),

        maxFiles: z
            .number()
            .int()
            .positive()
            .default(7)
            .describe("حداکثر تعداد فایل لاگ نگه داشته شود"),
    }),

    metrics: z.object({
        enabled: z.boolean().default(true),

        directory: z
            .string()
            .default("./runtime/metrics"),

        flushInterval: z
            .number()
            .int()
            .positive()
            .default(60_000)
            .describe("هر چند ms متریک‌ها نوشته شوند"),

        track: z.object({
            llmLatency: z.boolean().default(true),
            llmTokens: z.boolean().default(true),
            sttLatency: z.boolean().default(true),
            ttsLatency: z.boolean().default(true),
            agentSelection: z.boolean().default(true),
            routingDecisions: z.boolean().default(true),
        }),
    }),
});

// ============================================================
// 🌍 ROOT SCHEMA - Contract of Infrastructure
// ============================================================

export const configSchema = z.object({
    env: z
        .enum(["development", "production", "test"])
        .default("development"),

    discord: discordSchema,
    llm: llmSchema,
    voice: voiceSchema,
    memory: memorySchema,
    agents: agentsSchema,
    personality: personalitySchema,
    observability: observabilitySchema,
});

// ============================================================
// 📦 EXPORTS
// ============================================================

export type Config = z.infer<typeof configSchema>;
export type DiscordConfig = z.infer<typeof discordSchema>;
export type LLMConfig = z.infer<typeof llmSchema>;
export type VoiceConfig = z.infer<typeof voiceSchema>;
export type MemoryConfig = z.infer<typeof memorySchema>;
export type AgentsConfig = z.infer<typeof agentsSchema>;
export type PersonalityConfig = z.infer<typeof personalitySchema>;
export type ObservabilityConfig = z.infer<typeof observabilitySchema>;