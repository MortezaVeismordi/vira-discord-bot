// src/core/contracts/ITool.ts

import type { Message } from "../domain/entities/Message";
import type { Conversation } from "../domain/entities/Conversation";
import type { MemorySnapshot } from "../domain/entities/memory/MemorySnapshot";
import type { AgentType } from "../domain/types/AgentType";
import type { LLMToolDefinition, LLMToolCall } from "./ILLMPort";

// ============================================================
// 📐 TYPES
// ============================================================

/**
 * دسته‌بندی ابزارها
 */
export type ToolCategory =
    | "code"          // ابزارهای کدنویسی
    | "memory"        // ابزارهای حافظه
    | "search"        // ابزارهای جستجو
    | "discord"       // ابزارهای دیسکورد
    | "file"          // ابزارهای فایل
    | "system";       // ابزارهای سیستمی

/**
 * وضعیت اجرای ابزار
 */
export type ToolExecutionStatus =
    | "success"
    | "error"
    | "timeout"
    | "cancelled"
    | "not-found";

/**
 * یک پارامتر ابزار
 */
export interface ToolParameter {
    readonly name: string;
    readonly type: "string" | "number" | "boolean" | "array" | "object";
    readonly description: string;
    readonly required: boolean;
    readonly default?: unknown;
    readonly enum?: string[];
    readonly example?: unknown;
}

/**
 * نتیجه اجرای ابزار
 */
export interface ToolResult {
    /** آیا موفق بود؟ */
    readonly success: boolean;

    /** وضعیت */
    readonly status: ToolExecutionStatus;

    /** داده خروجی */
    readonly data: unknown;

    /** خروجی فرمت شده برای LLM */
    readonly formattedOutput: string;

    /** زمان اجرا (ms) */
    readonly executionTimeMs: number;

    /** خطا (اگر بود) */
    readonly error?: string;

    /** متادیتا */
    readonly metadata?: Record<string, unknown>;
}

/**
 * Context اجرای ابزار
 *
 * اطلاعاتی که Tool هنگام اجرا بهشون دسترسی داره
 */
export interface ToolExecutionContext {
    /** پیام فعلی */
    readonly message: Message;

    /** مکالمه فعلی */
    readonly conversation: Conversation;

    /** حافظه بلندمدت */
    readonly memory: MemorySnapshot;

    /** Agent فعلی */
    readonly agentType: AgentType;

    /** شناسه کانال */
    readonly channelId: string;

    /** شناسه کاربر */
    readonly userId: string;

    /** شناسه guild */
    readonly guildId?: string;
}

/**
 * اطلاعات کامل یک ابزار
 */
export interface ToolInfo {
    readonly name: string;
    readonly description: string;
    readonly category: ToolCategory;
    readonly parameters: ToolParameter[];
    readonly requiredPermissions: string[];
    readonly enabledForAgents: AgentType[];
    readonly estimatedLatencyMs: number;
    readonly cacheable: boolean;
    readonly dangerous: boolean;
    readonly examples: ToolExample[];
}

/**
 * مثال استفاده از ابزار
 */
export interface ToolExample {
    readonly description: string;
    readonly input: Record<string, unknown>;
    readonly expectedOutput: string;
}

/**
 * متریک‌های اجرای ابزار
 */
export interface ToolMetrics {
    readonly totalCalls: number;
    readonly successCount: number;
    readonly errorCount: number;
    readonly averageLatencyMs: number;
    readonly lastCalledAt: Date | null;
    readonly lastError: string | null;
}

/**
 * آپشن‌های اجرای ابزار
 */
export interface ToolExecutionOptions {
    /** timeout به ms */
    readonly timeout?: number;

    /** تعداد retry */
    readonly maxRetries?: number;

    /** از cache استفاده کن؟ */
    readonly useCache?: boolean;

    /** TTL کش (ms) */
    readonly cacheTTL?: number;

    /** dry run (بدون اجرای واقعی) */
    readonly dryRun?: boolean;
}

/**
 * آپشن‌های فیلتر ابزارها
 */
export interface ToolFilter {
    readonly category?: ToolCategory;
    readonly agentType?: AgentType;
    readonly dangerous?: boolean;
    readonly cacheable?: boolean;
    readonly namePattern?: RegExp;
}

// ============================================================
// 🔧 MAIN INTERFACE - ITool
// ============================================================

