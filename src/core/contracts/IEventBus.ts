// src/core/contracts/IEventBus.ts

import type { Message } from "../domain/entities/Message";
import type { Conversation } from "../domain/entities/Conversation";
import type { VoiceSession, VoiceResponse, SpeechSegment } from "../domain/entities/VoiceSession";
import type { MemoryEntry } from "../domain/entities/memory/MemoryEntry";
import type { MemorySnapshot } from "../domain/entities/memory/MemorySnapshot";
import type { AgentType } from "../domain/types/AgentType";
import type { LLMResponse, LLMError } from "./ILLMPort";

// ============================================================
// 📐 EVENT DEFINITIONS
// ============================================================

/**
 * تمام رویدادهای سیستم ویرا
 *
 * هر رویداد یک payload مشخص دارد.
 * هیچ رویدادی بدون type definition نباید وجود داشته باشد.
 *
 * Convention:
 *   domain.action.status
 *   message.received
 *   voice.speech.started
 *   agent.routing.completed
 */
export interface ViraEventMap {
    // ─── Message Events ───────────────────────────────────

    /** پیام جدید از کاربر دریافت شد */
    "message.received": {
        readonly message: Message;
        readonly conversation: Conversation;
    };

    /** پیام route شد به Agent */
    "message.routed": {
        readonly message: Message;
        readonly agentType: AgentType;
        readonly confidence: number;
        readonly strategy: "rule-based" | "llm" | "default";
    };

    /** پردازش پیام شروع شد */
    "message.processing.started": {
        readonly message: Message;
        readonly agentType: AgentType;
        readonly model: string;
        readonly provider: string;
    };

    /** استریم پاسخ شروع شد */
    "message.streaming.started": {
        readonly messageId: string;
        readonly agentType: AgentType;
    };

    /** یک chunk از پاسخ آماده شد */
    "message.streaming.chunk": {
        readonly messageId: string;
        readonly chunk: string;
        readonly accumulated: string;
    };

    /** یک جمله کامل آماده شد (برای TTS) */
    "message.streaming.sentence": {
        readonly messageId: string;
        readonly sentence: string;
        readonly sentenceIndex: number;
    };

    /** پاسخ کامل شد */
    "message.completed": {
        readonly message: Message;
        readonly response: string;
        readonly agentType: AgentType;
        readonly llmResponse: LLMResponse;
    };

    /** پردازش پیام شکست خورد */
    "message.failed": {
        readonly message: Message;
        readonly error: string;
        readonly agentType?: AgentType;
    };

    // ─── Voice Events ─────────────────────────────────────

    /** کاربر به voice channel وصل شد */
    "voice.connected": {
        readonly session: VoiceSession;
        readonly channelId: string;
        readonly userId: string;
        readonly guildId: string;
    };

    /** اتصال voice قطع شد */
    "voice.disconnected": {
        readonly session: VoiceSession;
        readonly reason: "user-left" | "bot-kicked" | "error" | "timeout";
        readonly duration: number;
    };

    /** شروع گفتار تشخیص داده شد (VAD) */
    "voice.speech.started": {
        readonly session: VoiceSession;
        readonly userId: string;
    };

    /** پایان گفتار (VAD سکوت تشخیص داد) */
    "voice.speech.ended": {
        readonly session: VoiceSession;
        readonly userId: string;
        readonly durationMs: number;
    };

    /** STT تبدیل صدا به متن کامل شد */
    "voice.stt.completed": {
        readonly session: VoiceSession;
        readonly segment: SpeechSegment;
        readonly transcript: string;
        readonly confidence: number;
        readonly latencyMs: number;
    };

    /** TTS شروع به پخش کرد */
    "voice.tts.started": {
        readonly session: VoiceSession;
        readonly text: string;
        readonly provider: string;
    };

    /** یک chunk صوتی TTS آماده شد */
    "voice.tts.chunk": {
        readonly sessionId: string;
        readonly chunkIndex: number;
        readonly isLast: boolean;
    };

    /** TTS پخش تمام شد */
    "voice.tts.completed": {
        readonly session: VoiceSession;
        readonly response: VoiceResponse;
        readonly latencyMs: number;
    };

    /** کاربر وسط حرف ویرا حرف زد */
    "voice.interrupted": {
        readonly session: VoiceSession;
        readonly interruptionCount: number;
        readonly wasPlayingChunk: number;
    };

    /** خطا در voice pipeline */
    "voice.error": {
        readonly session: VoiceSession;
        readonly error: string;
        readonly stage: "vad" | "stt" | "llm" | "tts" | "connection";
    };

    // ─── Agent Events ─────────────────────────────────────

