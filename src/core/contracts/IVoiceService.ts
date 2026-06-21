// src/core/contracts/IVoiceService.ts

import type { VoiceSession, VoiceSessionOptions, VoiceSessionMetrics, SpeechSegment, VoiceResponse } from "../domain/entities/VoiceSession";
import type { Message } from "../domain/entities/Message";
import type { Conversation } from "../domain/entities/Conversation";
import type { AgentType } from "../domain/types/AgentType";

// ============================================================
// 📐 TYPES - VAD
// ============================================================

/**
 * نتیجه تحلیل VAD
 */
export interface VADResult {
    /** آیا گفتار تشخیص داده شد؟ */
    readonly isSpeech: boolean;

    /** سطح انرژی صوتی (0-1) */
    readonly energy: number;

    /** احتمال گفتار (0-1) */
    readonly probability: number;

    /** مدت زمان گفتار فعلی (ms) */
    readonly speechDurationMs: number;

    /** مدت زمان سکوت فعلی (ms) */
    readonly silenceDurationMs: number;

    /** timestamp */
    readonly timestamp: Date;
}

/**
 * آپشن‌های VAD
 */
export interface VADOptions {
    /** آستانه تشخیص گفتار (0-1) */
    readonly threshold?: number;

    /** حداقل مدت گفتار (ms) */
    readonly minSpeechDuration?: number;

    /** مدت سکوت برای پایان گفتار (ms) */
    readonly silenceDuration?: number;

    /** sample rate ورودی */
    readonly sampleRate?: number;

    /** frame size */
    readonly frameSize?: number;
}

// ============================================================
// 📐 TYPES - STT
// ============================================================

/**
 * نتیجه STT
 */
export interface STTResult {
    /** متن تشخیص داده شده */
    readonly transcript: string;

    /** اطمینان (0-1) */
    readonly confidence: number;

    /** زبان تشخیص داده شده */
    readonly language: string;

    /** مدت زمان صوت ورودی (ms) */
    readonly audioDurationMs: number;

    /** زمان پردازش (ms) */
    readonly processingTimeMs: number;

    /** پروایدر */
    readonly provider: string;

    /** کلمات با timestamp (اگر موجود باشه) */
    readonly words?: STTWord[];
}

/**
 * یک کلمه با timestamp
 */
export interface STTWord {
    readonly word: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly confidence: number;
}

/**
 * آپشن‌های STT
 */
export interface STTOptions {
    /** زبان */
    readonly language?: string;

    /** مدل */
    readonly model?: string;

    /** translate به انگلیسی؟ */
    readonly translate?: boolean;

    /** word timestamps فعال باشه؟ */
    readonly wordTimestamps?: boolean;

    /** prompt برای بهبود دقت */
    readonly prompt?: string;
}

// ============================================================
// 📐 TYPES - TTS
// ============================================================

/**
 * نتیجه TTS
 */
export interface TTSResult {
    /** بافر صوتی */
    readonly audioBuffer: Buffer;

    /** فرمت صوتی */
    readonly format: "pcm" | "opus" | "mp3" | "wav";

    /** sample rate */
    readonly sampleRate: number;

    /** مدت زمان صدا (ms) */
    readonly durationMs: number;

    /** زمان پردازش (ms) */
    readonly processingTimeMs: number;

    /** پروایدر */
    readonly provider: string;
}

/**
 * یک chunk صوتی TTS (برای streaming)
 */
export interface TTSChunk {
    /** بافر صوتی chunk */
    readonly audioBuffer: Buffer;

    /** ایندکس chunk */
    readonly index: number;

    /** آیا آخرین chunk هست؟ */
    readonly isLast: boolean;

    /** متن این chunk */
    readonly text: string;

    /** زمان تولید (ms) */
    readonly generationTimeMs: number;
}

/**
 * آپشن‌های TTS
 */
export interface TTSOptions {
    /** صدا */
    readonly voice?: string;

    /** سرعت */
    readonly rate?: string;

    /** حجم صدا */
    readonly volume?: string;

    /** زیر و بمی */
    readonly pitch?: string;

    /** فرمت خروجی */
    readonly format?: "pcm" | "opus" | "mp3" | "wav";

    /** sample rate */
    readonly sampleRate?: number;

    /** streaming فعال باشه؟ */
    readonly streaming?: boolean;
}

/**
 * Callbacks برای TTS Streaming
 */
