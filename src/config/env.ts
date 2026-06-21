// src/config/env.ts

import { configSchema } from "./schema";
import { DEFAULT_CONFIG } from "./defaults";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// 🔧 ENV LOADER - فقط یک کار: .env بخون
// ============================================================

function loadEnvFile(): void {
    const envPath = path.resolve(process.cwd(), ".env");

    if (!fs.existsSync(envPath)) {
        console.warn("[env] No .env file found - using environment variables");
        return;
    }

    const content = fs.readFileSync(envPath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();

        // رد کردن کامنت‌ها و خطوط خالی
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();

        // فقط اگر قبلاً set نشده بود
        if (!(key in process.env)) {
            process.env[key] = stripQuotes(value);
        }
    }
}

function stripQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

// ============================================================
// 📖 ENV READER - فقط یک کار: process.env بخون
// ============================================================

function readEnv() {
    const e = process.env;

    return {
        env: e.NODE_ENV ?? "development",

        // ─── Discord ─────────────────────────────────────────
        discord: {
            token: e.DISCORD_TOKEN,
            clientId: e.DISCORD_CLIENT_ID,
            guildId: e.DISCORD_GUILD_ID,

            channels: {
                dev: splitList(e.DISCORD_CHANNELS_DEV),
                gamer: splitList(e.DISCORD_CHANNELS_GAMER),
                companion: splitList(e.DISCORD_CHANNELS_COMPANION),
            },

            presence: {
                status: e.DISCORD_STATUS,
                activityType: e.DISCORD_ACTIVITY_TYPE,
                activityName: e.DISCORD_ACTIVITY_NAME,
            },
        },

        // ─── LLM ─────────────────────────────────────────────
        llm: {
            defaultProvider: e.LLM_DEFAULT_PROVIDER,
            fallbackProvider: e.LLM_FALLBACK_PROVIDER,

            ollama: {
                enabled: toBool(e.OLLAMA_ENABLED),
                host: e.OLLAMA_HOST,
                model: e.OLLAMA_MODEL,
                timeout: toInt(e.OLLAMA_TIMEOUT),
                keepAlive: e.OLLAMA_KEEP_ALIVE,
            },

            openRouter: {
                enabled: toBool(e.OPENROUTER_ENABLED),
                apiKey: e.OPENROUTER_API_KEY,
                baseUrl: e.OPENROUTER_BASE_URL,
                models: {
                    heavy: e.OPENROUTER_MODEL_HEAVY,
                    light: e.OPENROUTER_MODEL_LIGHT,
                    routing: e.OPENROUTER_MODEL_ROUTING,
                },
                rateLimit: {
                    requestsPerMinute: toInt(e.OPENROUTER_RPM),
                    tokensPerMinute: toInt(e.OPENROUTER_TPM),
                },
            },

            generation: {
                maxTokens: toInt(e.LLM_MAX_TOKENS),
                temperature: toFloat(e.LLM_TEMPERATURE),
                streamingEnabled: toBool(e.LLM_STREAMING),
                streamChunkSize: toInt(e.LLM_CHUNK_SIZE),
            },
        },

        // ─── Voice ───────────────────────────────────────────
        voice: {
            enabled: toBool(e.VOICE_ENABLED),

            vad: {
                enabled: toBool(e.VAD_ENABLED),
                provider: e.VAD_PROVIDER,
                silenceThreshold: toFloat(e.VAD_SILENCE_THRESHOLD),
                minSpeechDuration: toInt(e.VAD_MIN_SPEECH_MS),
                silenceDuration: toInt(e.VAD_SILENCE_DURATION_MS),
            },

            stt: {
                provider: e.STT_PROVIDER,
                whisper: {
                    model: e.WHISPER_MODEL,
                    language: e.WHISPER_LANGUAGE,
                    device: e.WHISPER_DEVICE,
                },
                deepgram: {
                    apiKey: e.DEEPGRAM_API_KEY,
                    model: e.DEEPGRAM_MODEL,
                    language: e.DEEPGRAM_LANGUAGE,
                },
            },

            tts: {
                provider: e.TTS_PROVIDER,
                streaming: {
                    enabled: toBool(e.TTS_STREAMING),
                    sentenceBreakers: splitList(e.TTS_SENTENCE_BREAKERS),
                    minChunkLength: toInt(e.TTS_MIN_CHUNK_LENGTH),
                },
                elevenlabs: {
                    apiKey: e.ELEVENLABS_API_KEY,
                    voiceId: e.ELEVENLABS_VOICE_ID,
                    modelId: e.ELEVENLABS_MODEL_ID,
                    stability: toFloat(e.ELEVENLABS_STABILITY),
                    similarityBoost: toFloat(e.ELEVENLABS_SIMILARITY),
                },
                piper: {
                    executablePath: e.PIPER_EXECUTABLE,
                    modelPath: e.PIPER_MODEL_PATH,
                    sampleRate: toInt(e.PIPER_SAMPLE_RATE),
                },
                edgeTTS: {
                    voice: e.EDGE_TTS_VOICE,
                    rate: e.EDGE_TTS_RATE,
                    volume: e.EDGE_TTS_VOLUME,
                    pitch: e.EDGE_TTS_PITCH,
                },
            },
        },

        // ─── Memory ──────────────────────────────────────────
        memory: {
            contextDirectory: e.CONTEXT_DIRECTORY,
            maxContextTokens: toInt(e.MAX_CONTEXT_TOKENS),
            maxContextMessages: toInt(e.MAX_CONTEXT_MESSAGES),
            summarization: {
                enabled: toBool(e.SUMMARIZATION_ENABLED),
                triggerAtMessages: toInt(e.SUMMARIZE_AT_MESSAGES),
                keepRecentMessages: toInt(e.KEEP_RECENT_MESSAGES),
            },
            sections: {
                userProfile: toBool(e.MEMORY_USER_PROFILE),
                conversationHistory: toBool(e.MEMORY_CONVERSATION),
                pinnedFacts: toBool(e.MEMORY_PINNED_FACTS),
                sessionSummaries: toBool(e.MEMORY_SUMMARIES),
                relationshipStatus: toBool(e.MEMORY_RELATIONSHIP),
            },
            persistence: e.MEMORY_PERSISTENCE,
        },

        // ─── Agents ──────────────────────────────────────────
        agents: {
            routing: {
                strategy: e.ROUTING_STRATEGY,
                llmFallbackEnabled: toBool(e.ROUTING_LLM_FALLBACK),
                confidenceThreshold: toFloat(e.ROUTING_CONFIDENCE),
            },
            dev: {
                enabled: toBool(e.AGENT_DEV_ENABLED),
                triggerKeywords: splitList(e.AGENT_DEV_KEYWORDS),
                preferredModel: e.AGENT_DEV_MODEL,
            },
            gamer: {
                enabled: toBool(e.AGENT_GAMER_ENABLED),
                triggerKeywords: splitList(e.AGENT_GAMER_KEYWORDS),
                preferredModel: e.AGENT_GAMER_MODEL,
            },
            companion: {
                enabled: toBool(e.AGENT_COMPANION_ENABLED),
                isDefaultAgent: toBool(e.AGENT_COMPANION_DEFAULT),
                preferredModel: e.AGENT_COMPANION_MODEL,
            },
        },

        // ─── Personality ─────────────────────────────────────
        personality: {
            name: e.VIRA_NAME,
            defaultMood: e.VIRA_DEFAULT_MOOD,
            teasingLevel: toInt(e.VIRA_TEASING_LEVEL),
            languageStyle: e.VIRA_LANGUAGE_STYLE,
            useEmojis: toBool(e.VIRA_USE_EMOJIS),
            responseLength: e.VIRA_RESPONSE_LENGTH,
        },

        // ─── Observability ───────────────────────────────────
        observability: {
            logging: {
                level: e.LOG_LEVEL,
                directory: e.LOG_DIRECTORY,
                prettyPrint: toBool(e.LOG_PRETTY),
                maxFiles: toInt(e.LOG_MAX_FILES),
            },
            metrics: {
                enabled: toBool(e.METRICS_ENABLED),
                directory: e.METRICS_DIRECTORY,
                flushInterval: toInt(e.METRICS_FLUSH_INTERVAL),
                track: {
                    llmLatency: toBool(e.METRICS_LLM_LATENCY),
                    llmTokens: toBool(e.METRICS_LLM_TOKENS),
                    sttLatency: toBool(e.METRICS_STT_LATENCY),
                    ttsLatency: toBool(e.METRICS_TTS_LATENCY),
                    agentSelection: toBool(e.METRICS_AGENT_SELECTION),
                    routingDecisions: toBool(e.METRICS_ROUTING),
                },
            },
        },
    };
}

