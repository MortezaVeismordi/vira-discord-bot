// src/core/domain/entities/VoiceSession.ts

import { Message, type MessageAuthor, type MessageChannel } from "./Message";
import { Conversation } from "./Conversation";
import type { AgentType } from "../types/AgentType";

// ============================================================
// 📐 TYPES & ENUMS
// ============================================================

/**
 * وضعیت جلسه صوتی
 *
 * connecting   → در حال اتصال به voice channel
 * idle         → متصل ولی کسی حرف نمی‌زنه
 * listening    → VAD فعال، در حال گوش دادن
 * processing   → STT در حال تبدیل صدا به متن
 * thinking     → LLM در حال تولید پاسخ
 * speaking     → TTS در حال پخش صدا
 * paused       → موقتاً متوقف (مثلاً mute)
 * disconnected → قطع شده
 * error        → خطا رخ داده
 */
export type VoiceState =
    | "connecting"
    | "idle"
    | "listening"
    | "processing"
    | "thinking"
    | "speaking"
    | "paused"
    | "disconnected"
    | "error";

/**
 * نوع رویداد صوتی
 */
export type VoiceEventType =
    | "speech-start"
    | "speech-end"
    | "stt-complete"
    | "llm-start"
    | "llm-complete"
    | "tts-start"
    | "tts-complete"
    | "user-join"
    | "user-leave"
    | "bot-mute"
    | "bot-unmute"
    | "error";

/**
 * یک رویداد در timeline صوتی
 */
export interface VoiceTimelineEvent {
    readonly type: VoiceEventType;
    readonly timestamp: Date;
    readonly durationMs?: number;
    readonly metadata?: Record<string, unknown>;
}

/**
 * اطلاعات یک بخش گفتار (Speech Segment)
 */
export interface SpeechSegment {
    readonly id: string;
    readonly startedAt: Date;
    readonly endedAt: Date;
    readonly durationMs: number;
    readonly transcript: string;
    readonly sttConfidence: number;
    readonly sttProvider: string;
    readonly sttLatencyMs: number;
}

/**
 * اطلاعات یک پاسخ صوتی ویرا
 */
export interface VoiceResponse {
    readonly id: string;
    readonly text: string;
    readonly agentType: AgentType;
    readonly llmLatencyMs: number;
    readonly ttsLatencyMs: number;
    readonly totalLatencyMs: number;       // STT + LLM + TTS
    readonly firstByteLatencyMs: number;   // تا اولین صدا
    readonly ttsProvider: string;
    readonly chunksCount: number;
    readonly timestamp: Date;
}

/**
 * تنظیمات VAD فعلی
 */
export interface VADState {
    readonly isActive: boolean;
    readonly currentEnergy: number;        // 0-1
    readonly threshold: number;            // 0-1
    readonly isSpeaking: boolean;
    readonly silenceDurationMs: number;
}

/**
 * متریک‌های جلسه صوتی
 */
export interface VoiceSessionMetrics {
    readonly totalDuration: number;
    readonly totalSpeechSegments: number;
    readonly totalResponses: number;
    readonly averageSTTLatency: number;
    readonly averageLLMLatency: number;
    readonly averageTTSLatency: number;
    readonly averageTotalLatency: number;
    readonly averageFirstByteLatency: number;
    readonly totalUserSpeechDuration: number;
    readonly totalBotSpeechDuration: number;
    readonly averageSTTConfidence: number;
    readonly interruptionCount: number;
    readonly errorCount: number;
    readonly agentsUsed: AgentType[];
}

/**
 * آپشن‌های ساخت VoiceSession
 */
export interface VoiceSessionOptions {
    readonly vadThreshold?: number;
    readonly silenceDuration?: number;
    readonly minSpeechDuration?: number;
    readonly sttProvider?: string;
    readonly ttsProvider?: string;
    readonly autoRespond?: boolean;
}

/**
 * وضعیت Streaming TTS
 */
export interface TTSStreamState {
    readonly isStreaming: boolean;
    readonly chunksBuffered: number;
    readonly chunksSent: number;
    readonly currentText: string;
    readonly startedAt: Date | null;
}

// ============================================================
// 🎙️ VOICE SESSION
// ============================================================