export interface TTSStreamCallbacks {
    /** هر chunk صوتی آماده شد */
    onChunk: (chunk: TTSChunk) => void | Promise<void>;

    /** پخش تمام شد */
    onComplete?: (result: TTSResult) => void;

    /** خطا رخ داد */
    onError?: (error: VoiceError) => void;
}

/**
 * کنترلر TTS Stream
 */
export interface TTSStreamController {
    /** متوقف کردن فوری */
    stop: () => void;

    /** آیا متوقف شده؟ */
    readonly isStopped: boolean;

    /** Promise نهایی */
    readonly completed: Promise<TTSResult>;
}

// ============================================================
// 📐 TYPES - Audio Connection
// ============================================================

/**
 * وضعیت اتصال صوتی
 */
export type AudioConnectionState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "ready"
    | "error";

/**
 * اطلاعات اتصال صوتی
 */
export interface AudioConnectionInfo {
    readonly state: AudioConnectionState;
    readonly channelId: string;
    readonly guildId: string;
    readonly ping: number;
    readonly jitter: number;
    readonly packetLoss: number;
    readonly connectedAt: Date | null;
}

/**
 * یک فریم صوتی خام از Discord
 */
export interface AudioFrame {
    readonly userId: string;
    readonly buffer: Buffer;
    readonly timestamp: number;
    readonly sampleRate: number;
    readonly channels: number;
}

// ============================================================
// 📐 TYPES - Errors
// ============================================================

/**
 * انواع خطاهای صوتی
 */
export type VoiceErrorType =
    | "connection-failed"
    | "connection-lost"
    | "vad-error"
    | "stt-error"
    | "tts-error"
    | "audio-error"
    | "permission-denied"
    | "channel-full"
    | "timeout"
    | "unknown";

/**
 * خطای صوتی
 */
export interface VoiceError {
    readonly type: VoiceErrorType;
    readonly message: string;
    readonly stage: "connection" | "vad" | "stt" | "tts" | "playback";
    readonly recoverable: boolean;
    readonly details?: Record<string, unknown>;
}

// ============================================================
// 🎤 VAD INTERFACE
// ============================================================

/**
 * سرویس تشخیص فعالیت صوتی
 *
 * VAD تعیین می‌کنه کِی کاربر داره حرف می‌زنه
 *
 * ```
 * Audio Stream → VAD → isSpeech? → yes → Buffer Audio
 *                                → no  → Check Silence Duration
 *                                            → threshold met → Emit Speech End
 * ```
 *
 * @example
 * ```typescript
 * const vad: IVAD = new SileroVAD({ threshold: 0.5 });
 *
 * await vad.initialize();
 *
 * audioStream.on("data", (frame) => {
 *   const result = await vad.process(frame);
 *
 *   if (result.isSpeech) {
 *     audioBuffer.push(frame);
 *   } else if (result.silenceDurationMs > 1500) {
 *     // پایان گفتار
 *     const audio = audioBuffer.flush();
 *     const transcript = await stt.transcribe(audio);
 *   }
 * });
 * ```
 */
export interface IVAD {
    /**
     * مقداردهی اولیه (load model)
     */
    initialize(): Promise<void>;

    /**
     * پردازش یک فریم صوتی
     */
    process(frame: AudioFrame): Promise<VADResult>;

    /**
     * ریست state
     */
    reset(): void;

    /**
     * تغییر آستانه
     */
    setThreshold(threshold: number): void;

    /**
     * آیا آماده به کار هست؟
     */
    isReady(): boolean;

    /**
     * آزادسازی منابع
     */
    dispose(): Promise<void>;
}

// ============================================================
// 📝 STT INTERFACE
// ============================================================

/**
 * سرویس تبدیل صدا به متن
 *
 * ```
 * Audio Buffer → STT → Transcript
 * ```
 *
 * @example
 * ```typescript
 * const stt: ISTT = new WhisperClient({ model: "base", language: "fa" });
 *
 * const result = await stt.transcribe(audioBuffer, {
 *   language: "fa",
 * });
 *
 * console.log(result.transcript);   // "سلام ویرا خوبی؟"
 * console.log(result.confidence);   // 0.94
 * ```
 */
export interface ISTT {
    /**
     * مقداردهی اولیه
     */
    initialize(): Promise<void>;

    /**
     * تبدیل صدا به متن
     */
    transcribe(
        audio: Buffer,
        options?: STTOptions,
    ): Promise<STTResult>;

