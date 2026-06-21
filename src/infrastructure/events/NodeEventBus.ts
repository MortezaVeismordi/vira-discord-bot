// src/infrastructure/events/NodeEventBus.ts

import { EventEmitter } from "events";
import type {
    IEventBus,
    EventName,
    EventPayload,
    EventHandler,
    DomainEvent,
    SubscribeOptions,
    Unsubscribe,
    EventBusStats,
} from "@/core/contracts/IEventBus";
import {
    createDomainEvent,
    isCriticalEvent,
} from "@/core/contracts/IEventBus";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * اطلاعات داخلی یک listener
 */
interface ListenerEntry {
    readonly id: string;
    readonly event: EventName;
    readonly handler: Function;
    readonly options: SubscribeOptions;
    readonly registeredAt: Date;
}

/**
 * آمار اجرای handler
 */
interface HandlerExecution {
    readonly event: EventName;
    readonly handlerName: string;
    readonly durationMs: number;
    readonly success: boolean;
    readonly error?: string;
    readonly timestamp: Date;
}

/**
 * تنظیمات EventBus
 */
export interface EventBusConfig {
    /** حداکثر listener برای هر event */
    readonly maxListeners?: number;

    /** logging فعال باشد؟ */
    readonly debug?: boolean;

    /** آیا خطای handler باید log بشود؟ */
    readonly logErrors?: boolean;

    /** حداکثر تاریخچه اجراها (برای metrics) */
    readonly maxExecutionHistory?: number;

    /** timeout برای handler (ms) */
    readonly handlerTimeout?: number;
}

// ============================================================
// 📡 NODE EVENT BUS
// ============================================================

