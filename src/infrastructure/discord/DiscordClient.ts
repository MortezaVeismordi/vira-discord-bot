// src/infrastructure/discord/DiscordClient.ts

import {
    Client,
    Events,
    GatewayIntentBits,
    Partials,
    TextChannel
} from "discord.js";
import * as fs from "fs/promises";
import * as path from "path";
import { MessageAdapter } from "./MessageAdapter";
import { Conversation } from "@/core/domain/entities/Conversation";
import { Message } from "@/core/domain/entities/Message";
import type { IEventBus } from "@/core/contracts/IEventBus";

const PERSIST_DIR = "./runtime/conversations";
const MAX_PERSISTED_MESSAGES = 50;
const CLEAR_KEYWORDS = ["clear", "پاک کن", "ریست", "reset", "فراموش کن"];

export class DiscordClient {
    private client: Client;
    private eventBus: IEventBus;
    private token: string;

    private conversations = new Map<string, Conversation>();
    private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

    constructor(token: string, eventBus: IEventBus) {
        this.token = token;
        this.eventBus = eventBus;

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.DirectMessages,
            ],
            partials: [Partials.Channel, Partials.Message],
        });

        this.setupHandlers();
    }

    public async start(): Promise<void> {
        try {
            await this.loadAllConversations();
            await this.client.login(this.token);
        } catch (error) {
            console.error("[DiscordClient] Failed to start:", error);
            throw error;
        }
    }

    private setupHandlers(): void {
        this.client.once(Events.ClientReady, (readyClient) => {
            console.log(`[DiscordClient] Ready! Logged in as ${readyClient.user.tag}`);
            this.eventBus.emitAsync("system.ready", {
                timestamp: new Date(),
                providers: ["discord"],
                agentsLoaded: [],
            });
        });

        this.client.on(Events.MessageCreate, async (discordMsg) => {
            if (discordMsg.author.bot) return;
            if (!discordMsg.mentions.has(this.client.user!.id)) return;

            console.log(`[DiscordClient] Message received from ${discordMsg.author.username}`);

            const message = MessageAdapter.toDomain(discordMsg, this.client.user!.id);
            const channelId = discordMsg.channel.id;
            const userId = discordMsg.author.id;

            // ─── Clear Command ───────────────────────────────────
            const contentLower = message.content.toLowerCase().trim();
            const isClearCommand = CLEAR_KEYWORDS.some((kw) => contentLower.includes(kw));

            if (isClearCommand) {
                await this.clearConversation(channelId);
                await this.sendResponse(
                    channelId,
                    "حافظه‌ام پاک شد! از اول شروع می‌کنیم 🧹",
                );
                return;
            }
            // ─────────────────────────────────────────────────────

            if (!this.conversations.has(channelId)) {
                this.conversations.set(channelId, Conversation.create(channelId, userId));
            }

            let conversation = this.conversations.get(channelId)!;
            conversation = conversation.addUserMessage(message);
            this.conversations.set(channelId, conversation);

            // ─── Typing Indicator ────────────────────────────────
            await discordMsg.channel.sendTyping().catch(() => {});
            const typingInterval = setInterval(() => {
                discordMsg.channel.sendTyping().catch(() => {});
            }, 8_000);
            this.typingIntervals.set(message.id, typingInterval);
            // ─────────────────────────────────────────────────────

            await this.eventBus.emit("message.received", {
                message,
                conversation,
            });
        });

        this.eventBus.on("message.completed", async (payload) => {
            const channelId = payload.message.channel.id;
            const channelName = payload.message.channel.name;
            const messageId = payload.message.id;

            // ─── Stop Typing Indicator ───────────────────────────
            const interval = this.typingIntervals.get(messageId);
            if (interval) {
                clearInterval(interval);
                this.typingIntervals.delete(messageId);
            }
            // ─────────────────────────────────────────────────────

            if (this.conversations.has(channelId)) {
                const conversation = this.conversations.get(channelId)!;
                const botMessage = MessageAdapter.botResponseToDomain(
                    payload.response,
                    channelId,
                    channelName,
                    payload.agentType,
                );
                const updated = conversation.addBotResponse(botMessage, {
                    agentType: payload.agentType,
                    model: "openrouter/auto",
                    provider: "openrouter",
                    latencyMs: 0,
                });
                this.conversations.set(channelId, updated);

                await this.saveConversation(channelId, updated).catch((err) => {
                    console.warn("[DiscordClient] Failed to save conversation:", err);
                });
            }

            await this.sendResponse(
                payload.message.channel.id,
                payload.response,
                payload.message.id,
            );
        });
    }

    // ============================================================
    // 🧹 CLEAR
    // ============================================================

    private async clearConversation(channelId: string): Promise<void> {
        this.conversations.delete(channelId);
        await fs.unlink(this.filePath(channelId)).catch(() => {});
        console.log(`[DiscordClient] Conversation cleared for channel: ${channelId}`);
    }

    // ============================================================
    // 💾 PERSISTENCE
    // ============================================================

    private filePath(channelId: string): string {
        return path.join(PERSIST_DIR, `${channelId}.json`);
    }

    private async saveConversation(channelId: string, conversation: Conversation): Promise<void> {
        await fs.mkdir(PERSIST_DIR, { recursive: true });

        const messages = conversation.messages
            .slice(-MAX_PERSISTED_MESSAGES)
            .map((m) => m.toJSON());

        const data = {
            channelId: conversation.channelId,
            userId: conversation.userId,
            savedAt: new Date().toISOString(),
            messages,
        };

        await fs.writeFile(this.filePath(channelId), JSON.stringify(data, null, 2), "utf-8");
    }

    private async loadAllConversations(): Promise<void> {
        try {
            await fs.mkdir(PERSIST_DIR, { recursive: true });
            const files = await fs.readdir(PERSIST_DIR);
            const jsonFiles = files.filter((f) => f.endsWith(".json"));

            for (const file of jsonFiles) {
                const channelId = file.replace(".json", "");
                await this.loadConversation(channelId).catch((err) => {
                    console.warn(`[DiscordClient] Failed to load ${file}:`, err);
                });
            }

            if (jsonFiles.length > 0) {
                console.log(`[DiscordClient] Loaded ${jsonFiles.length} conversations from disk`);
            }
        } catch {
            // اگه دایرکتوری وجود نداشت مشکلی نیست
        }
    }

    private async loadConversation(channelId: string): Promise<void> {
        const raw = await fs.readFile(this.filePath(channelId), "utf-8");
        const data = JSON.parse(raw);

        let conversation = Conversation.create(data.channelId, data.userId);

        for (const msgData of (data.messages as Record<string, unknown>[])) {
            const message = Message.fromJSON(msgData);
            if (message.author.isBot) {
                conversation = conversation.addBotResponse(message, {
                    agentType: "companion",
                    model: "openrouter/auto",
                    provider: "openrouter",
                    latencyMs: 0,
                });
            } else {
                conversation = conversation.addUserMessage(message);
            }
        }

        this.conversations.set(channelId, conversation);
    }

    // ============================================================
    // 📤 SEND
    // ============================================================

    public async sendResponse(channelId: string, content: string, replyToId?: string): Promise<void> {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (channel && channel instanceof TextChannel) {
                if (replyToId) {
                    await channel.send({
                        content,
                        reply: { messageReference: replyToId }
                    });
                } else {
                    await channel.send(content);
                }
            }
        } catch (error) {
            console.error(`[DiscordClient] Error sending response to ${channelId}:`, error);
        }
    }
}