    /**
     * تبدیل صدا به متن (streaming - realtime)
     *
     * برای transcription لحظه‌ای بدون صبر کردن تا پایان گفتار
     */
    transcribeStream(
        audioStream: AsyncIterable<Buffer>,
        options?: STTOptions,
    ): AsyncIterable<Partial<STTResult>>;

    /**
     * بررسی سلامت
     */
    healthCheck(): Promise<{
        available: boolean;
        provider: string;
        model: string;
        latencyMs?: number;
    }>;

    /**
     * آیا آماده هست؟
     */
    isReady(): boolean;

    /**
     * آزادسازی منابع
     */
    dispose(): Promise<void>;
}

// ============================================================
// 🔊 TTS INTERFACE
// ============================================================

/**
 * سرویس تبدیل متن به صدا
 *
 * دو مدل:
 * 1. تولید کامل (synthesize) → یکجا تولید و پخش
 * 2. استریمینگ (synthesizeStream) → chunk به chunk تولید و پخش
 *
 * ```
 * Text → TTS → Audio Buffer → Discord Speaker
 *
 * Streaming:
 * "سلام! " → TTS Chunk 1 → Play
 * "خوبی؟ " → TTS Chunk 2 → Play (while generating next)
 * "چی شده؟" → TTS Chunk 3 → Play
 * ```
 *
 * @example
 * ```typescript
 * const tts: ITTS = new EdgeTTS({ voice: "fa-IR-DilaraNeural" });
 *
 * // Non-streaming
 * const result = await tts.synthesize("سلام! خوبی؟");
 * playAudio(result.audioBuffer);
 *
 * // Streaming (برای latency پایین)
 * const controller = await tts.synthesizeStream(
 *   "سلام! حالت چطوره؟ امروز چیکار کردی؟",
 *   { streaming: true },
 *   {
 *     onChunk: async (chunk) => {
 *       await playChunk(chunk.audioBuffer);
 *     },
 *     onComplete: (result) => {
 *       console.log(`Total duration: ${result.durationMs}ms`);
 *     },
 *   },
 * );
 *
 * // اگر کاربر interrupt کرد:
 * controller.stop();
 * ```
 */
export interface ITTS {
    /**
     * مقداردهی اولیه
     */
    initialize(): Promise<void>;

    /**
     * تولید صدا (Non-streaming)
     */
    synthesize(
        text: string,
        options?: TTSOptions,
    ): Promise<TTSResult>;

    /**
     * تولید صدا (Streaming)
     *
     * متن رو به جملات تقسیم و chunk به chunk تولید می‌کنه
     */
    synthesizeStream(
        text: string,
        options: TTSOptions,
        callbacks: TTSStreamCallbacks,
    ): Promise<TTSStreamController>;

    /**
     * لیست صداهای موجود
     */
    listVoices(): Promise<VoiceInfo[]>;

    /**
     * بررسی سلامت
     */
    healthCheck(): Promise<{
        available: boolean;
        provider: string;
        latencyMs?: number;
    }>;

    /**
     * آیا آماده هست؟
     */
    isReady(): boolean;

    /**
     * آزادسازی منابع
     */
    dispose(): Promise<void>;
}

/**
 * اطلاعات یک صدا
 */
export interface VoiceInfo {
    readonly id: string;
    readonly name: string;
    readonly language: string;
    readonly gender: "male" | "female" | "neutral";
    readonly provider: string;
    readonly preview?: string;
}

// ============================================================
// 🔌 AUDIO CONNECTION INTERFACE
// ============================================================

/**
 * مدیریت اتصال صوتی Discord
 *
 * ```
 * Bot → Join Voice Channel → Receive Audio Frames
 *                          → Send Audio Frames
 * ```
 *
 * @example
 * ```typescript
 * const connection: IAudioConnection = new DiscordVoiceConnection();
 *
 * await connection.join("channel_123", "guild_456");
 *
 * connection.onAudioFrame(async (frame) => {
 *   const vadResult = await vad.process(frame);
 *   // ...
 * });
 *
 * await connection.playAudio(audioBuffer);
 * ```
 */
export interface IAudioConnection {
    /**
     * اتصال به voice channel
     */
    join(
        channelId: string,
        guildId: string,
    ): Promise<void>;

    /**
     * قطع اتصال
     */
    leave(): Promise<void>;

    /**
     * آیا متصل هست؟
     */
    isConnected(): boolean;