/**
 * جلسه صوتی ویرا
 *
 * مدیریت کامل یک جلسه voice chat شامل:
 *   - اتصال به voice channel
 *   - تشخیص فعالیت صوتی (VAD)
 *   - تبدیل صدا به متن (STT)
 *   - تولید پاسخ (LLM)
 *   - تبدیل متن به صدا (TTS)
 *   - مدیریت interruption
 *   - tracking timeline رویدادها
 *
 * ```
 * ┌──────────────────────────────────────────────────┐
 * │                 Voice Pipeline                   │
 * │                                                  │
 * │  🎤 Mic → VAD → STT → LLM → TTS → 🔊 Speaker  │
 * │                                                  │
 * │  listening → processing → thinking → speaking    │
 * └──────────────────────────────────────────────────┘
 * ```
 *
 * Immutable - هر تغییر instance جدید.
 *
 * @example
 * ```typescript
 * let session = VoiceSession.create({
 *   channelId: "vc_123",
 *   userId: "usr_456",
 *   guildId: "guild_789",
 * });
 *
 * session = session.connect();
 * session = session.onSpeechStart();
 * session = session.onSpeechEnd(audioBuffer);
 * session = session.onSTTComplete("سلام ویرا", 0.95, 340);
 * session = session.onLLMComplete("سلام عزیزم!", "companion", 1200);
 * session = session.onTTSStart();
 * session = session.onTTSComplete(890);
 * ```
 */
export class VoiceSession {
    // ─── Identity ────────────────────────────────────────────
    public readonly id: string;
    public readonly channelId: string;
    public readonly userId: string;
    public readonly guildId: string;

    // ─── State ───────────────────────────────────────────────
    public readonly state: VoiceState;
    public readonly previousState: VoiceState | null;
    public readonly vad: VADState;
    public readonly ttsStream: TTSStreamState;

    // ─── Conversation Bridge ─────────────────────────────────
    public readonly conversation: Conversation;

    // ─── Current Processing ──────────────────────────────────
    public readonly currentSegment: SpeechSegment | null;
    public readonly currentResponse: Partial<VoiceResponse> | null;
    public readonly pendingTranscript: string | null;

    // ─── History ─────────────────────────────────────────────
    public readonly segments: readonly SpeechSegment[];
    public readonly responses: readonly VoiceResponse[];
    public readonly timeline: readonly VoiceTimelineEvent[];

    // ─── Tracking ────────────────────────────────────────────
    public readonly interruptionCount: number;
    public readonly errorCount: number;
    public readonly lastError: string | null;

    // ─── Options ─────────────────────────────────────────────
    public readonly options: Required<VoiceSessionOptions>;

    // ─── Timestamps ──────────────────────────────────────────
    public readonly connectedAt: Date | null;
    public readonly lastActivityAt: Date;

    // ─── Private Constructor ─────────────────────────────────
    private constructor(params: {
        id: string;
        channelId: string;
        userId: string;
        guildId: string;
        state: VoiceState;
        previousState: VoiceState | null;
        vad: VADState;
        ttsStream: TTSStreamState;
        conversation: Conversation;
        currentSegment: SpeechSegment | null;
        currentResponse: Partial<VoiceResponse> | null;
        pendingTranscript: string | null;
        segments: readonly SpeechSegment[];
        responses: readonly VoiceResponse[];
        timeline: readonly VoiceTimelineEvent[];
        interruptionCount: number;
        errorCount: number;
        lastError: string | null;
        options: Required<VoiceSessionOptions>;
        connectedAt: Date | null;
        lastActivityAt: Date;
    }) {
        this.id = params.id;
        this.channelId = params.channelId;
        this.userId = params.userId;
        this.guildId = params.guildId;
        this.state = params.state;
        this.previousState = params.previousState;
        this.vad = params.vad;
        this.ttsStream = params.ttsStream;
        this.conversation = params.conversation;
        this.currentSegment = params.currentSegment;
        this.currentResponse = params.currentResponse;
        this.pendingTranscript = params.pendingTranscript;
        this.segments = params.segments;
        this.responses = params.responses;
        this.timeline = params.timeline;
        this.interruptionCount = params.interruptionCount;
        this.errorCount = params.errorCount;
        this.lastError = params.lastError;
        this.options = params.options;
        this.connectedAt = params.connectedAt;
        this.lastActivityAt = params.lastActivityAt;
    }

    // ============================================================
    // 🏭 FACTORIES
    // ============================================================

