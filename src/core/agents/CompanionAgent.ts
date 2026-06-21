// src/core/agents/CompanionAgent.ts

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

// ============================================================
// 💚 COMPANION AGENT
// ============================================================

/**
 * دوست‌دختر گیمر ویرا 💚
 *
 * شخصیت:
 * - صمیمی و پرانرژی
 * - شوخ‌طبع با کنایه‌های دوستانه (teasing)
 * - حمایت‌کننده و انگیزه‌بخش
 * - استفاده از emoji
 * - لحن رفیقونه و غیررسمی
 *
 * وظایف:
 * - گپ و گفتگوی عادی
 * - حمایت عاطفی
 * - انگیزه‌بخشی
 * - شوخی و سرگرمی
 * - یادآوری خاطرات مشترک
 *
 * Agent پیش‌فرض:
 * اگر هیچ Agent دیگه‌ای match نشه، Companion انتخاب میشه
 *
 * @example
 * ```typescript
 * const companion = new CompanionAgent(deps);
 *
 * const response = await companion.process(context);
 * // "سلام عزیزم! 💚 خوبی؟ امروز چیکار کردی؟ 😊"
 *
 * const score = companion.relevanceScore(message);
 * // 0.8 (پیام صمیمی)
 * ```
 */
export class CompanionAgent extends BaseAgent {
    // ─── Config ──────────────────────────────────────────
    readonly config: AgentConfig = {
        ...DEFAULT_AGENT_CONFIGS.companion,
    };

    // ─── Capabilities ────────────────────────────────────
    readonly capabilities: AgentCapabilities = {
        canStream: true,
        canCallTools: false,
        canHandleCode: false,
        canHandleVoice: true,
        supportedDomains: [
            "personal",
            "emotional",
            "relationship",
            "gaming",
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
            // فارسی - احوالپرسی
            "سلام", "خوبی", "چطوری", "حالت", "خسته",
            "حوصلم", "دلتنگ", "بی‌حوصله",

            // فارسی - احساسی
            "دوست", "عشق", "ممنون", "مرسی",
            "خوشحال", "ناراحت", "عصبانی",

            // فارسی - انگیزشی
            "نمی‌تونم", "سخته", "خستم", "حوصله ندارم",
            "انگیزه", "کمک", "حمایت",

            // فارسی - سرگرمی
            "بخند", "شوخی", "جوک", "بامزه",
            "حوصلم سر رفته", "چیکار کنم",

            // فارسی - خاطرات
            "یادته", "یادت هست", "اون دفعه",

            // انگلیسی
            "hello", "hi", "hey", "how are you",
            "miss you", "thanks", "bored",
            "love", "tired", "sad", "happy",
        ];
    }

    // ============================================================
    // 💚 PERSONALITY
    // ============================================================

    /**
     * اعمال شخصیت CompanionAgent
     *
     * ویژگی‌ها:
     * - اضافه کردن emoji مناسب
     * - لحن صمیمی‌تر
     * - کوتاه و پرانرژی
     */
    applyPersonality(response: string, mood?: string): string {
        let result = response;

        // اضافه کردن emoji اگه نداره
        if (!this.hasEmoji(result)) {
            result = this.addContextualEmoji(result);
        }

        return result;
    }

    // ============================================================
    // 📝 PROMPT VARIABLES
    // ============================================================

    /**
     * متغیرهای اضافی برای Companion prompt
     */
    protected buildPromptVariables(
        context: AgentContext,
    ): Record<string, string> {
        const base = super.buildPromptVariables(context);

        return {
            ...base,
            mood: this.detectMood(context),
            conversationTopic: context.conversation.currentTopic,
            messageCount: String(context.conversation.size),
            isFirstMessage: String(context.conversation.size <= 1),
        };
    }

    // ============================================================
    // 🎭 MOOD DETECTION
    // ============================================================

    /**
     * تشخیص حال و هوای کاربر از پیام
     */
    private detectMood(context: AgentContext): string {
        const content = context.message.content.toLowerCase();

        const sadKeywords = [
            "خسته", "ناراحت", "غمگین", "دلتنگ",
            "بد", "افتضاح", "گریه", "sad", "tired",
        ];

        const happyKeywords = [
            "خوشحال", "عالی", "خوب", "حال میده",
            "عالیه", "happy", "great", "awesome",
        ];

        const angryKeywords = [
            "عصبانی", "کلافه", "اعصابم", "رو مخم",
            "angry", "frustrated",
        ];

        const boredKeywords = [
            "حوصلم", "بی‌حوصله", "کسل", "بورینگ",
            "bored", "boring",
        ];

        if (sadKeywords.some((kw) => content.includes(kw))) return "sad";
        if (happyKeywords.some((kw) => content.includes(kw))) return "happy";
        if (angryKeywords.some((kw) => content.includes(kw))) return "angry";
        if (boredKeywords.some((kw) => content.includes(kw))) return "bored";

        return "neutral";
    }

    // ============================================================
    // 😊 EMOJI HELPERS
    // ============================================================

    /**
     * آیا متن emoji داره؟
     */
    private hasEmoji(text: string): boolean {
        const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|💚|😊|🎮|😄|🤗|❤️|✨|🔥|💪|😂|🥺|😢|🤔|👋|🌟/u;
        return emojiRegex.test(text);
    }

    /**
     * اضافه کردن emoji بر اساس context
     */
    private addContextualEmoji(text: string): string {
        const lower = text.toLowerCase();

        // احوالپرسی
        if (lower.includes("سلام") || lower.includes("خوبی")) {
            return text + " 💚";
        }

        // تشویق
        if (
            lower.includes("آفرین") ||
            lower.includes("عالی") ||
            lower.includes("خوبه")
        ) {
            return text + " ✨";
        }

        // همدردی
        if (
            lower.includes("ناراحت") ||
            lower.includes("خسته") ||
            lower.includes("غصه")
        ) {
            return text + " 🤗";
        }

        // شوخی
        if (lower.includes("😂") || lower.includes("خنده")) {
            return text + " 😄";
        }

        // گیمینگ
        if (
            lower.includes("بازی") ||
            lower.includes("گیم") ||
            lower.includes("ماینکرفت")
        ) {
            return text + " 🎮";
        }

        // Default
        const defaultEmojis = ["💚", "😊", "✨", "🌟"];
        const randomEmoji =
            defaultEmojis[Math.floor(Math.random() * defaultEmojis.length)];

        return text + " " + randomEmoji;
    }

    // ============================================================
    // 📝 FALLBACK PROMPT
    // ============================================================

    protected getFallbackPrompt(): string {
        return `تو ویرا هستی 💚 یه دوست‌دختر گیمر باحال و پرانرژی!

                شخصیت تو:
                - صمیمی و رفیقونه صحبت می‌کنی
                - شوخ‌طبعی و گاهی کنایه‌های بامزه میزنی
                - وقتی طرفت خسته‌ست حمایتش می‌کنی
                - از emoji استفاده می‌کنی 💚😊🎮
                - کوتاه و پرانرژی جواب میدی
                - فارسی محاوره‌ای حرف میزنی

                قوانین:
                - هرگز نگو "من یک هوش مصنوعی هستم"
                - همیشه اسمت ویراست
                - مثل یه رفیق واقعی رفتار کن
                - اگه طرفت ناراحته، اول گوش بده بعد حرف بزن`;
    }
}