// ============================================================
// 🔨 PRIMITIVE CONVERTERS - احمق ولی مطمئن
// ============================================================

function toBool(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    return value.toLowerCase() === "true" || value === "1";
}

function toInt(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
}

function toFloat(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? undefined : parsed;
}

function splitList(value: string | undefined): string[] | undefined {
    if (!value) return undefined;
    return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

// ============================================================
// 🧹 CLEANER - مقادیر undefined رو پاک کن
// ============================================================

function removeUndefined<T extends object>(obj: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [
                k,
                v !== null && typeof v === "object" && !Array.isArray(v)
                    ? removeUndefined(v as object)
                    : v,
            ])
    ) as Partial<T>;
}

// ============================================================
// 🔀 MERGER - defaults + env = final config
// ============================================================

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
    const result = { ...base };

    for (const key in override) {
        const overrideVal = override[key];
        const baseVal = base[key];

        if (
            overrideVal !== undefined &&
            overrideVal !== null &&
            typeof overrideVal === "object" &&
            !Array.isArray(overrideVal) &&
            typeof baseVal === "object" &&
            baseVal !== null
        ) {
            result[key] = deepMerge(
                baseVal as object,
                overrideVal as object
            ) as T[typeof key];
        } else if (overrideVal !== undefined) {
            result[key] = overrideVal as T[typeof key];
        }
    }

    return result;
}

// ============================================================
// 🚀 MAIN LOADER - entry point این فایل
// ============================================================

export function loadConfig() {
    // ۱. فایل .env بخون
    loadEnvFile();

    // ۲. ENV رو map کن
    const fromEnv = readEnv();

    // ۳. undefined‌ها رو پاک کن
    const cleanedEnv = removeUndefined(fromEnv);

    // ۴. defaults + env رو merge کن
    const merged = deepMerge(DEFAULT_CONFIG as object, cleanedEnv);

    // ۵. validate با schema
    const result = configSchema.safeParse(merged);

    if (!result.success) {
        console.error("\n❌ [Vira] Config validation failed:\n");

        result.error.issues.forEach((issue) => {
            const path = issue.path.join(" → ");
            console.error(`  • ${path}: ${issue.message}`);
        });

        console.error("\n💡 Check your .env file or defaults.ts\n");

        process.exit(1);
    }

    return result.data;
}