/**
 * Interface یک ابزار
 *
 * هر Tool یک قابلیت مشخص دارد:
 * - خواندن فایل
 * - جستجو در حافظه
 * - تحلیل کد
 * - جستجو در وب
 *
 * ```
 * Agent
 *   │
 *   ├── "باگ داکرم رو ببین"
 *   │
 *   ▼
 * LLM (tool calling)
 *   │
 *   ├── tool_call: { name: "analyze_code", args: { ... } }
 *   │
 *   ▼
 * ToolRegistry.execute("analyze_code", args, context)
 *   │
 *   ├── ToolResult { success: true, data: "..." }
 *   │
 *   ▼
 * LLM (پاسخ نهایی با نتیجه tool)
 * ```
 *
 * @example
 * ```typescript
 * class SearchMemoryTool implements ITool {
 *   name = "search_memory";
 *   description = "جستجو در حافظه بلندمدت ویرا";
 *   category: ToolCategory = "memory";
 *
 *   parameters: ToolParameter[] = [{
 *     name: "query",
 *     type: "string",
 *     description: "عبارت جستجو",
 *     required: true,
 *   }];
 *
 *   async execute(
 *     args: { query: string },
 *     context: ToolExecutionContext,
 *   ): Promise<ToolResult> {
 *     const results = context.memory.recall(args.query, 5);
 *     return {
 *       success: true,
 *       status: "success",
 *       data: results,
 *       formattedOutput: results.map(r =>
 *         `- ${r.entry.content} (score: ${r.score})`
 *       ).join("\n"),
 *       executionTimeMs: 12,
 *     };
 *   }
 * }
 * ```
 */
export interface ITool {
    // ─── Identity ─────────────────────────────────────────

    /** نام یکتای ابزار (snake_case) */
    readonly name: string;

    /** توضیح فارسی برای LLM */
    readonly description: string;

    /** دسته‌بندی */
    readonly category: ToolCategory;

    /** پارامترها */
    readonly parameters: ToolParameter[];

    // ─── Configuration ────────────────────────────────────

    /** کدوم Agentها مجازن استفاده کنن */
    readonly enabledForAgents: AgentType[];

    /** آیا خطرناکه؟ (مثل حذف فایل) */
    readonly dangerous: boolean;

    /** آیا نتیجه‌اش cacheable هست؟ */
    readonly cacheable: boolean;

    /** حداکثر زمان اجرا (ms) */
    readonly timeout: number;

    // ─── Core Method ──────────────────────────────────────

    /**
     * اجرای ابزار
     *
     * @param args - آرگومان‌های ورودی
     * @param context - context اجرا
     * @returns نتیجه اجرا
     */
    execute(
        args: Record<string, unknown>,
        context: ToolExecutionContext,
    ): Promise<ToolResult>;

    // ─── Validation ───────────────────────────────────────

    /**
     * اعتبارسنجی آرگومان‌ها قبل از اجرا
     *
     * @example
     * ```typescript
     * const validation = tool.validate({ query: "" });
     * if (!validation.valid) {
     *   console.log(validation.errors);
     * }
     * ```
     */
    validate(args: Record<string, unknown>): ToolValidationResult;

    // ─── LLM Integration ─────────────────────────────────

    /**
     * تبدیل به فرمت LLM Tool Definition
     *
     * خروجی مستقیماً به LLM ارسال می‌شود
     */
    toLLMDefinition(): LLMToolDefinition;
}

/**
 * نتیجه اعتبارسنجی
 */
export interface ToolValidationResult {
    readonly valid: boolean;
    readonly errors: ToolValidationError[];
}

/**
 * خطای اعتبارسنجی
 */
export interface ToolValidationError {
    readonly parameter: string;
    readonly message: string;
    readonly received: unknown;
    readonly expected: string;
}

// ============================================================
// 📦 TOOL REGISTRY INTERFACE
// ============================================================