    /** Agent انتخاب شد */
    "agent.selected": {
        readonly agentType: AgentType;
        readonly reason: string;
        readonly alternatives: Array<{
            agent: AgentType;
            confidence: number;
        }>;
    };

    /** Agent شروع به پردازش کرد */
    "agent.processing": {
        readonly agentType: AgentType;
        readonly messageId: string;
        readonly model: string;
    };

    /** Agent پاسخ داد */
    "agent.responded": {
        readonly agentType: AgentType;
        readonly messageId: string;
        readonly responseLength: number;
        readonly latencyMs: number;
        readonly tokensUsed: number;
    };

    /** Agent از tool استفاده کرد */
    "agent.tool.called": {
        readonly agentType: AgentType;
        readonly toolName: string;
        readonly arguments: Record<string, unknown>;
    };

    /** نتیجه tool برگشت */
    "agent.tool.completed": {
        readonly agentType: AgentType;
        readonly toolName: string;
        readonly success: boolean;
        readonly latencyMs: number;
    };

    // ─── Memory Events ────────────────────────────────────

    /** خاطره جدید ذخیره شد */
    "memory.created": {
        readonly entry: MemoryEntry;
        readonly section: string;
        readonly source: string;
    };

    /** خاطره بازیابی شد */
    "memory.recalled": {
        readonly entry: MemoryEntry;
        readonly query: string;
        readonly score: number;
        readonly recallCount: number;
    };

    /** خاطره pin شد */
    "memory.pinned": {
        readonly entry: MemoryEntry;
        readonly reason: string;
    };

    /** خاطره منقضی شد */
    "memory.expired": {
        readonly entryId: string;
        readonly type: string;
        readonly ageHours: number;
    };

    /** خلاصه‌سازی انجام شد */
    "memory.summarized": {
        readonly originalCount: number;
        readonly summaryLength: number;
        readonly freedTokens: number;
    };

    /** Context prune شد */
    "memory.pruned": {
        readonly removedCount: number;
        readonly freedTokens: number;
        readonly snapshotSize: number;
    };

    /** Context ذخیره شد */
    "memory.saved": {
        readonly channelId: string;
        readonly userId: string;
        readonly size: number;
        readonly version: number;
    };

    /** Context بارگذاری شد */
    "memory.loaded": {
        readonly channelId: string;
        readonly userId: string;
        readonly entries: number;
        readonly tokens: number;
    };

    // ─── Context Window Events ────────────────────────────

    /** Context Window ساخته شد */
    "context.built": {
        readonly agentType: AgentType;
        readonly totalTokens: number;
        readonly messageCount: number;
        readonly memoryEntries: number;
        readonly buildTimeMs: number;
    };

    /** Context Window به حد مجاز نزدیکه */
    "context.near-limit": {
        readonly totalTokens: number;
        readonly maxTokens: number;
        readonly usagePercent: number;
    };

    // ─── LLM Events ───────────────────────────────────────

    /** درخواست به LLM ارسال شد */
    "llm.request.sent": {
        readonly provider: string;
        readonly model: string;
        readonly promptTokens: number;
        readonly purpose: string;
        readonly streaming: boolean;
    };

    /** پاسخ از LLM دریافت شد */
    "llm.response.received": {
        readonly provider: string;
        readonly model: string;
        readonly usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
        readonly latencyMs: number;
        readonly tokensPerSecond: number;
    };

    /** LLM خطا داد */
    "llm.error": {
        readonly provider: string;
        readonly model: string;
        readonly error: LLMError;
    };

    /** Fallback فعال شد */
    "llm.fallback.activated": {
        readonly fromProvider: string;
        readonly toProvider: string;
        readonly reason: string;
    };

    /** Provider سوئیچ شد */
    "llm.provider.switched": {
        readonly from: string;
        readonly to: string;
        readonly reason: string;
    };

    // ─── Personality Events ───────────────────────────────

    /** Mood ویرا تغییر کرد */
    "personality.mood.changed": {
        readonly from: string;
        readonly to: string;
        readonly trigger: string;
    };

    /** سطح رابطه تغییر کرد */
    "personality.relationship.updated": {
        readonly userId: string;
        readonly level: number;
        readonly change: number;
    };

    // ─── System Events ────────────────────────────────────

    /** ربات آماده شد */
    "system.ready": {
        readonly timestamp: Date;
        readonly providers: string[];
        readonly agentsLoaded: AgentType[];
    };

    /** خطای سیستمی */
    "system.error": {
        readonly error: string;
        readonly component: string;
        readonly fatal: boolean;
    };

    /** متریک‌ها flush شدند */
    "system.metrics.flushed": {
        readonly metricsCount: number;
        readonly flushTimeMs: number;
    };