/**
 * پیاده‌سازی IEventBus با Node.js EventEmitter
 *
 * این کلاس Event Bus اصلی سیستم ویرا است.
 * تمام ارتباطات بین بخش‌های مختلف سیستم از این Bus عبور می‌کند.
 *
 * ```
 * MessageHandler ──emit──→ "message.received"
 *                                │
 *                    ┌───────────┼───────────┐
 *                    ↓           ↓           ↓
 *              AgentRouter  ContextMgr  MetricsCollector
 * ```
 *
 * ویژگی‌ها:
 * - Type-safe events (ViraEventMap)
 * - Priority-based handler execution
 * - Error isolation (یک handler خراب بقیه رو خراب نمی‌کنه)
 * - Metrics & debugging
 * - Handler timeout protection
 * - Wildcard subscription (onAll)
 *
 * @example
 * ```typescript
 * const eventBus = new NodeEventBus({ debug: true });
 *
 * // Subscribe
 * const unsub = eventBus.on("message.received", async ({ message }) => {
 *   console.log(`New: ${message.content}`);
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
export class NodeEventBus implements IEventBus {
    private readonly emitter: EventEmitter;
    private readonly config: Required<EventBusConfig>;

    // ─── Tracking ────────────────────────────────────────
    private readonly listeners: Map<string, ListenerEntry>;
    private readonly executionHistory: HandlerExecution[];
    private readonly emitCounts: Map<EventName, number>;
    private readonly wildcardHandlers: Map<string, (event: DomainEvent) => void | Promise<void>>;

    private totalEmitted: number = 0;
    private handlerErrors: number = 0;
    private totalHandlerTime: number = 0;
    private totalHandlerCalls: number = 0;
    private listenerIdCounter: number = 0;

    constructor(config?: EventBusConfig) {
        this.config = {
            maxListeners: config?.maxListeners ?? 50,
            debug: config?.debug ?? false,
            logErrors: config?.logErrors ?? true,
            maxExecutionHistory: config?.maxExecutionHistory ?? 500,
            handlerTimeout: config?.handlerTimeout ?? 10_000,
        };

        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(this.config.maxListeners);

        this.listeners = new Map();
        this.executionHistory = [];
        this.emitCounts = new Map();
        this.wildcardHandlers = new Map();
    }

    // ============================================================
    // 📥 SUBSCRIBE
    // ============================================================

    on<E extends EventName>(
        event: E,
        handler: EventHandler<E>,
        options?: SubscribeOptions,
    ): Unsubscribe {
        const opts: SubscribeOptions = {
            once: false,
            priority: 0,
            name: "anonymous",
            ...options,
        };

        const listenerId = this.generateListenerId();

        // Wrapper با error handling و metrics
        const wrappedHandler = async (domainEvent: DomainEvent<E>) => {
            // Filter check
            if (opts.filter && !opts.filter(domainEvent.payload)) {
                return;
            }

            await this.executeHandler(
                event,
                opts.name ?? "anonymous",
                () => handler(domainEvent.payload),
            );

            // اگر once بود، بعد از اجرا حذف کن
            if (opts.once) {
                this.removeListener(listenerId, event);
            }
        };

        // ثبت listener
        this.listeners.set(listenerId, {
            id: listenerId,
            event,
            handler: wrappedHandler,
            options: opts,
            registeredAt: new Date(),
        });

        this.emitter.on(event, wrappedHandler);

        this.debugLog(`[Subscribe] ${event} ← ${opts.name} (id: ${listenerId})`);

        // Unsubscribe function
        return () => {
            this.removeListener(listenerId, event);
        };
    }

    once<E extends EventName>(
        event: E,
        handler: EventHandler<E>,
    ): Unsubscribe {
        return this.on(event, handler, { once: true, name: "once-handler" });
    }

    onMany<E extends EventName>(
        events: E[],
        handler: EventHandler<E>,
        options?: SubscribeOptions,
    ): Unsubscribe {
        const unsubscribers = events.map((event) =>
            this.on(event, handler, {
                ...options,
                name: options?.name ?? `multi:${events.join(",")}`,
            }),
        );

        return () => {
            for (const unsub of unsubscribers) {
                unsub();
            }
        };
    }

    onAll(
        handler: (event: DomainEvent) => void | Promise<void>,
    ): Unsubscribe {
        const handlerId = this.generateListenerId();

        this.wildcardHandlers.set(handlerId, handler);

        this.debugLog(`[Subscribe] * (wildcard) ← handler (id: ${handlerId})`);

        return () => {
            this.wildcardHandlers.delete(handlerId);
            this.debugLog(`[Unsubscribe] * (wildcard) (id: ${handlerId})`);
        };
    }

    // ============================================================
    // 📤 PUBLISH
    // ============================================================

    async emit<E extends EventName>(
        event: E,
        payload: EventPayload<E>,
        options?: {
            correlationId?: string;
            source?: string;
        },
    ): Promise<void> {
        const domainEvent = createDomainEvent(event, payload, options);

        this.trackEmit(event);
        this.debugLog(`[Emit] ${event}`, domainEvent.id);

        // Wildcard handlers اول
        await this.executeWildcardHandlers(domainEvent);

        // Event-specific handlers
        // جمع‌آوری و مرتب‌سازی بر اساس priority
        const handlers = this.getHandlersForEvent(event);

        for (const entry of handlers) {
            const wrappedHandler = entry.handler as (
                event: DomainEvent<E>,
            ) => Promise<void>;

            try {
                await wrappedHandler(domainEvent);
            } catch (error: any) {
                // خطای handler نباید emit رو متوقف کنه
                this.handleHandlerError(event, entry.options.name ?? "unknown", error);
            }
        }
    }

    emitAsync<E extends EventName>(
        event: E,
        payload: EventPayload<E>,
    ): void {
        // Fire-and-forget
        this.emit(event, payload).catch((error) => {
            if (this.config.logErrors) {
                console.error(`[EventBus] Async emit error for "${event}":`, error);
            }
        });
    }

    // ============================================================
    // 🗑️ MANAGEMENT
    // ============================================================

    removeAllListeners(event?: EventName): void {
        if (event) {
            // حذف listeners یک event خاص
            const toRemove: string[] = [];
            for (const [id, entry] of this.listeners) {
                if (entry.event === event) {
                    toRemove.push(id);
                }
            }

            for (const id of toRemove) {
                this.removeListener(id, event);
            }

            this.debugLog(`[RemoveAll] ${event} (${toRemove.length} removed)`);
        } else {
            // حذف همه
            this.emitter.removeAllListeners();
            this.listeners.clear();
            this.wildcardHandlers.clear();

            this.debugLog("[RemoveAll] All listeners removed");
        }
    }

    listenerCount(event: EventName): number {
        let count = 0;
        for (const entry of this.listeners.values()) {
            if (entry.event === event) count++;
        }
        return count;
    }

    activeEvents(): EventName[] {
        const events = new Set<EventName>();
        for (const entry of this.listeners.values()) {
            events.add(entry.event);
        }
        return [...events];
    }

    // ============================================================
    // 📊 STATS
    // ============================================================

    stats(): EventBusStats {
        // تعداد emit هر event
        const emittedPerEvent: Partial<Record<EventName, number>> = {};
        for (const [event, count] of this.emitCounts) {
            emittedPerEvent[event] = count;
        }

        // تعداد listener هر event
        const listenersPerEvent: Partial<Record<EventName, number>> = {};
        for (const entry of this.listeners.values()) {
            listenersPerEvent[entry.event] =
                (listenersPerEvent[entry.event] ?? 0) + 1;
        }

        return {
            totalEmitted: this.totalEmitted,
            totalListeners: this.listeners.size + this.wildcardHandlers.size,
            emittedPerEvent,
            listenersPerEvent,
            handlerErrors: this.handlerErrors,
            averageHandlerTimeMs: this.totalHandlerCalls > 0
                ? Math.round(this.totalHandlerTime / this.totalHandlerCalls)
                : 0,
        };
    }

    // ============================================================
    // 🔍 DEBUG & INTROSPECTION
    // ============================================================

    /**
     * لیست تمام listeners ثبت شده
     */
    getRegisteredListeners(): Array<{
        id: string;
        event: EventName;
        name: string;
        priority: number;
        once: boolean;
        registeredAt: Date;
    }> {
        return [...this.listeners.values()].map((entry) => ({
            id: entry.id,
            event: entry.event,
            name: entry.options.name ?? "anonymous",
            priority: entry.options.priority ?? 0,
            once: entry.options.once ?? false,
            registeredAt: entry.registeredAt,
        }));
    }

    /**
     * تاریخچه آخرین اجراها
     */
    getExecutionHistory(limit?: number): HandlerExecution[] {
        const l = limit ?? this.executionHistory.length;
        return this.executionHistory.slice(-l);
    }

    /**
     * پاکسازی تاریخچه
     */
    clearHistory(): void {
        this.executionHistory.length = 0;
    }

    /**
     * ریست کامل آمار
     */
    resetStats(): void {
        this.totalEmitted = 0;
        this.handlerErrors = 0;
        this.totalHandlerTime = 0;
        this.totalHandlerCalls = 0;
        this.emitCounts.clear();
        this.executionHistory.length = 0;
    }

    /**
     * Debug view
     */
    toDebugView(): string {
        const s = this.stats();
        const lines: string[] = [
            "┌─────────────────────────────────────────┐",
            "│         📡 EVENT BUS DEBUG               │",
            "├─────────────────────────────────────────┤",
            `│ Total Emitted:    ${String(s.totalEmitted).padEnd(20)}│`,
            `│ Total Listeners:  ${String(s.totalListeners).padEnd(20)}│`,
            `│ Handler Errors:   ${String(s.handlerErrors).padEnd(20)}│`,
            `│ Avg Handler Time: ${String(s.averageHandlerTimeMs + "ms").padEnd(20)}│`,
            `│ Wildcard Handlers:${String(this.wildcardHandlers.size).padEnd(20)}│`,
            "├─────────────────────────────────────────┤",
            "│ Active Events:                          │",
        ];

        for (const event of this.activeEvents()) {
            const count = this.listenerCount(event);
            const emitted = this.emitCounts.get(event) ?? 0;
            lines.push(
                `│   ${event.padEnd(25)} L:${String(count).padEnd(3)} E:${String(emitted).padEnd(5)}│`,
            );
        }

        lines.push("└─────────────────────────────────────────┘");

        return lines.join("\n");
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    /**
     * اجرای یک handler با error handling، timeout و metrics
     */
    private async executeHandler(
        event: EventName,
        handlerName: string,
        handler: () => void | Promise<void>,
    ): Promise<void> {
        const startTime = Date.now();

        try {
            const result = handler();

            // اگر Promise برگرداند، await با timeout
            if (result instanceof Promise) {
                await this.withTimeout(
                    result,
                    this.config.handlerTimeout,
                    `Handler "${handlerName}" for "${event}" timed out after ${this.config.handlerTimeout}ms`,
                );
            }

            this.trackHandlerExecution(event, handlerName, startTime, true);
        } catch (error: any) {
            this.trackHandlerExecution(event, handlerName, startTime, false, error.message);
            this.handleHandlerError(event, handlerName, error);
        }
    }

    /**
     * اجرای wildcard handlers
     */
    private async executeWildcardHandlers(
        domainEvent: DomainEvent,
    ): Promise<void> {
        for (const [id, handler] of this.wildcardHandlers) {
            try {
                const result = handler(domainEvent);

                if (result instanceof Promise) {
                    await this.withTimeout(
                        result,
                        this.config.handlerTimeout,
                        `Wildcard handler (${id}) timed out`,
                    );
                }
            } catch (error: any) {
                this.handleHandlerError(
                    domainEvent.name,
                    `wildcard:${id}`,
                    error,
                );
            }
        }
    }

    /**
     * دریافت handlers مرتب بر اساس priority
     */
    private getHandlersForEvent(event: EventName): ListenerEntry[] {
        const handlers: ListenerEntry[] = [];

        for (const entry of this.listeners.values()) {
            if (entry.event === event) {
                handlers.push(entry);
            }
        }

        // مرتب‌سازی: priority بالاتر = اول اجرا
        return handlers.sort(
            (a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0),
        );
    }

    /**
     * حذف یک listener
     */
    private removeListener(listenerId: string, event: EventName): void {
        const entry = this.listeners.get(listenerId);
        if (!entry) return;

        this.emitter.removeListener(event, entry.handler as (...args: any[]) => void);
        this.listeners.delete(listenerId);

        this.debugLog(`[Unsubscribe] ${event} (id: ${listenerId})`);
    }

    /**
     * مدیریت خطای handler
     *
     * خطای یک handler نباید کل سیستم رو خراب کنه
     */
    private handleHandlerError(
        event: EventName,
        handlerName: string,
        error: Error,
    ): void {
        this.handlerErrors++;

        if (this.config.logErrors) {
            console.error(
                `[EventBus] Handler error in "${handlerName}" for "${event}":`,
                error.message,
            );
        }

        // emit خود error event (بدون recursion)
        if (event !== "system.error") {
            this.emitAsync("system.error" as EventName, {
                error: `Handler "${handlerName}" failed: ${error.message}`,
                component: "EventBus",
                fatal: false,
            } as any);
        }
    }

    /**
     * Promise با timeout
     */
    private withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        message: string,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(message));
            }, timeoutMs);

            promise
                .then((result) => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    // ============================================================
    // 📊 TRACKING
    // ============================================================

    /**
     * ثبت emit
     */
    private trackEmit(event: EventName): void {
        this.totalEmitted++;
        this.emitCounts.set(
            event,
            (this.emitCounts.get(event) ?? 0) + 1,
        );
    }

    /**
     * ثبت اجرای handler
     */
    private trackHandlerExecution(
        event: EventName,
        handlerName: string,
        startTime: number,
        success: boolean,
        error?: string,
    ): void {
        const durationMs = Date.now() - startTime;

        this.totalHandlerCalls++;
        this.totalHandlerTime += durationMs;

        const execution: HandlerExecution = {
            event,
            handlerName,
            durationMs,
            success,
            error,
            timestamp: new Date(),
        };

        this.executionHistory.push(execution);

        // محدودیت تاریخچه
        if (this.executionHistory.length > this.config.maxExecutionHistory) {
            this.executionHistory.splice(
                0,
                this.executionHistory.length - this.config.maxExecutionHistory,
            );
        }
    }

    /**
     * تولید ID یکتا
     */
    private generateListenerId(): string {
        this.listenerIdCounter++;
        return `listener_${this.listenerIdCounter}_${Date.now().toString(36)}`;
    }

    /**
     * Debug log
     */
    private debugLog(message: string, ...args: any[]): void {
        if (this.config.debug) {
            console.debug(`[EventBus] ${message}`, ...args);
        }
    }
}