    /**
     * ساخت جلسه صوتی جدید
     */
    static create(params: {
        channelId: string;
        userId: string;
        guildId: string;
        options?: VoiceSessionOptions;
    }): VoiceSession {
        const now = new Date();
        const options: Required<VoiceSessionOptions> = {
            vadThreshold: params.options?.vadThreshold ?? 0.5,
            silenceDuration: params.options?.silenceDuration ?? 1500,
            minSpeechDuration: params.options?.minSpeechDuration ?? 250,
            sttProvider: params.options?.sttProvider ?? "whisper-local",
            ttsProvider: params.options?.ttsProvider ?? "edge-tts",
            autoRespond: params.options?.autoRespond ?? true,
        };

        return new VoiceSession({
            id: `voice_${params.channelId}_${Date.now().toString(36)}`,
            channelId: params.channelId,
            userId: params.userId,
            guildId: params.guildId,
            state: "connecting",
            previousState: null,
            vad: {
                isActive: false,
                currentEnergy: 0,
                threshold: options.vadThreshold,
                isSpeaking: false,
                silenceDurationMs: 0,
            },
            ttsStream: {
                isStreaming: false,
                chunksBuffered: 0,
                chunksSent: 0,
                currentText: "",
                startedAt: null,
            },
            conversation: Conversation.create(params.channelId, params.userId),
            currentSegment: null,
            currentResponse: null,
            pendingTranscript: null,
            segments: [],
            responses: [],
            timeline: [],
            interruptionCount: 0,
            errorCount: 0,
            lastError: null,
            options,
            connectedAt: null,
            lastActivityAt: now,
        });
    }

    // ============================================================
    // 🔄 CONNECTION LIFECYCLE
    // ============================================================

    /**
     * اتصال موفق
     */
    connect(): VoiceSession {
        const now = new Date();

        return this.transition("idle", {
            connectedAt: now,
            lastActivityAt: now,
            vad: { ...this.vad, isActive: true },
            timeline: [...this.timeline, {
                type: "user-join" as VoiceEventType,
                timestamp: now,
            }],
        });
    }

    /**
     * قطع اتصال
     */
    disconnect(): VoiceSession {
        const now = new Date();

        return this.transition("disconnected", {
            lastActivityAt: now,
            vad: {
                ...this.vad,
                isActive: false,
                isSpeaking: false,
            },
            ttsStream: {
                isStreaming: false,
                chunksBuffered: 0,
                chunksSent: 0,
                currentText: "",
                startedAt: null,
            },
            currentSegment: null,
            currentResponse: null,
            timeline: [...this.timeline, {
                type: "user-leave" as VoiceEventType,
                timestamp: now,
            }],
        });
    }

    /**
     * Pause (مثلاً mute)
     */
    pause(): VoiceSession {
        const now = new Date();

        return this.transition("paused", {
            lastActivityAt: now,
            vad: { ...this.vad, isActive: false, isSpeaking: false },
            timeline: [...this.timeline, {
                type: "bot-mute" as VoiceEventType,
                timestamp: now,
            }],
        });
    }

    /**
     * Resume (unmute)
     */
    resume(): VoiceSession {
        const now = new Date();

        return this.transition("idle", {
            lastActivityAt: now,
            vad: { ...this.vad, isActive: true },
            timeline: [...this.timeline, {
                type: "bot-unmute" as VoiceEventType,
                timestamp: now,
            }],
        });
    }

    // ============================================================
    // 🎤 SPEECH PIPELINE
    // ============================================================

    /**
     * شروع گفتار تشخیص داده شد (VAD)
     *
     * ```
     * idle → listening
     * ```
     */
    onSpeechStart(): VoiceSession {
        const now = new Date();

        // اگر ویرا داشت حرف می‌زد → interruption
        if (this.state === "speaking") {
            return this.handleInterruption();
        }

        return this.transition("listening", {
            lastActivityAt: now,
            vad: { ...this.vad, isSpeaking: true, silenceDurationMs: 0 },
            currentSegment: null,  // segment بعد از STT ساخته می‌شه
            timeline: [...this.timeline, {
                type: "speech-start" as VoiceEventType,
                timestamp: now,
            }],
        });
    }

    /**
     * پایان گفتار (VAD سکوت تشخیص داد)
     *
     * ```
     * listening → processing
     * ```
     */
    onSpeechEnd(): VoiceSession {
        const now = new Date();

        return this.transition("processing", {
            lastActivityAt: now,
            vad: { ...this.vad, isSpeaking: false },
            timeline: [...this.timeline, {
                type: "speech-end" as VoiceEventType,
                timestamp: now,
            }],
        });
    }

