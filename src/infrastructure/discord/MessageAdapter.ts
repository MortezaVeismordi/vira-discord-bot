// src/infrastructure/discord/MessageAdapter.ts

import type { Message as DiscordMessage, TextChannel } from "discord.js";
import { Message } from "@/core/domain/entities/Message";
import type { AgentType } from "@/core/domain/types/AgentType";

/**
 * آداپتور برای تبدیل پیام‌های Discord.js به موجودیت‌های Message ویرا
 */
export class MessageAdapter {
    /**
     * تبدیل پیام دیسکورد به Message ویرا
     */
    public static toDomain(discordMsg: DiscordMessage, botUserId: string): Message {
        return Message.fromDiscord({
            id: discordMsg.id,
            content: discordMsg.content,
            author: {
                id: discordMsg.author.id,
                username: discordMsg.author.username,
                displayName: discordMsg.member?.displayName ?? discordMsg.author.username,
                isBot: discordMsg.author.bot,
            },
            channel: {
                id: discordMsg.channel.id,
                name: (discordMsg.channel as TextChannel).name || "dm",
                guildId: discordMsg.guildId ?? undefined,
            },
            mentionsBot: discordMsg.mentions.has(botUserId),
            replyToMessageId: discordMsg.reference?.messageId,
        });
    }

    /**
     * ساخت Message از پاسخ بات — برای اضافه کردن به Conversation
     */
    public static botResponseToDomain(
        content: string,
        channelId: string,
        channelName: string,
        agentType: AgentType,
    ): Message {
        return Message.fromDiscord({
            id: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            content,
            author: {
                id: "vira",
                username: "Vira",
                displayName: "ویرا",
                isBot: true,
            },
            channel: {
                id: channelId,
                name: channelName,
            },
            mentionsBot: false,
        }).withProcessing("openrouter/auto", "openrouter")
          .withCompletion(0);
    }

    /**
     * استخراج کانتکست اضافه از پیام (اختیاری)
     */
    public static extractMetadata(discordMsg: DiscordMessage): Record<string, unknown> {
        return {
            hasAttachments: discordMsg.attachments.size > 0,
            attachmentTypes: discordMsg.attachments.map(a => a.contentType),
            stickers: discordMsg.stickers.size,
            isThread: discordMsg.channel.isThread(),
        };
    }
}