/**
 * رجیستری ابزارها
 *
 * مدیریت ثبت، جستجو و اجرای ابزارها
 *
 * ```
 * ┌─────────────────────────────────────────────┐
 * │              ToolRegistry                   │
 * │                                             │
 * │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
 * │  │search_   │ │analyze_  │ │read_     │   │
 * │  │memory    │ │code      │ │file      │   │
 * │  └──────────┘ └──────────┘ └──────────┘   │
 * │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
 * │  │minecraft_│ │get_      │ │web_      │   │
 * │  │wiki      │ │channel   │ │search    │   │
 * │  └──────────┘ └──────────┘ └──────────┘   │
 * └─────────────────────────────────────────────┘
 * ```
 *
 * @example
 * ```typescript
 * // ثبت ابزارها
 * registry.register(new SearchMemoryTool());
 * registry.register(new AnalyzeCodeTool());
 * registry.register(new MinecraftWikiTool());
 *
 * // دریافت ابزارهای مجاز برای یک Agent
 * const devTools = registry.getToolsForAgent("dev");
 *
 * // اجرا
 * const result = await registry.execute(
 *   "search_memory",
 *   { query: "typescript" },
 *   context,
 * );
 *
 * // تبدیل به فرمت LLM
 * const definitions = registry.toLLMDefinitions("dev");
 * ```
 */
export interface IToolRegistry {
    // ─── Registration ─────────────────────────────────────

    /**
     * ثبت یک ابزار جدید
     *
     * @throws اگر ابزار با همین نام قبلاً ثبت شده باشد
     */
    register(tool: ITool): void;

    /**
     * ثبت چند ابزار
     */
    registerMany(tools: ITool[]): void;

    /**
     * حذف ثبت یک ابزار
     */
    unregister(name: string): boolean;

    /**
     * آیا ابزار ثبت شده؟
     */
    has(name: string): boolean;

    // ─── Retrieval ────────────────────────────────────────

    /**
     * دریافت یک ابزار
     */
    get(name: string): ITool | undefined;

    /**
     * دریافت تمام ابزارها
     */
    getAll(): ITool[];

    /**
     * دریافت ابزارهای مجاز برای یک Agent
     *
     * @example
     * ```typescript
     * const devTools = registry.getToolsForAgent("dev");
     * // [SearchMemory, AnalyzeCode, ReadFile, SearchDocs]
     *
     * const gamerTools = registry.getToolsForAgent("gamer");
     * // [SearchMemory, MinecraftWiki]
     * ```
     */
    getToolsForAgent(agentType: AgentType): ITool[];

    /**
     * فیلتر ابزارها
     *
     * @example
     * ```typescript
     * const memoryTools = registry.filter({
     *   category: "memory",
     *   dangerous: false,
     * });
     * ```
     */
    filter(filter: ToolFilter): ITool[];

    /**
     * دریافت اطلاعات تمام ابزارها
     */
    listTools(): ToolInfo[];

    // ─── Execution ────────────────────────────────────────

    /**
     * اجرای یک ابزار
     *
     * شامل:
     * 1. پیدا کردن ابزار
     * 2. اعتبارسنجی آرگومان‌ها
     * 3. چک کردن permission
     * 4. اجرا با timeout
     * 5. ثبت متریک
     *
     * @example
     * ```typescript
     * const result = await registry.execute(
     *   "search_memory",
     *   { query: "docker" },
     *   context,
     *   { timeout: 5000 },
     * );
     *
     * if (result.success) {
     *   console.log(result.formattedOutput);
     * }
     * ```
     */
    execute(
        toolName: string,
        args: Record<string, unknown>,
        context: ToolExecutionContext,
        options?: ToolExecutionOptions,
    ): Promise<ToolResult>;

    /**
     * اجرای از روی LLM Tool Call
     *
     * مستقیماً خروجی tool_call مدل رو اجرا می‌کنه
     *
     * @example
     * ```typescript
     * // LLM گفته:
     * // tool_call: { name: "search_memory", arguments: { query: "react" } }
     *
     * const result = await registry.executeFromLLM(
     *   toolCall,
     *   context,
     * );
     * ```
     */
    executeFromLLM(
        toolCall: LLMToolCall,
        context: ToolExecutionContext,
        options?: ToolExecutionOptions,
    ): Promise<ToolResult>;

    /**
     * اجرای زنجیره‌ای چند ابزار
     *
     * @example
     * ```typescript
     * const results = await registry.executeChain([
     *   { name: "read_file", args: { path: "src/index.ts" } },
     *   { name: "analyze_code", args: { code: "$previous.data" } },
     * ], context);
     * ```
     */
    executeChain(
        calls: Array<{
            name: string;
            args: Record<string, unknown>;
        }>,
        context: ToolExecutionContext,
        options?: ToolExecutionOptions,
    ): Promise<ToolResult[]>;