// ============================================================
// 🏭 FACTORY
// ============================================================

/**
 * Singleton EventBus
 *
 * @example
 * ```typescript
 * const eventBus = createEventBus({ debug: true });
 *
 * // یا singleton:
 * const bus1 = getEventBus();
 * const bus2 = getEventBus(); // همون instance
 * ```
 */
let _singletonBus: NodeEventBus | null = null;

/**
 * ساخت EventBus جدید
 */
export function createEventBus(config?: EventBusConfig): NodeEventBus {
    return new NodeEventBus(config);
}

/**
 * دریافت EventBus singleton
 */
export function getEventBus(config?: EventBusConfig): NodeEventBus {
    if (!_singletonBus) {
        _singletonBus = new NodeEventBus(config);
    }
    return _singletonBus;
}

/**
 * ریست singleton (برای تست)
 */
export function resetEventBus(): void {
    if (_singletonBus) {
        _singletonBus.removeAllListeners();
        _singletonBus = null;
    }
}

// ============================================================
// 🔌 EVENT LOGGER MIDDLEWARE
// ============================================================

/**
 * Middleware برای logging تمام eventها
 *
 * @example
 * ```typescript
 * const eventBus = createEventBus();
 * const logger = new EventLogger(eventBus);
 * logger.start();
 *
 * // حالا تمام eventها log می‌شوند:
 * // [Event] message.received { messageId: "123", ... }
 * // [Event] message.routed { agentType: "dev", confidence: 0.95 }
 * ```
 */
