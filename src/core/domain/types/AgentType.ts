// src/core/domain/types/AgentType.ts

/**
 * نوع Agent در سیستم ویرا
 *
 * - "dev"       → دستیار برنامه‌نویسی
 * - "gamer"     → همراه گیمینگ
 * - "companion" → دوست و همدم (پیش‌فرض)
 */
export type AgentType = "dev" | "gamer" | "companion";

/**
 * لیست تمام AgentTypeها — برای iteration
 */
export const ALL_AGENT_TYPES: AgentType[] = ["dev", "gamer", "companion"];

/**
 * Agent پیش‌فرض سیستم
 */
export const DEFAULT_AGENT_TYPE: AgentType = "companion";