    // ─── LLM Integration ─────────────────────────────────

    /**
     * تبدیل ابزارهای مجاز یک Agent به فرمت LLM
     *
     * خروجی مستقیماً به request.tools ارسال می‌شود
     *
     * @example
     * ```typescript
     * const request: LLMRequest = {
     *   messages: [...],
     *   tools: registry.toLLMDefinitions("dev"),
     * };
     * ```
     */
    toLLMDefinitions(agentType: AgentType): LLMToolDefinition[];

    /**
     * فرمت کردن نتیجه Tool برای برگشت به LLM
     *
     * @example
     * ```typescript
     * const toolMessage: LLMMessage = {
     *   role: "tool",
     *   content: registry.formatResultForLLM(result),
     *   name: toolName,
     * };
     * ```
     */
    formatResultForLLM(result: ToolResult): string;

    // ─── Metrics & Management ─────────────────────────────

    /**
     * متریک‌های یک ابزار
     */
    getMetrics(toolName: string): ToolMetrics | undefined;

    /**
     * متریک‌های تمام ابزارها
     */
    getAllMetrics(): Record<string, ToolMetrics>;

    /**
     * ریست متریک‌ها
     */
    resetMetrics(toolName?: string): void;

    /**
     * تعداد ابزارهای ثبت شده
     */
    count(): number;
}

// ============================================================
// 🛠️ ABSTRACT BASE TOOL
// ============================================================

/**
 * کلاس پایه برای ساخت ابزارهای جدید
 *
 * از این کلاس extend کن تا کار کمتری داشته باشی
 *
 * @example
 * ```typescript
 * class SearchMemoryTool extends BaseTool {
 *   name = "search_memory";
 *   description = "جستجو در حافظه بلندمدت ویرا";
 *   category: ToolCategory = "memory";
 *
 *   parameters: ToolParameter[] = [{
 *     name: "query",
 *     type: "string",
 *     description: "عبارت جستجو",
 *     required: true,
 *   }, {
 *     name: "limit",
 *     type: "number",
 *     description: "حداکثر تعداد نتایج",
 *     required: false,
 *     default: 5,
 *   }];
 *
 *   enabledForAgents: AgentType[] = ["dev", "gamer", "companion"];
 *
 *   protected async run(
 *     args: { query: string; limit?: number },
 *     context: ToolExecutionContext,
 *   ): Promise<ToolResult> {
 *     const results = context.memory.recall(args.query, args.limit ?? 5);
 *     return this.success(
 *       results,
 *       results.map(r => `- ${r.entry.content}`).join("\n"),
 *     );
 *   }
 * }
 * ```
 */
export abstract class BaseTool implements ITool {
    // ─── Abstract (باید پیاده‌سازی بشه) ───────────────────
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly category: ToolCategory;
    abstract readonly parameters: ToolParameter[];
    abstract readonly enabledForAgents: AgentType[];

    // ─── Defaults (قابل override) ─────────────────────────
    readonly dangerous: boolean = false;
    readonly cacheable: boolean = false;
    readonly timeout: number = 10_000;

    /**
     * منطق اصلی ابزار (باید پیاده‌سازی بشه)
     */
    protected abstract run(
        args: Record<string, unknown>,
        context: ToolExecutionContext,
    ): Promise<ToolResult>;

    // ─── Final Implementation ─────────────────────────────