export class EventLogger {
    private unsubscribe: Unsubscribe | null = null;
    private readonly logFn: (message: string, data?: any) => void;

    constructor(
        private readonly eventBus: NodeEventBus,
        logFn?: (message: string, data?: any) => void,
    ) {
        this.logFn = logFn ?? ((msg, data) => {
            console.log(msg, data ? JSON.stringify(data, null, 0) : "");
        });
    }

    /**
     * شروع logging
     */
    start(options?: {
        /** فقط این eventها log بشن */
        include?: EventName[];
        /** این eventها log نشن */
        exclude?: EventName[];
        /** فقط eventهای مهم */
        criticalOnly?: boolean;
    }): void {
        this.stop();

        this.unsubscribe = this.eventBus.onAll((event) => {
            // فیلتر include
            if (options?.include && !options.include.includes(event.name)) {
                return;
            }

            // فیلتر exclude
            if (options?.exclude?.includes(event.name)) {
                return;
            }

            // فیلتر critical
            if (options?.criticalOnly && !isCriticalEvent(event.name)) {
                return;
            }

            const timestamp = event.timestamp.toISOString().split("T")[1].slice(0, 12);
            const correlationInfo = event.correlationId
                ? ` [${event.correlationId}]`
                : "";

            this.logFn(
                `[${timestamp}] 📡 ${event.name}${correlationInfo}`,
                this.summarizePayload(event.payload),
            );
        });
    }

