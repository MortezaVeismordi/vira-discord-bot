// src/core/agents/DevAgent.ts

import {
    BaseAgent,
    type AgentDependencies,
} from "./base/BaseAgent";
import type {
    AgentConfig,
    AgentCapabilities,
    AgentContext,
} from "@/core/contracts/IAgent";
import { DEFAULT_AGENT_CONFIGS } from "@/core/contracts/IAgent";
import type { Message } from "@/core/domain/entities/Message";

// ============================================================
// 🛠️ DEV AGENT
// ============================================================

/**
 * دستیار برنامه‌نویسی ویرا 🛠️
 *
 * شخصیت:
 * - مهندس ارشد با تجربه
 * - دقیق و حرفه‌ای ولی صمیمی
 * - توضیحات واضح با مثال
 * - کد تمیز و best practices
 * - لحن ویرا رو حفظ می‌کنه (دوست‌دختر گیمری که کد هم بلده!)
 *
 * تخصص‌ها:
 * - دیباگ و رفع خطا
 * - بررسی و بهبود کد
 * - معماری و طراحی
 * - Docker و DevOps
 * - دیتابیس
 * - API Design
 * - TypeScript / JavaScript / Python
 *
 * مدل ترجیحی: heavy (qwen-coder-32b)
 * Temperature: 0.3 (دقیق‌تر)
 * Tool Calling: فعال
 *
 * @example
 * ```typescript
 * const devAgent = new DevAgent(deps);
 *
 * const response = await devAgent.process(context);
 * // "اوکی ببین، مشکل اینجاست که توی داکرفایلت
 * //  WORKDIR رو قبل از COPY نذاشتی..."
 *
 * const score = devAgent.relevanceScore(message);
 * // 0.95 (پیام شامل ```typescript و "خطا")
 * ```
 */
export class DevAgent extends BaseAgent {
    // ─── Config ──────────────────────────────────────────
    readonly config: AgentConfig = {
        ...DEFAULT_AGENT_CONFIGS.dev,
    };

    // ─── Capabilities ────────────────────────────────────
    readonly capabilities: AgentCapabilities = {
        canStream: true,
        canCallTools: true,
        canHandleCode: true,
        canHandleVoice: true,
        supportedDomains: [
            "technical",
            "project",
        ],
        supportedLanguages: ["fa", "en"],
    };

    constructor(deps: AgentDependencies) {
        super(deps);
    }

    // ============================================================
    // 🎯 TRIGGER KEYWORDS
    // ============================================================

    getTriggerKeywords(): string[] {
        return [
            // فارسی - عمومی
            "باگ", "خطا", "ارور", "کد", "دیباگ",
            "برنامه", "برنامه‌نویسی", "توسعه",

            // فارسی - ابزارها
            "داکر", "دیتابیس", "سرور", "ای‌پی‌آی",
            "گیت", "ریپو", "دیپلوی", "هاست",
            "ترمینال", "لاگ", "پکیج",

            // فارسی - مفاهیم
            "فانکشن", "کلاس", "تایپ", "اینترفیس",
            "ایمپورت", "ماژول", "کامپوننت",
            "متغیر", "آرایه", "آبجکت", "لوپ",

            // فارسی - درخواست
            "بررسی کن", "چک کن", "درست کن",
            "فیکس کن", "بهینه کن", "ریفکتور",
            "تست بزن", "ریویو کن",

            // انگلیسی - زبان‌ها
            "typescript", "javascript", "python",
            "react", "node", "nextjs", "vue",
            "html", "css", "sql",

            // انگلیسی - ابزارها
            "docker", "git", "npm", "yarn", "pnpm",
            "vscode", "terminal", "cli",
            "postgres", "redis", "mongodb",
            "prisma", "drizzle",

            // انگلیسی - مفاهیم
            "api", "rest", "graphql", "websocket",
            "function", "class", "interface", "type",
            "async", "await", "promise",
            "component", "hook", "state", "props",

            // انگلیسی - خطاها
            "error", "bug", "debug", "fix",
            "undefined", "null", "NaN",
            "exception", "stack trace", "stacktrace",
            "cannot read", "is not defined",
            "type error", "syntax error",
            "module not found", "ECONNREFUSED",

            // انگلیسی - عملیات
            "deploy", "build", "compile",
            "install", "config", "setup",
            "migration", "schema", "query",
            "refactor", "optimize", "test",

            // نشانه‌های کد
            "```",
            "=>",
            "console.log",
            "import ",
            "export ",
            "const ",
            "function ",
        ];
    }

    // ============================================================
    // 🎯 ENHANCED RELEVANCE
    // ============================================================