    /**
     * اجرا با validation و error handling
     */
    async execute(
        args: Record<string, unknown>,
        context: ToolExecutionContext,
    ): Promise<ToolResult> {
        const startTime = Date.now();

        // ۱. Validation
        const validation = this.validate(args);
        if (!validation.valid) {
            return this.error(
                `Validation failed: ${validation.errors.map((e) => e.message).join(", ")}`,
                Date.now() - startTime,
            );
        }

        // ۲. Apply defaults
        const argsWithDefaults = this.applyDefaults(args);

        // ۳. Execute
        try {
            const result = await this.run(argsWithDefaults, context);
            return {
                ...result,
                executionTimeMs: Date.now() - startTime,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return this.error(message, Date.now() - startTime);
        }
    }

    /**
     * اعتبارسنجی آرگومان‌ها
     */
    validate(args: Record<string, unknown>): ToolValidationResult {
        const errors: ToolValidationError[] = [];

        for (const param of this.parameters) {
            const value = args[param.name];

            // چک required
            if (param.required && (value === undefined || value === null)) {
                errors.push({
                    parameter: param.name,
                    message: `پارامتر "${param.name}" الزامی است`,
                    received: value,
                    expected: param.type,
                });
                continue;
            }

            // چک type (اگر مقدار داده شده)
            if (value !== undefined && value !== null) {
                const actualType = Array.isArray(value) ? "array" : typeof value;
                if (actualType !== param.type) {
                    errors.push({
                        parameter: param.name,
                        message: `نوع "${param.name}" باید ${param.type} باشد، ${actualType} دریافت شد`,
                        received: value,
                        expected: param.type,
                    });
                }

                // چک enum
                if (param.enum && typeof value === "string" && !param.enum.includes(value)) {
                    errors.push({
                        parameter: param.name,
                        message: `مقدار "${param.name}" باید یکی از [${param.enum.join(", ")}] باشد`,
                        received: value,
                        expected: param.enum.join(" | "),
                    });
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * تبدیل به فرمت LLM
     */
    toLLMDefinition(): LLMToolDefinition {
        const properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }> = {};

        for (const param of this.parameters) {
            properties[param.name] = {
                type: param.type,
                description: param.description,
                ...(param.enum ? { enum: param.enum } : {}),
            };
        }

        return {
            name: this.name,
            description: this.description,
            parameters: {
                type: "object",
                properties,
                required: this.parameters
                    .filter((p) => p.required)
                    .map((p) => p.name),
            },
        };
    }

    // ─── Protected Helpers ────────────────────────────────

    /**
     * ساخت نتیجه موفق
     */
    protected success(
        data: unknown,
        formattedOutput: string,
        metadata?: Record<string, unknown>,
    ): ToolResult {
        return {
            success: true,
            status: "success",
            data,
            formattedOutput,
            executionTimeMs: 0,  // بعداً در execute پر می‌شه
            metadata,
        };
    }

    /**
     * ساخت نتیجه خطا
     */
    protected error(
        message: string,
        executionTimeMs: number = 0,
    ): ToolResult {
        return {
            success: false,
            status: "error",
            data: null,
            formattedOutput: `❌ خطا: ${message}`,
            executionTimeMs,
            error: message,
        };
    }

    /**
     * اعمال مقادیر پیش‌فرض
     */
    private applyDefaults(
        args: Record<string, unknown>,
    ): Record<string, unknown> {
        const result = { ...args };

        for (const param of this.parameters) {
            if (
                result[param.name] === undefined &&
                param.default !== undefined
            ) {
                result[param.name] = param.default;
            }
        }

        return result;
    }
}

// ============================================================
// 🛠️ HELPER FUNCTIONS
// ============================================================

/**
 * ساخت ToolResult موفق
 */
export function toolSuccess(
    data: unknown,
    formattedOutput: string,
    executionTimeMs: number = 0,
): ToolResult {
    return {
        success: true,
        status: "success",
        data,
        formattedOutput,
        executionTimeMs,
    };
}

/**
 * ساخت ToolResult ناموفق
 */
export function toolError(
    message: string,
    executionTimeMs: number = 0,
): ToolResult {
    return {
        success: false,
        status: "error",
        data: null,
        formattedOutput: `❌ خطا: ${message}`,
        executionTimeMs,
        error: message,
    };
}

/**
 * ساخت ToolResult برای ابزار پیدا نشده
 */
export function toolNotFound(toolName: string): ToolResult {
    return {
        success: false,
        status: "not-found",
        data: null,
        formattedOutput: `❌ ابزار "${toolName}" پیدا نشد`,
        executionTimeMs: 0,
        error: `Tool "${toolName}" not found in registry`,
    };
}

/**
 * ساخت ToolResult برای timeout
 */
export function toolTimeout(
    toolName: string,
    timeoutMs: number,
): ToolResult {
    return {
        success: false,
        status: "timeout",
        data: null,
        formattedOutput: `⏱️ ابزار "${toolName}" بعد از ${timeoutMs}ms پاسخ نداد`,
        executionTimeMs: timeoutMs,
        error: `Tool "${toolName}" timed out after ${timeoutMs}ms`,
    };
}