    /**
     * متوقف کردن logging
     */
    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    /**
     * خلاصه‌سازی payload برای log
     */
    private summarizePayload(payload: any): Record<string, any> {
        if (!payload || typeof payload !== "object") return {};

        const summary: Record<string, any> = {};

        for (const [key, value] of Object.entries(payload)) {
            if (value === null || value === undefined) continue;

            if (typeof value === "string") {
                // متن‌های بلند رو کوتاه کن
                summary[key] = value.length > 80
                    ? value.slice(0, 80) + "..."
                    : value;
            } else if (typeof value === "number" || typeof value === "boolean") {
                summary[key] = value;
            } else if (value instanceof Date) {
                summary[key] = value.toISOString();
            } else if (Array.isArray(value)) {
                summary[key] = `[${value.length} items]`;
            } else if (typeof value === "object") {
                // Object‌های تو در تو → فقط کلیدها
                if ("id" in value) {
                    summary[key] = `{id: ${(value as any).id}}`;
                } else if ("content" in value) {
                    const content = (value as any).content;
                    summary[key] = `{content: "${typeof content === "string" && content.length > 40
                            ? content.slice(0, 40) + "..."
                            : content
                        }"}`;
                } else {
                    summary[key] = `{${Object.keys(value).join(", ")}}`;
                }
            }
        }

        return summary;
    }
}