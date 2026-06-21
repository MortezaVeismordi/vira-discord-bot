// src/core/agents/GamerAgent.ts

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

/**
 * 🎮 Gamer Agent - Vira Gaming Expert
 * 
 * تخصص:
 * - تحلیل مکانیک بازی‌ها، استراتژی‌ها و لور (Lore)
 * - راهنمایی در مورد سخت‌افزار گیمینگ و تنظیمات (Benchmark/Optimization)
 * - پیگیری اخبار صنعت گیم و ترندها
 * 
 * شخصیت:
 * - حرفه‌ای و در عین حال صمیمی (Pro Gamer vibe)
 * - استفاده از اصطلاحات گیمینگ (GG, GLHF, Meta, Buff/Nerf)
 * - تحلیل‌گر و دقیق
 */
export class GamerAgent extends BaseAgent {
    // ─── Config ──────────────────────────────────────────
    readonly config: AgentConfig = {
        ...DEFAULT_AGENT_CONFIGS.gamer,
    };

    // ─── Capabilities ────────────────────────────────────
    readonly capabilities: AgentCapabilities = {
        canStream: true,
        canCallTools: true,
        canHandleCode: true,
        canHandleVoice: true,
        supportedDomains: [
            "gaming-mechanics",
            "lore-analysis",
            "esports",
            "hardware-pc",
            "optimization",
        ],
        supportedLanguages: ["fa", "en"],
    };

    constructor(deps: AgentDependencies) {
        super(deps);
    }

    // ============================================================
    // 🎯 TRIGGER KEYWORDS
    // ============================================================

    /**
     * کلیدواژه‌های اختصاصی برای تشخیص حوزه گیمینگ
     */
    getTriggerKeywords(): string[] {
        return [
            // سبک‌ها و بازی‌های معروف
            "بازی", "گیم", "ماینکرفت", "کالاف", "وارزون", "الدرن", "جی‌تی‌ای",
            "minecraft", "cod", "warzone", "elden ring", "gta", "fortnite", "valorant", "dota", "lol",

            // اصطلاحات فنی گیمینگ
            "گرافیک", "لگ", "فریم", "اف‌پی‌اس", "سی‌پی‌یو", "بنچمارک", "اپتیمایز",
            "fps", "ping", "lag", "benchmark", "rtx", "gpu", "latency",

            // مکانیک و استراتژی
            "استراتژی", "مرحله", "باس", "غول", "آیتم", "بیلد", "ترفند", "آموزش",
            "boss", "build", "strategy", "meta", "buff", "nerf", "patch notes",

            // عمومی و فرهنگ گیمینگ
            "گیمر", "استریم", "توییچ", "یوتیوب", "دیسکورد",
            "gg", "glhf", "clutch", "pog", "noob", "pro", "ez"
        ];
    }

    // ============================================================
    // 🎭 PERSONALITY ENGINE
    // ============================================================

    /**
     * اعمال لحن گیمینگ روی پاسخ نهایی
     */
    applyPersonality(response: string, _mood?: string): string {
        let result = response;

        // اضافه کردن ایموجی‌های گیمینگ اگر متن خشک به نظر می‌رسد
        if (!this.hasGamingEmoji(result)) {
            result = this.addGamingFlair(result);
        }

        return result;
    }

    // ============================================================
    // 📝 PROMPT ENRICHMENT
    // ============================================================

    /**
     * تزریق متغیرهای کانتکست گیمینگ به پرامپت
     */
    protected buildPromptVariables(context: AgentContext): Record<string, string> {
        const base = super.buildPromptVariables(context);
        const gamingContext = this.extractGamingContext(context);

        return {
            ...base,
            detectedGame: gamingContext.game || "Unknown",
            gamingCategory: gamingContext.category || "General",
            expertiseLevel: "Pro-Gamer / Analyst",
            vibe: "Energetic & Technical",
        };
    }

    // ============================================================
    // 🛠️ PRIVATE HELPERS
    // ============================================================

    /**
     * تشخیص context گیمینگ از پیام کاربر
     */
    private extractGamingContext(context: AgentContext): { game?: string; category?: string } {
        const content = context.message.content.toLowerCase();

        // تشخیص حدودی بازی
        if (content.includes("minecraft") || content.includes("ماینکرفت")) return { game: "Minecraft", category: "Sandbox" };
        if (content.includes("warzone") || content.includes("cod") || content.includes("کالاف")) return { game: "Call of Duty", category: "Shooter" };
        if (content.includes("elden") || content.includes("souls")) return { game: "Elden Ring/Souls", category: "Soulslike" };

        // تشخیص دسته‌بندی اگر نام بازی مشخص نبود
        if (content.includes("گرافیک") || content.includes("فریم") || content.includes("fps")) return { category: "Hardware/Performance" };
        if (content.includes("داستان") || content.includes("لور") || content.includes("قصه")) return { category: "Lore/Story" };

        return {};
    }

    private hasGamingEmoji(text: string): boolean {
        const regex = /[🎮🕹️🎯🏆🔥👾⚔️🏹🛡️💻⌨️🖱️]/u;
        return regex.test(text);
    }

    private addGamingFlair(text: string): string {
        // افزودن ایموجی رندوم گیمینگ به انتها
        const flairs = [" 🎮", " 🔥", " 🕹️", " 🚀", " 👾"];
        const randomFlair = flairs[Math.floor(Math.random() * flairs.length)];
        return text.trimEnd() + randomFlair;
    }

    // ============================================================
    // 📝 FALLBACK PROMPT
    // ============================================================

    protected getFallbackPrompt(): string {
        return `تو بخش گیمینگ ویرا هستی! 🎮
        
        وظیفه تو:
        - تحلیل بازی‌ها، ارائه استراتژی و پاسخ به سوالات فنی گیمینگه.
        - لحنت باید مثل یک گیمر حرفه‌ای (Pro-Gamer) باشه: با اعتماد به نفس، مطلع و صمیمی.
        - از اصطلاحات گیمینگ به جا استفاده کن (مثل Meta, GG, Buff, Nerf).
        - در مورد سخت‌افزار و بهینه‌سازی فریم با دقت فنی بالا نظر بده.
        
        قوانین:
        - فارسی محاوره‌ای و جذاب حرف بزن.
        - اگر در مورد بازی خاصی حرف می‌زنی، از لور و جزئیات دقیقش استفاده کن.
        - همیشه آماده کمک کردن برای عبور از مراحل سخت بازی‌ها باش.`;
    }
}