    /**
     * STT تبدیل صدا به متن را تمام کرد
     *
     * ```
     * processing → thinking
     * ```
     */
    onSTTComplete(
        transcript: string,
        confidence: number,
        latencyMs: number,
    ): VoiceSession {
        const now = new Date();

        // فیلتر متن‌های خالی یا خیلی کوتاه
        if (!transcript.trim() || transcript.trim().length < 2) {
            return this.transition("idle", {
                lastActivityAt: now,
            });
        }

        // ساخت SpeechSegment
        const segment: SpeechSegment = {
            id: `seg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            startedAt: new Date(now.getTime() - latencyMs),
            endedAt: now,
            durationMs: latencyMs,
            transcript,
            sttConfidence: confidence,
            sttProvider: this.options.sttProvider,
            sttLatencyMs: latencyMs,
        };

        // ساخت Message از transcript
        const voiceMessage = Message.fromVoice({
            content: transcript,
            author: {
                id: this.userId,
                username: this.userId,
                displayName: this.userId,
                isBot: false,
            },
            channel: {
                id: this.channelId,
                name: "voice",
                guildId: this.guildId,
            },
            voice: {
                duration: latencyMs,
                sttLatency: latencyMs,
                sttConfidence: confidence,
                sttProvider: this.options.sttProvider,
            },
        });

        // اضافه به مکالمه
        const updatedConversation = this.conversation.addUserMessage(voiceMessage);

        return this.transition("thinking", {
            lastActivityAt: now,
            currentSegment: segment,
            pendingTranscript: transcript,
            segments: [...this.segments, segment],
            conversation: updatedConversation,
            currentResponse: {
                id: `resp_${Date.now().toString(36)}`,
                timestamp: now,
            },
            timeline: [...this.timeline, {
                type: "stt-complete" as VoiceEventType,
                timestamp: now,
                durationMs: latencyMs,
                metadata: {
                    transcript,
                    confidence,
                    provider: this.options.sttProvider,
                },
            }],
        });
    }

    /**
     * LLM پاسخ را تولید کرد
     *
     * ```
     * thinking → speaking (اگر TTS فعال باشه)
     * thinking → idle (اگر TTS غیرفعال باشه)
     * ```
     */
    onLLMComplete(
        responseText: string,
        agentType: AgentType,
        latencyMs: number,
        promptTokens?: number,
        completionTokens?: number,
    ): VoiceSession {
        const now = new Date();

        // ساخت Message برای پاسخ ویرا
        const botMessage = Message.fromVoice({
            content: responseText,
            author: {
                id: "vira",
                username: "vira",
                displayName: "ویرا",
                isBot: true,
            },
            channel: {
                id: this.channelId,
                name: "voice",
                guildId: this.guildId,
            },
            voice: {
                duration: 0,
                sttLatency: 0,
                sttConfidence: 1,
                sttProvider: "none",
            },
        });

        const updatedConversation = this.conversation.addBotResponse(
            botMessage,
            {
                agentType,
                model: "voice-model",
                provider: "ollama",
                latencyMs,
                promptTokens,
                completionTokens,
            },
        );

        return this.transition("speaking", {
            lastActivityAt: now,
            conversation: updatedConversation,
            pendingTranscript: null,
            currentResponse: {
                ...this.currentResponse,
                text: responseText,
                agentType,
                llmLatencyMs: latencyMs,
            },
            timeline: [...this.timeline, {
                type: "llm-complete" as VoiceEventType,
                timestamp: now,
                durationMs: latencyMs,
                metadata: {
                    agentType,
                    textLength: responseText.length,
                    promptTokens,
                    completionTokens,
                },
            }],
        });
    }

    /**
     * TTS شروع به پخش صدا کرد
     */
    onTTSStart(): VoiceSession {
        const now = new Date();

        // محاسبه first-byte latency
        const sttLatency = this.currentSegment?.sttLatencyMs ?? 0;
        const llmLatency = this.currentResponse?.llmLatencyMs ?? 0;
        const firstByteLatency = sttLatency + llmLatency;

        return this.clone({
            lastActivityAt: now,
            ttsStream: {
                isStreaming: true,
                chunksBuffered: 0,
                chunksSent: 0,
                currentText: this.currentResponse?.text ?? "",
                startedAt: now,
            },
            currentResponse: {
                ...this.currentResponse,
                firstByteLatencyMs: firstByteLatency,
            },
            timeline: [...this.timeline, {
                type: "tts-start" as VoiceEventType,
                timestamp: now,
                metadata: {
                    firstByteLatencyMs: firstByteLatency,
                    provider: this.options.ttsProvider,
                },
            }],
        });
    }

    /**
     * TTS یک chunk رو پخش کرد
     */
    onTTSChunkSent(): VoiceSession {
        return this.clone({
            ttsStream: {
                ...this.ttsStream,
                chunksSent: this.ttsStream.chunksSent + 1,
            },
        });
    }

    /**
     * TTS پخش تمام شد
     *
     * ```
     * speaking → idle
     * ```
     */
    onTTSComplete(ttsLatencyMs: number): VoiceSession {
        const now = new Date();

        // ساخت VoiceResponse کامل
        const sttLatency = this.currentSegment?.sttLatencyMs ?? 0;
        const llmLatency = this.currentResponse?.llmLatencyMs ?? 0;

        const response: VoiceResponse = {
            id: this.currentResponse?.id ?? `resp_${Date.now().toString(36)}`,
            text: this.currentResponse?.text ?? "",
            agentType: this.currentResponse?.agentType ?? "companion",
            llmLatencyMs: llmLatency,
            ttsLatencyMs: ttsLatencyMs,
            totalLatencyMs: sttLatency + llmLatency + ttsLatencyMs,
            firstByteLatencyMs: this.currentResponse?.firstByteLatencyMs ?? 0,
            ttsProvider: this.options.ttsProvider,
            chunksCount: this.ttsStream.chunksSent,
            timestamp: now,
        };

        return this.transition("idle", {
            lastActivityAt: now,
            currentSegment: null,
            currentResponse: null,
            responses: [...this.responses, response],
            ttsStream: {
                isStreaming: false,
                chunksBuffered: 0,
                chunksSent: 0,
                currentText: "",
                startedAt: null,
            },
            timeline: [...this.timeline, {
                type: "tts-complete" as VoiceEventType,
                timestamp: now,
                durationMs: ttsLatencyMs,
                metadata: {
                    totalLatencyMs: response.totalLatencyMs,
                    chunksCount: response.chunksCount,
                },
            }],
        });
    }

    // ============================================================
    // ⚡ INTERRUPTION HANDLING
    // ============================================================

    /**
     * کاربر وسط حرف ویرا حرف زد (Barge-in)
     *
     * ```
     * speaking → listening
     * ```
     */
    private handleInterruption(): VoiceSession {
        const now = new Date();

        return this.transition("listening", {
            lastActivityAt: now,
            interruptionCount: this.interruptionCount + 1,
            // TTS فوری متوقف بشه
            ttsStream: {
                isStreaming: false,
                chunksBuffered: 0,
                chunksSent: this.ttsStream.chunksSent,
                currentText: "",
                startedAt: null,
            },
            currentResponse: null,
            vad: { ...this.vad, isSpeaking: true },
            timeline: [...this.timeline, {
                type: "speech-start" as VoiceEventType,
                timestamp: now,
                metadata: { interrupted: true },
            }],
        });
    }

    // ============================================================
    // ❌ ERROR HANDLING
    // ============================================================

    /**
     * خطا رخ داد
     */
    onError(error: string): VoiceSession {
        const now = new Date();

        return this.transition("error", {
            lastActivityAt: now,
            errorCount: this.errorCount + 1,
            lastError: error,
            currentSegment: null,
            currentResponse: null,
            ttsStream: {
                isStreaming: false,
                chunksBuffered: 0,
                chunksSent: 0,
                currentText: "",
                startedAt: null,
            },
            timeline: [...this.timeline, {
                type: "error" as VoiceEventType,
                timestamp: now,
                metadata: { error },
            }],
        });
    }

    /**
     * بازیابی از خطا
     */
    recover(): VoiceSession {
        if (this.state !== "error") return this;

        return this.transition("idle", {
            lastActivityAt: new Date(),
            lastError: null,
            vad: { ...this.vad, isActive: true },
        });
    }

    // ============================================================
    // 🔧 VAD UPDATES
    // ============================================================

    /**
     * به‌روزرسانی سطح انرژی VAD
     */
    updateVADEnergy(energy: number): VoiceSession {
        return this.clone({
            vad: {
                ...this.vad,
                currentEnergy: Math.min(1, Math.max(0, energy)),
            },
        });
    }

    /**
     * به‌روزرسانی مدت سکوت
     */
    updateSilenceDuration(durationMs: number): VoiceSession {
        return this.clone({
            vad: {
                ...this.vad,
                silenceDurationMs: durationMs,
            },
        });
    }

    /**
     * تغییر آستانه VAD
     */
    setVADThreshold(threshold: number): VoiceSession {
        return this.clone({
            vad: {
                ...this.vad,
                threshold: Math.min(1, Math.max(0, threshold)),
            },
            options: {
                ...this.options,
                vadThreshold: threshold,
            },
        });
    }

    // ============================================================
    // 🔍 QUERY METHODS
    // ============================================================

    /**
     * آیا متصل است؟
     */
    get isConnected(): boolean {
        return this.state !== "connecting" && this.state !== "disconnected";
    }

    /**
     * آیا در حال گوش دادن است؟
     */
    get isListening(): boolean {
        return this.state === "listening" || this.state === "idle";
    }

    /**
     * آیا در حال پردازش است؟ (STT یا LLM)
     */
    get isProcessing(): boolean {
        return this.state === "processing" || this.state === "thinking";
    }

    /**
     * آیا ویرا در حال حرف زدن است؟
     */
    get isSpeaking(): boolean {
        return this.state === "speaking";
    }

    /**
     * آیا خطا دارد؟
     */
    get hasError(): boolean {
        return this.state === "error";
    }

    /**
     * آیا session فعال است؟ (هر state به جز disconnected)
     */
    get isAlive(): boolean {
        return this.state !== "disconnected";
    }

    /**
     * مدت اتصال (ms)
     */
    get connectionDuration(): number {
        if (!this.connectedAt) return 0;
        return Date.now() - this.connectedAt.getTime();
    }

    /**
     * زمان از آخرین فعالیت (ms)
     */
    get idleTime(): number {
        return Date.now() - this.lastActivityAt.getTime();
    }

    /**
     * آیا session بی‌فعالیت بوده؟
     */
    isStale(thresholdMs: number = 5 * 60 * 1000): boolean {
        return this.idleTime > thresholdMs;
    }

    /**
     * آخرین transcript کاربر
     */
    get lastTranscript(): string | null {
        if (this.segments.length === 0) return null;
        return this.segments[this.segments.length - 1].transcript;
    }

    /**
     * آخرین پاسخ صوتی ویرا
     */
    get lastResponse(): VoiceResponse | null {
        if (this.responses.length === 0) return null;
        return this.responses[this.responses.length - 1];
    }

    // ============================================================
    // 📊 METRICS
    // ============================================================

    /**
     * متریک‌های کامل جلسه صوتی
     *
     * @example
     * ```typescript
     * const m = session.metrics;
     * console.log(`Avg total latency: ${m.averageTotalLatency}ms`);
     * console.log(`Avg first byte: ${m.averageFirstByteLatency}ms`);
     * console.log(`Interruptions: ${m.interruptionCount}`);
     * ```
     */
    get metrics(): VoiceSessionMetrics {
        const sttLatencies = this.segments.map((s) => s.sttLatencyMs);
        const llmLatencies = this.responses.map((r) => r.llmLatencyMs);
        const ttsLatencies = this.responses.map((r) => r.ttsLatencyMs);
        const totalLatencies = this.responses.map((r) => r.totalLatencyMs);
        const firstByteLatencies = this.responses.map((r) => r.firstByteLatencyMs);
        const sttConfidences = this.segments.map((s) => s.sttConfidence);

        const agents = new Set<AgentType>();
        for (const r of this.responses) {
            agents.add(r.agentType);
        }

        return {
            totalDuration: this.connectionDuration,
            totalSpeechSegments: this.segments.length,
            totalResponses: this.responses.length,
            averageSTTLatency: VoiceSession.avg(sttLatencies),
            averageLLMLatency: VoiceSession.avg(llmLatencies),
            averageTTSLatency: VoiceSession.avg(ttsLatencies),
            averageTotalLatency: VoiceSession.avg(totalLatencies),
            averageFirstByteLatency: VoiceSession.avg(firstByteLatencies),
            totalUserSpeechDuration: this.segments.reduce(
                (sum, s) => sum + s.durationMs, 0,
            ),
            totalBotSpeechDuration: ttsLatencies.reduce(
                (sum, t) => sum + t, 0,
            ),
            averageSTTConfidence: VoiceSession.avg(sttConfidences),
            interruptionCount: this.interruptionCount,
            errorCount: this.errorCount,
            agentsUsed: [...agents],
        };
    }

    /**
     * خلاصه latency آخرین تعامل
     */
    get lastLatencyBreakdown(): {
        stt: number;
        llm: number;
        tts: number;
        total: number;
        firstByte: number;
    } | null {
        const lastResp = this.lastResponse;
        if (!lastResp) return null;

        const lastSeg = this.segments[this.segments.length - 1];

        return {
            stt: lastSeg?.sttLatencyMs ?? 0,
            llm: lastResp.llmLatencyMs,
            tts: lastResp.ttsLatencyMs,
            total: lastResp.totalLatencyMs,
            firstByte: lastResp.firstByteLatencyMs,
        };
    }

    // ============================================================
    // 📦 SERIALIZATION
    // ============================================================

    /**
     * خلاصه وضعیت (برای logging)
     */
    toStatusLine(): string {
        const state = this.state.padEnd(12);
        const segs = this.segments.length;
        const resps = this.responses.length;
        const dur = Math.round(this.connectionDuration / 1000);
        const avgLatency = this.metrics.averageTotalLatency;

        return `[🎙️ ${this.channelId}] ${state} | ${segs} segs | ${resps} resps | ${dur}s | avg: ${avgLatency}ms`;
    }

    /**
     * Debug View
     */
    toDebugView(): string {
        const m = this.metrics;
        const lines: string[] = [
            "┌──────────────────────────────────────────┐",
            "│         🎙️ VOICE SESSION DEBUG           │",
            "├──────────────────────────────────────────┤",
            `│ State: ${this.state.padEnd(32)}│`,
            `│ Channel: ${this.channelId.padEnd(30)}│`,
            `│ Duration: ${String(Math.round(this.connectionDuration / 1000) + "s").padEnd(29)}│`,
            `│ Segments: ${String(m.totalSpeechSegments).padEnd(29)}│`,
            `│ Responses: ${String(m.totalResponses).padEnd(28)}│`,
            `│ Interruptions: ${String(m.interruptionCount).padEnd(24)}│`,
            `│ Errors: ${String(m.errorCount).padEnd(31)}│`,
            "├──────────────────────────────────────────┤",
            "│ Latencies (avg):                         │",
            `│   STT:        ${String(Math.round(m.averageSTTLatency) + "ms").padEnd(25)}│`,
            `│   LLM:        ${String(Math.round(m.averageLLMLatency) + "ms").padEnd(25)}│`,
            `│   TTS:        ${String(Math.round(m.averageTTSLatency) + "ms").padEnd(25)}│`,
            `│   Total:      ${String(Math.round(m.averageTotalLatency) + "ms").padEnd(25)}│`,
            `│   First Byte: ${String(Math.round(m.averageFirstByteLatency) + "ms").padEnd(25)}│`,
            "├──────────────────────────────────────────┤",
            `│ STT Confidence: ${String(Math.round(m.averageSTTConfidence * 100) + "%").padEnd(23)}│`,
            `│ VAD Energy: ${String(Math.round(this.vad.currentEnergy * 100) + "%").padEnd(27)}│`,
            `│ VAD Speaking: ${String(this.vad.isSpeaking).padEnd(25)}│`,
            `│ TTS Streaming: ${String(this.ttsStream.isStreaming).padEnd(24)}│`,
            "└──────────────────────────────────────────┘",
        ];

        return lines.join("\n");
    }

    /**
     * Timeline خوانا
     */
    toTimelineView(): string {
        if (this.timeline.length === 0) return "No events yet";

        const baseTime = this.timeline[0].timestamp.getTime();

        return this.timeline.map((event) => {
            const offset = event.timestamp.getTime() - baseTime;
            const offsetStr = `+${Math.round(offset)}ms`.padEnd(10);
            const duration = event.durationMs ? ` (${event.durationMs}ms)` : "";
            return `${offsetStr} ${event.type}${duration}`;
        }).join("\n");
    }

    /**
     * JSON
     */
    toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            channelId: this.channelId,
            userId: this.userId,
            state: this.state,
            isConnected: this.isConnected,
            connectionDuration: this.connectionDuration,
            segments: this.segments.length,
            responses: this.responses.length,
            interruptionCount: this.interruptionCount,
            errorCount: this.errorCount,
            lastError: this.lastError,
            metrics: this.metrics,
            vad: this.vad,
            ttsStream: {
                isStreaming: this.ttsStream.isStreaming,
                chunksSent: this.ttsStream.chunksSent,
            },
            options: this.options,
            connectedAt: this.connectedAt?.toISOString(),
            lastActivityAt: this.lastActivityAt.toISOString(),
        };
    }

    // ============================================================
    // 🔧 PRIVATE HELPERS
    // ============================================================

    /**
     * State transition با validation
     */
    private transition(
        newState: VoiceState,
        overrides: Partial<{
            connectedAt: Date | null;
            lastActivityAt: Date;
            vad: VADState;
            ttsStream: TTSStreamState;
            conversation: Conversation;
            currentSegment: SpeechSegment | null;
            currentResponse: Partial<VoiceResponse> | null;
            pendingTranscript: string | null;
            segments: readonly SpeechSegment[];
            responses: readonly VoiceResponse[];
            timeline: readonly VoiceTimelineEvent[];
            interruptionCount: number;
            errorCount: number;
            lastError: string | null;
            options: Required<VoiceSessionOptions>;
        }> = {},
    ): VoiceSession {
        // Validate transition
        if (!VoiceSession.isValidTransition(this.state, newState)) {
            console.warn(
                `[VoiceSession] Invalid transition: ${this.state} → ${newState}`,
            );
            return this;
        }

        return new VoiceSession({
            id: this.id,
            channelId: this.channelId,
            userId: this.userId,
            guildId: this.guildId,
            state: newState,
            previousState: this.state,
            vad: overrides.vad ?? this.vad,
            ttsStream: overrides.ttsStream ?? this.ttsStream,
            conversation: overrides.conversation ?? this.conversation,
            currentSegment: overrides.currentSegment ?? this.currentSegment,
            currentResponse: overrides.currentResponse ?? this.currentResponse,
            pendingTranscript: overrides.pendingTranscript ?? this.pendingTranscript,
            segments: overrides.segments ?? this.segments,
            responses: overrides.responses ?? this.responses,
            timeline: overrides.timeline ?? this.timeline,
            interruptionCount: overrides.interruptionCount ?? this.interruptionCount,
            errorCount: overrides.errorCount ?? this.errorCount,
            lastError: overrides.lastError ?? this.lastError,
            options: overrides.options ?? this.options,
            connectedAt: overrides.connectedAt ?? this.connectedAt,
            lastActivityAt: overrides.lastActivityAt ?? this.lastActivityAt,
        });
    }

    /**
     * Validation of state transitions
     *
     * ```
     * connecting → idle
     * idle → listening | paused | disconnected | error
     * listening → processing | idle | speaking(interrupt) | error
     * processing → thinking | idle(empty) | error
     * thinking → speaking | error
     * speaking → idle | listening(interrupt) | error
     * paused → idle | disconnected
     * error → idle(recover) | disconnected
     * ```
     */
    private static isValidTransition(
        from: VoiceState,
        to: VoiceState,
    ): boolean {
        const transitions: Record<VoiceState, VoiceState[]> = {
            connecting: ["idle", "error", "disconnected"],
            idle: ["listening", "paused", "disconnected", "error"],
            listening: ["processing", "idle", "speaking", "error", "disconnected"],
            processing: ["thinking", "idle", "error", "disconnected"],
            thinking: ["speaking", "idle", "error", "disconnected"],
            speaking: ["idle", "listening", "error", "disconnected"],
            paused: ["idle", "disconnected", "error"],
            disconnected: [],
            error: ["idle", "disconnected"],
        };

        return transitions[from]?.includes(to) ?? false;
    }

    /**
     * Clone
     */
    private clone(
        overrides: Partial<{
            vad: VADState;
            ttsStream: TTSStreamState;
            conversation: Conversation;
            currentSegment: SpeechSegment | null;
            currentResponse: Partial<VoiceResponse> | null;
            pendingTranscript: string | null;
            segments: readonly SpeechSegment[];
            responses: readonly VoiceResponse[];
            timeline: readonly VoiceTimelineEvent[];
            interruptionCount: number;
            errorCount: number;
            lastError: string | null;
            options: Required<VoiceSessionOptions>;
            connectedAt: Date | null;
            lastActivityAt: Date;
        }>,
    ): VoiceSession {
        return new VoiceSession({
            id: this.id,
            channelId: this.channelId,
            userId: this.userId,
            guildId: this.guildId,
            state: this.state,
            previousState: this.previousState,
            vad: overrides.vad ?? this.vad,
            ttsStream: overrides.ttsStream ?? this.ttsStream,
            conversation: overrides.conversation ?? this.conversation,
            currentSegment: overrides.currentSegment ?? this.currentSegment,
            currentResponse: overrides.currentResponse ?? this.currentResponse,
            pendingTranscript: overrides.pendingTranscript ?? this.pendingTranscript,
            segments: overrides.segments ?? this.segments,
            responses: overrides.responses ?? this.responses,
            timeline: overrides.timeline ?? this.timeline,
            interruptionCount: overrides.interruptionCount ?? this.interruptionCount,
            errorCount: overrides.errorCount ?? this.errorCount,
            lastError: overrides.lastError ?? this.lastError,
            options: overrides.options ?? this.options,
            connectedAt: overrides.connectedAt ?? this.connectedAt,
            lastActivityAt: overrides.lastActivityAt ?? this.lastActivityAt,
        });
    }

    /**
     * محاسبه میانگین
     */
    private static avg(numbers: number[]): number {
        if (numbers.length === 0) return 0;
        const sum = numbers.reduce((a, b) => a + b, 0);
        return Math.round(sum / numbers.length);
    }
}