    /**
     * اطلاعات اتصال
     */
    getConnectionInfo(): AudioConnectionInfo;

    /**
     * دریافت فریم‌های صوتی کاربران
     */
    onAudioFrame(
        handler: (frame: AudioFrame) => void | Promise<void>,
    ): () => void;

    /**
     * پخش صدا در voice channel
     */
    playAudio(
        audio: Buffer,
        options?: {
            format?: "pcm" | "opus";
            sampleRate?: number;
            channels?: number;
        },
    ): Promise<void>;

    /**
     * پخش streaming صدا
     */
    playStream(
        audioStream: AsyncIterable<Buffer>,
        options?: {
            format?: "pcm" | "opus";
            sampleRate?: number;
        },
    ): Promise<void>;

    /**
     * متوقف کردن پخش فعلی
     */
    stopPlaying(): void;

    /**
     * آیا در حال پخش هست؟
     */
    isPlaying(): boolean;

    /**
     * Mute/Unmute ربات
     */
    setSelfMute(muted: boolean): void;

    /**
     * Deafen ربات
     */
    setSelfDeaf(deafened: boolean): void;
}

// ============================================================
// 🎙️ MAIN INTERFACE - IVoiceService
// ============================================================

/**
 * سرویس اصلی صوتی ویرا
 *
 * Orchestrator کل Voice Pipeline:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────┐
 * │                    IVoiceService                        │
 * │                                                         │
 * │  🎤 Mic                                    🔊 Speaker  │
 * │   │                                            ▲       │
 * │   ▼                                            │       │
 * │  ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐      │       │
 * │  │ VAD │──▶│ STT │──▶│ LLM │──▶│ TTS │──────┘       │
 * │  └─────┘   └─────┘   └─────┘   └─────┘              │
 * │   150ms     300ms     1200ms     800ms                │
 * │                                                         │
 * │  Streaming TTS: Send to speaker as soon as first       │
 * │  sentence is ready, don't wait for full response       │
 * └─────────────────────────────────────────────────────────┘
 * ```
 *
 * @example
 * ```typescript
 * class VoiceHandler {
 *   constructor(private voice: IVoiceService) {}
 *
 *   async onUserJoinVoice(channelId: string, userId: string, guildId: string) {
 *     // شروع session
 *     const session = await this.voice.startSession({
 *       channelId,
 *       userId,
 *       guildId,
 *       options: {
 *         vadThreshold: 0.5,
 *         sttProvider: "whisper-local",
 *         ttsProvider: "edge-tts",
 *       },
 *     });
 *
 *     console.log(`Voice session started: ${session.id}`);
 *   }
 *
 *   async onUserLeaveVoice(channelId: string) {
 *     await this.voice.endSession(channelId);
 *   }
 * }
 * ```
 */
export interface IVoiceService {
    // ─── Session Management ───────────────────────────────

    /**
     * شروع یک session صوتی جدید
     *
     * شامل:
     * 1. اتصال به voice channel
     * 2. مقداردهی VAD
     * 3. آماده‌سازی STT و TTS
     * 4. شروع گوش دادن
     */
    startSession(params: {
        channelId: string;
        userId: string;
        guildId: string;
        options?: VoiceSessionOptions;
    }): Promise<VoiceSession>;

    /**
     * پایان session
     */
    endSession(channelId: string): Promise<VoiceSession | null>;

    /**
     * دریافت session فعال
     */
    getSession(channelId: string): VoiceSession | undefined;

    /**
     * لیست تمام sessionهای فعال
     */
    getActiveSessions(): VoiceSession[];

    /**
     * آیا session فعالی برای این کانال وجود داره؟
     */
    hasActiveSession(channelId: string): boolean;

    // ─── Voice Pipeline Control ───────────────────────────

    /**
     * پخش پاسخ صوتی
     *
     * متن رو به صدا تبدیل و پخش می‌کنه
     * اگر streaming فعال باشه، chunk به chunk پخش می‌کنه
     *
     * @example
     * ```typescript
     * await voice.speak("ch_123", "سلام! خوبی عزیزم؟ 💚", {
     *   streaming: true,
     *   agentType: "companion",
     * });
     * ```
     */
    speak(
        channelId: string,
        text: string,
        options?: {
            streaming?: boolean;
            voice?: string;
            agentType?: AgentType;
        },
    ): Promise<VoiceResponse>;

    /**
     * متوقف کردن پخش فعلی
     *
     * برای interruption handling
     */
    stopSpeaking(channelId: string): void;