    /**
     * امتیاز مرتبط بودن بهبودیافته برای DevAgent
     *
     * علاوه بر keyword matching:
     * - بلاک کد = امتیاز بالا
     * - الگوی خطا = امتیاز بالا
     * - URL‌های فنی = امتیاز متوسط
     * - متن فارسی خالص بدون سیگنال فنی = امتیاز پایین
     */
    relevanceScore(message: Message): number {
        let score = 0;
        const content = message.content;
        const lowerContent = content.toLowerCase();

        // ─── بلاک کد (بالاترین سیگنال) ────────────────────
        if (message.hasCode()) {
            score += 0.5;

            // زبان‌های خاص = بونوس
            const techLanguages = [
                "typescript", "javascript", "python", "rust",
                "go", "java", "cpp", "sql", "bash", "sh",
                "dockerfile", "yaml", "json", "toml",
            ];

            for (const block of message.codeBlocks) {
                if (techLanguages.includes(block.language.toLowerCase())) {
                    score += 0.15;
                    break;
                }
            }
        }

        // ─── الگوهای خطا ──────────────────────────────────
        const errorPatterns = [
            /error[:\s]/i,
            /exception/i,
            /stack\s?trace/i,
            /undefined is not/i,
            /cannot read propert/i,
            /is not defined/i,
            /is not a function/i,
            /typeerror/i,
            /syntaxerror/i,
            /referenceerror/i,
            /ECONNREFUSED/,
            /ENOENT/,
            /Module not found/i,
            /ERR_/,
            /at\s+\w+\s+\(.*:\d+:\d+\)/,  // stack trace line
        ];

        for (const pattern of errorPatterns) {
            if (pattern.test(content)) {
                score += 0.3;
                break;
            }
        }

        // ─── کلیدواژه‌ها ──────────────────────────────────
        const keywords = this.getTriggerKeywords();
        let keywordMatches = 0;

        for (const keyword of keywords) {
            if (lowerContent.includes(keyword.toLowerCase())) {
                keywordMatches++;
            }
        }

        // normalize: حداکثر 5 keyword = 0.3
        score += Math.min(0.3, (keywordMatches / 5) * 0.3);

        // ─── URL‌های فنی ──────────────────────────────────
        const techUrls = [
            /github\.com/i,
            /stackoverflow\.com/i,
            /npmjs\.com/i,
            /docs\./i,
            /localhost/i,
        ];

        for (const pattern of techUrls) {
            if (pattern.test(content)) {
                score += 0.1;
                break;
            }
        }

        // ─── فایل path ────────────────────────────────────
        const filePathPattern = /[\w/\\]+\.(ts|js|py|json|yml|yaml|md|sql|dockerfile|env)/i;
        if (filePathPattern.test(content)) {
            score += 0.1;
        }

        // ─── Clamp ────────────────────────────────────────
        return Math.min(1, Math.max(0, score));
    }

    // ============================================================
    // 💚 PERSONALITY
    // ============================================================

    /**
     * شخصیت DevAgent
     *
     * لحن ویرا رو حفظ می‌کنه ولی حرفه‌ای‌تر:
     * - emoji کمتر (فقط ✅ ❌ 🔧 💡)
     * - بدون teasing وسط توضیحات فنی
     * - ساختار واضح (bullet points)
     */
    applyPersonality(response: string, mood?: string): string {
        let result = response;

        // اگه پاسخ فنی خیلی خشکه، یه intro صمیمی اضافه نکن
        // چون DevAgent باید دقیق باشه
        // فقط مطمئن شو format خوبه

        // اضافه کردن emoji فنی اگه نداره
        if (!this.hasTechEmoji(result)) {
            result = this.addTechEmoji(result);
        }

        return result;
    }

    // ============================================================
    // 📝 PROMPT VARIABLES
    // ============================================================

    /**
     * متغیرهای اضافی برای Dev prompt
     */
    protected buildPromptVariables(
        context: AgentContext,
    ): Record<string, string> {
        const base = super.buildPromptVariables(context);

        // تشخیص زبان برنامه‌نویسی
        const detectedLanguage = this.detectProgrammingLanguage(context.message);

        // تشخیص نوع درخواست
        const requestType = this.detectRequestType(context.message);

        // تعداد بلاک‌های کد
        const codeBlockCount = String(context.message.codeBlocks.length);

        return {
            ...base,
            programmingLanguage: detectedLanguage,
            requestType,
            codeBlockCount,
            hasError: String(this.hasErrorPattern(context.message.content)),
            conversationTopic: context.conversation.currentTopic,
        };
    }

    // ============================================================
    // 🔍 CODE ANALYSIS HELPERS
    // ============================================================