    /** Config تغییر کرد (hot reload) */
    "system.config.changed": {
        readonly changes: string[];
    };
}

// ============================================================
// 📐 CORE TYPES
// ============================================================

/**
 * نام رویداد = کلیدهای ViraEventMap
 */
export type EventName = keyof ViraEventMap;

/**
 * Payload یک رویداد
 */
export type EventPayload<E extends EventName> = ViraEventMap[E];

/**
 * Handler یک رویداد
 */
export type EventHandler<E extends EventName> = (
    payload: EventPayload<E>,
) => void | Promise<void>;

/**
 * یک رویداد کامل با metadata
 */
export interface DomainEvent<E extends EventName = EventName> {
    /** نام رویداد */
    readonly name: E;

    /** داده‌های رویداد */
    readonly payload: EventPayload<E>;

    /** زمان رخ دادن */
    readonly timestamp: Date;

    /** شناسه یکتا */
    readonly id: string;

    /** شناسه correlation (برای tracking یک flow) */
    readonly correlationId?: string;

    /** منبع رویداد */
    readonly source?: string;
}

/**
 * آپشن‌های subscribe
 */
export interface SubscribeOptions {
    /** فقط یک بار اجرا بشه */
    readonly once?: boolean;

    /** اولویت (بالاتر = زودتر اجرا) */
    readonly priority?: number;

    /** نام handler (برای debugging) */
    readonly name?: string;

    /** filter روی payload */
    readonly filter?: (payload: any) => boolean;
}

/**
 * تابع unsubscribe
 */
export type Unsubscribe = () => void;

// ============================================================
// 📡 MAIN INTERFACE - IEventBus
// ============================================================

/**
 * Event Bus اصلی سیستم ویرا
 *
 * تمام ارتباطات بین بخش‌های مختلف سیستم از این Bus عبور می‌کند.
 *
 * ```
 * MessageHandler ──publish──→ "message.received"
 *                                    │
 *                    ┌───────────────┼───────────────┐
 *                    ↓               ↓               ↓
 *              AgentRouter    ContextManager    MetricsCollector
 *                    │
 *              ──publish──→ "message.routed"
 *                                │
 *                          ┌─────┼─────┐
 *                          ↓           ↓
 *                     DevAgent    MetricsCollector
 * ```
 *
 * @example
 * ```typescript
 * // Subscribe
 * const unsub = eventBus.on("message.received", async (payload) => {
 *   const { message, conversation } = payload;
 *   await router.route(message);
 * });
 *
 * // Publish
 * await eventBus.emit("message.received", {
 *   message: msg,
 *   conversation: conv,
 * });
 *
 * // Unsubscribe
 * unsub();
 * ```
 */
export interface IEventBus {
    // ─── Subscribe ────────────────────────────────────────

    /**
     * عضویت در یک رویداد
     *
     * @returns تابع unsubscribe
     *
     * @example
     * ```typescript
     * const unsub = bus.on("message.received", async ({ message }) => {
     *   console.log(`New message: ${message.content}`);
     * });
     *
     * // بعداً:
     * unsub();
     * ```
     */
    on<E extends EventName>(
        event: E,
        handler: EventHandler<E>,
        options?: SubscribeOptions,
    ): Unsubscribe;

    /**
     * عضویت فقط یک بار
     *
     * @example
     * ```typescript
     * bus.once("system.ready", ({ timestamp }) => {
     *   console.log(`Bot ready at ${timestamp}`);
     * });
     * ```
     */
    once<E extends EventName>(
        event: E,
        handler: EventHandler<E>,
    ): Unsubscribe;

    /**
     * عضویت در چند رویداد با یک handler
     *
     * @example
     * ```typescript
     * bus.onMany(
     *   ["message.completed", "message.failed"],
     *   (payload) => {
     *     metrics.track(payload);
     *   },
     * );
     * ```
     */
    onMany<E extends EventName>(
        events: E[],
        handler: EventHandler<E>,
        options?: SubscribeOptions,
    ): Unsubscribe;

    /**
     * عضویت در تمام رویدادها (برای logging/metrics)
     *
     * @example
     * ```typescript
     * bus.onAll((event) => {
     *   logger.debug(`[Event] ${event.name}`, event.payload);
     * });
     * ```
     */
    onAll(
        handler: (event: DomainEvent) => void | Promise<void>,
    ): Unsubscribe;

    // ─── Publish ──────────────────────────────────────────