    /**
     * آیا ویرا در حال حرف زدنه؟
     */
    isSpeaking(channelId: string): boolean;

    /**
     * Pause گوش دادن (مثلاً وقتی ویرا داره حرف میزنه)
     */
    pauseListening(channelId: string): void;

    /**
     * Resume گوش دادن
     */
    resumeListening(channelId: string): void;

    // ─── Direct STT/TTS Access ────────────────────────────

    /**
     * تبدیل صدا به متن (مستقیم)
     *
     * بدون نیاز به session
     */
    transcribe(
        audio: Buffer,
        options?: STTOptions,
    ): Promise<STTResult>;

    /**
     * تبدیل متن به صدا (مستقیم)
     *
     * بدون نیاز به session
     */
    synthesize(
        text: string,
        options?: TTSOptions,
    ): Promise<TTSResult>;

    // ─── Event Callbacks ──────────────────────────────────

    /**
     * وقتی کاربر شروع به حرف زدن کرد
     */
    onSpeechStart(
        handler: (session: VoiceSession) => void | Promise<void>,
    ): () => void;

    /**
     * وقتی transcript آماده شد
     */
    onTranscript(
        handler: (
            session: VoiceSession,
            transcript: string,
            confidence: number,
        ) => void | Promise<void>,
    ): () => void;

    /**
     * وقتی ویرا پاسخ صوتی داد
     */
    onResponse(
        handler: (
            session: VoiceSession,
            response: VoiceResponse,
        ) => void | Promise<void>,
    ): () => void;

    /**
     * وقتی کاربر interrupt کرد
     */
    onInterruption(
        handler: (session: VoiceSession) => void | Promise<void>,
    ): () => void;

    /**
     * وقتی خطا رخ داد
     */
    onError(
        handler: (
            session: VoiceSession,
            error: VoiceError,
        ) => void | Promise<void>,
    ): () => void;

    // ─── Configuration ────────────────────────────────────

    /**
     * تغییر VAD threshold
     */
    setVADThreshold(
        channelId: string,
        threshold: number,
    ): void;

    /**
     * تغییر صدای TTS
     */
    setVoice(
        channelId: string,
        voice: string,
    ): void;

    /**
     * تغییر STT provider
     */
    setSTTProvider(provider: string): Promise<void>;

    /**
     * تغییر TTS provider
     */
    setTTSProvider(provider: string): Promise<void>;

    // ─── Health & Metrics ─────────────────────────────────

    /**
     * بررسی سلامت تمام سرویس‌ها
     */
    healthCheck(): Promise<{
        vad: { available: boolean; provider: string };
        stt: { available: boolean; provider: string; model: string };
        tts: { available: boolean; provider: string };
        audio: { connected: boolean; channels: number };
    }>;

    /**
     * متریک‌های یک session
     */
    getSessionMetrics(channelId: string): VoiceSessionMetrics | undefined;

    /**
     * متریک‌های کل سرویس
     */
    getServiceMetrics(): VoiceServiceMetrics;

    /**
     * لیست صداهای موجود
     */
    listVoices(): Promise<VoiceInfo[]>;

    // ─── Lifecycle ────────────────────────────────────────

    /**
     * مقداردهی اولیه سرویس
     *
     * Load models, connect to providers, etc.
     */
    initialize(): Promise<void>;

    /**
     * آیا سرویس آماده هست؟
     */
    isReady(): boolean;

    /**
     * آزادسازی تمام منابع
     */
    dispose(): Promise<void>;
}

/**
 * متریک‌های کل سرویس صوتی
 */
export interface VoiceServiceMetrics {
    readonly activeSessions: number;
    readonly totalSessionsCreated: number;
    readonly totalTranscriptions: number;
    readonly totalSynthesizations: number;
    readonly totalInterruptions: number;
    readonly totalErrors: number;
    readonly averageSTTLatency: number;
    readonly averageTTSLatency: number;
    readonly averageTotalLatency: number;
    readonly averageFirstByteLatency: number;
    readonly uptime: number;
}

// ============================================================
// 🎵 AUDIO BUFFER INTERFACE
// ============================================================