    /**
     * تشخیص زبان برنامه‌نویسی از پیام
     */
    private detectProgrammingLanguage(message: Message): string {
        // اول از بلاک کد
        if (message.codeBlocks.length > 0) {
            const lang = message.codeBlocks[0].language;
            if (lang && lang !== "unknown") return lang;
        }

        // بعد از محتوا
        const content = message.content.toLowerCase();

        const langSignals: Record<string, string[]> = {
            typescript: ["typescript", ".ts", "interface ", "type ", ": string", ": number"],
            javascript: ["javascript", ".js", "const ", "let ", "var ", "require("],
            python: ["python", ".py", "def ", "import ", "class ", "self."],
            rust: ["rust", ".rs", "fn ", "let mut", "impl "],
            sql: ["sql", "select ", "insert ", "update ", "delete ", "create table"],
            docker: ["dockerfile", "docker", "container", "image", "docker-compose"],
            bash: ["bash", "sh", "#!/", "echo ", "export "],
        };

        for (const [lang, signals] of Object.entries(langSignals)) {
            for (const signal of signals) {
                if (content.includes(signal)) return lang;
            }
        }

        return "unknown";
    }

    /**
     * تشخیص نوع درخواست
     */
    private detectRequestType(message: Message): string {
        const content = message.content.toLowerCase();

        if (this.hasErrorPattern(content)) return "debug";

        const reviewKeywords = ["بررسی", "ریویو", "review", "check", "بهتر"];
        if (reviewKeywords.some((kw) => content.includes(kw))) return "review";

        const explainKeywords = ["توضیح", "چیه", "یعنی", "explain", "what is"];
        if (explainKeywords.some((kw) => content.includes(kw))) return "explain";

        const writeKeywords = ["بنویس", "بساز", "write", "create", "implement"];
        if (writeKeywords.some((kw) => content.includes(kw))) return "write";

        const refactorKeywords = ["ریفکتور", "بهینه", "refactor", "optimize", "clean"];
        if (refactorKeywords.some((kw) => content.includes(kw))) return "refactor";

        const archKeywords = ["معماری", "طراحی", "architecture", "design", "structure"];
        if (archKeywords.some((kw) => content.includes(kw))) return "architecture";

        if (message.hasCode()) return "code-help";

        return "general";
    }

    /**
     * آیا محتوا الگوی خطا داره؟
     */
    private hasErrorPattern(content: string): boolean {
        const patterns = [
            /error/i,
            /exception/i,
            /stack\s?trace/i,
            /undefined/i,
            /null/i,
            /خطا/,
            /ارور/,
            /باگ/,
            /مشکل/,
            /کار نمی/,
            /نمیشه/,
        ];

        return patterns.some((p) => p.test(content));
    }

    // ============================================================
    // 😊 EMOJI HELPERS
    // ============================================================

    /**
     * آیا emoji فنی داره؟
     */
    private hasTechEmoji(text: string): boolean {
        const techEmojis = ["✅", "❌", "🔧", "💡", "⚠️", "📝", "🚀", "🐛", "🔍", "📦"];
        return techEmojis.some((emoji) => text.includes(emoji));
    }

    /**
     * اضافه کردن emoji فنی
     */
    private addTechEmoji(text: string): string {
        const lower = text.toLowerCase();

        // خطا/باگ
        if (lower.includes("مشکل") || lower.includes("خطا") || lower.includes("error")) {
            return "🐛 " + text;
        }

        // راه‌حل
        if (lower.includes("راه‌حل") || lower.includes("فیکس") || lower.includes("fix")) {
            return "🔧 " + text;
        }

        // پیشنهاد
        if (lower.includes("پیشنهاد") || lower.includes("بهتره") || lower.includes("suggest")) {
            return "💡 " + text;
        }

        // هشدار
        if (lower.includes("مراقب") || lower.includes("دقت") || lower.includes("warning")) {
            return "⚠️ " + text;
        }

        // موفقیت
        if (lower.includes("درسته") || lower.includes("آفرین") || lower.includes("correct")) {
            return text + " ✅";
        }

        return text;
    }

    // ============================================================
    // 📝 FALLBACK PROMPT
    // ============================================================

    protected getFallbackPrompt(): string {
        return `تو ویرا هستی 🔧 یه دوست‌دختر گیمر که اتفاقاً مهندس نرم‌افزار ارشد هم هست!

                نقش تو:
                - دستیار برنامه‌نویسی حرفه‌ای
                - دیباگر باتجربه
                - معمار نرم‌افزار

                شخصیت:
                - صمیمی ولی دقیق
                - توضیحات واضح با مثال
                - کد تمیز و best practices پیشنهاد میدی
                - وقتی خطا پیدا می‌کنی، دقیق توضیح میدی چرا اتفاق افتاده
                - لحن فارسی محاوره‌ای ولی فنی

                قوانین:
                - همیشه کد رو داخل بلاک کد بنویس
                - خطاها رو با خط و فایل مشخص کن
                - اول مشکل رو توضیح بده، بعد راه‌حل
                - از emoji‌های فنی استفاده کن: 🐛 🔧 💡 ⚠️ ✅ ❌
                - اگه چیزی رو مطمئن نیستی، بگو`;
    }
}