    /**
     * انتشار یک رویداد
     *
     * @example
     * ```typescript
     * await bus.emit("message.received", {
     *   message: msg,
     *   conversation: conv,
     * });
     * ```
     */
    emit<E extends EventName>(
        event: E,
        payload: EventPayload<E>,
        options?: {
            correlationId?: string;
            source?: string;
        },
    ): Promise<void>;

    /**
     * انتشار بدون انتظار (fire-and-forget)
     *
     * برای رویدادهای غیربحرانی مثل metrics
     *
     * @example
     * ```typescript
     * bus.emitAsync("system.metrics.flushed", {
     *   metricsCount: 42,
     *   flushTimeMs: 15,
     * });
     * ```
     */
    emitAsync<E extends EventName>(
        event: E,
        payload: EventPayload<E>,
    ): void;

    // ─── Management ───────────────────────────────────────

    /**
     * حذف تمام handlerهای یک رویداد
     */
    removeAllListeners(event?: EventName): void;

    /**
     * تعداد listener‌های یک رویداد
     */
    listenerCount(event: EventName): number;

    /**
     * لیست تمام رویدادهایی که listener دارند
     */
    activeEvents(): EventName[];

    /**
     * آمار event bus
     */
    stats(): EventBusStats;
}

// ============================================================
// 📊 STATS
// ============================================================

/**
 * آمار Event Bus
 */
export interface EventBusStats {
    /** تعداد کل رویدادهای منتشر شده */
    readonly totalEmitted: number;

    /** تعداد کل handler‌های فعال */
    readonly totalListeners: number;

    /** تعداد رویداد به تفکیک نام */
    readonly emittedPerEvent: Partial<Record<EventName, number>>;

    /** تعداد listener به تفکیک نام */
    readonly listenersPerEvent: Partial<Record<EventName, number>>;

    /** تعداد خطاهای handler */
    readonly handlerErrors: number;

    /** میانگین زمان اجرای handler (ms) */
    readonly averageHandlerTimeMs: number;
}

// ============================================================
// 🛠️ HELPER TYPES
// ============================================================

/**
 * ساخت DomainEvent
 */
export function createDomainEvent<E extends EventName>(
    name: E,
    payload: EventPayload<E>,
    options?: {
        correlationId?: string;
        source?: string;
    },
): DomainEvent<E> {
    return {
        name,
        payload,
        timestamp: new Date(),
        id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        correlationId: options?.correlationId,
        source: options?.source,
    };
}

/**
 * Type guard: آیا رویداد از نوع خاصی هست؟
 */
export function isEvent<E extends EventName>(
    event: DomainEvent,
    name: E,
): event is DomainEvent<E> {
    return event.name === name;
}

/**
 * گروه‌بندی رویدادها
 */
export const EVENT_GROUPS = {
    message: [
        "message.received",
        "message.routed",
        "message.processing.started",
        "message.streaming.started",
        "message.streaming.chunk",
        "message.streaming.sentence",
        "message.completed",
        "message.failed",
    ],

    voice: [
        "voice.connected",
        "voice.disconnected",
        "voice.speech.started",
        "voice.speech.ended",
        "voice.stt.completed",
        "voice.tts.started",
        "voice.tts.chunk",
        "voice.tts.completed",
        "voice.interrupted",
        "voice.error",
    ],

    agent: [
        "agent.selected",
        "agent.processing",
        "agent.responded",
        "agent.tool.called",
        "agent.tool.completed",
    ],

    memory: [
        "memory.created",
        "memory.recalled",
        "memory.pinned",
        "memory.expired",
        "memory.summarized",
        "memory.pruned",
        "memory.saved",
        "memory.loaded",
    ],

    llm: [
        "llm.request.sent",
        "llm.response.received",
        "llm.error",
        "llm.fallback.activated",
        "llm.provider.switched",
    ],

    system: [
        "system.ready",
        "system.error",
        "system.metrics.flushed",
        "system.config.changed",
    ],
} as const;

/**
 * آیا رویداد مربوط به voice هست؟
 */
export function isVoiceEvent(name: EventName): boolean {
    return name.startsWith("voice.");
}

/**
 * آیا رویداد مربوط به message هست؟
 */
export function isMessageEvent(name: EventName): boolean {
    return name.startsWith("message.");
}

/**
 * آیا رویداد مربوط به memory هست؟
 */
export function isMemoryEvent(name: EventName): boolean {
    return name.startsWith("memory.");
}

/**
 * آیا رویداد بحرانیه؟ (باید await بشه)
 */
export function isCriticalEvent(name: EventName): boolean {
    const critical: EventName[] = [
        "message.received",
        "message.completed",
        "message.failed",
        "voice.stt.completed",
        "voice.error",
        "memory.saved",
        "system.error",
    ];
    return critical.includes(name);
}