/**
 * بافر صوتی هوشمند
 *
 * جمع‌آوری فریم‌های صوتی بین speech-start و speech-end
 *
 * @example
 * ```typescript
 * const buffer: IAudioBuffer = new AudioBuffer({
 *   sampleRate: 48000,
 *   channels: 1,
 *   maxDurationMs: 30000,
 * });
 *
 * // VAD: speech started
 * buffer.start();
 *
 * // فریم‌ها میان
 * buffer.push(frame1);
 * buffer.push(frame2);
 *
 * // VAD: speech ended
 * const audio = buffer.flush();
 *
 * // ارسال به STT
 * const result = await stt.transcribe(audio);
 * ```
 */
export interface IAudioBuffer {
    /**
     * شروع ضبط
     */
    start(): void;

    /**
     * اضافه کردن فریم صوتی
     */
    push(frame: Buffer): void;

    /**
     * دریافت بافر نهایی و ریست
     */
    flush(): Buffer;

    /**
     * آیا در حال ضبط هست؟
     */
    isRecording(): boolean;

    /**
     * مدت ضبط فعلی (ms)
     */
    duration(): number;

    /**
     * حجم بافر (bytes)
     */
    size(): number;

    /**
     * ریست بدون دریافت داده
     */
    reset(): void;

    /**
     * آیا پُر شده؟ (maxDuration رسیده)
     */
    isFull(): boolean;
}

// ============================================================
// 🔧 SENTENCE SPLITTER INTERFACE
// ============================================================

/**
 * تقسیم‌کننده جملات برای Streaming TTS
 *
 * LLM خروجی رو توکن به توکن میده.
 * این splitter وقتی به پایان جمله رسید، جمله کامل رو برای TTS ارسال می‌کنه.
 *
 * ```
 * LLM tokens:  "سلام" "!" " " "خوب" "ی" "؟" " " "چی" "کار" ...
 *                          ↓                  ↓
 * Sentences:        "سلام!"            "خوبی؟"
 *                     ↓                   ↓
 * TTS:          generate audio      generate audio
 * ```
 *
 * @example
 * ```typescript
 * const splitter: ISentenceSplitter = new SentenceSplitter({
 *   breakOn: [".", "!", "?", "،", "؟"],
 *   minLength: 20,
 * });
 *
 * llm.stream(request, {
 *   onChunk: (chunk) => {
 *     const sentence = splitter.feed(chunk.content);
 *     if (sentence) {
 *       tts.speak(sentence);
 *     }
 *   },
 *   onComplete: () => {
 *     const remaining = splitter.flush();
 *     if (remaining) {
 *       tts.speak(remaining);
 *     }
 *   },
 * });
 * ```
 */
export interface ISentenceSplitter {
    /**
     * تغذیه متن جدید
     *
     * @returns جمله کامل (اگر آماده شد) یا null
     */
    feed(text: string): string | null;

    /**
     * دریافت باقیمانده بافر
     */
    flush(): string | null;

    /**
     * ریست
     */
    reset(): void;

    /**
     * بافر فعلی
     */
    getBuffer(): string;

    /**
     * تعداد جملات تولید شده
     */
    getSentenceCount(): number;
}

// ============================================================
// 🛠️ HELPER FUNCTIONS
// ============================================================

/**
 * ساخت VoiceError
 */
export function createVoiceError(
    type: VoiceErrorType,
    stage: VoiceError["stage"],
    message: string,
    details?: Record<string, unknown>,
): VoiceError {
    const recoverable: VoiceErrorType[] = [
        "vad-error",
        "stt-error",
        "tts-error",
        "timeout",
    ];

    return {
        type,
        message,
        stage,
        recoverable: recoverable.includes(type),
        details,
    };
}

/**
 * تخمین مدت زمان TTS (ms)
 *
 * تقریب: هر ۱۰ کاراکتر فارسی ≈ ۱ ثانیه
 */
export function estimateTTSDuration(text: string): number {
    const persianChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    const otherChars = text.length - persianChars;

    const persianDuration = (persianChars / 10) * 1000;
    const otherDuration = (otherChars / 15) * 1000;

    return Math.round(persianDuration + otherDuration);
}

/**
 * محاسبه latency grade
 */
export function latencyGrade(totalMs: number): {
    grade: "excellent" | "good" | "acceptable" | "poor";
    emoji: string;
} {
    if (totalMs < 1500) return { grade: "excellent", emoji: "🟢" };
    if (totalMs < 2500) return { grade: "good", emoji: "🟡" };
    if (totalMs < 4000) return { grade: "acceptable", emoji: "🟠" };
    return { grade: "poor", emoji: "🔴" };
}