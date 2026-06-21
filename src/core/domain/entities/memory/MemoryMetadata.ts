// src/core/domain/entities/memory/MemoryMetadata.ts

// ============================================================
// 📐 TYPES & ENUMS
// ============================================================

/**
 * نوع حافظه - هر نوع رفتار متفاوتی در Pruning و Recall دارد
 *
 * fact       → "علی از تایپ‌اسکریپت استفاده می‌کنه"
 * event      → "امروز باگ داکر رو با هم فیکس کردیم"
 * emotion    → "علی امروز خسته بود و کمکش کردم"
 * preference → "علی قهوه دوست داره"
 * skill      → "علی با React و Node کار می‌کنه"
 * project    → "پروژه فعلی: ربات دیسکورد ویرا"
 * summary    → "خلاصه مکالمه ۱۴ آذر"
 * pinned     → "حافظه‌ای که کاربر گفته فراموش نکن"
 */
export type MemoryType =
    | "fact"
    | "event"
    | "emotion"
    | "preference"
    | "skill"
    | "project"
    | "summary"
    | "pinned";

/**
 * سطح اهمیت حافظه
 *
 * critical → هرگز حذف نشود (مثل اسم، شغل)
 * high     → تا حد امکان نگه‌داری شود
 * medium   → در صورت نیاز خلاصه شود
 * low      → اولین کاندید برای حذف
 */
export type ImportanceLevel = "critical" | "high" | "medium" | "low";

/**
 * وضعیت حافظه در چرخه عمرش
 *
 * active      → فعال و در دسترس
 * summarized  → خلاصه شده و اصلش آرشیو شده
 * archived    → آرشیو شده ولی قابل بازیابی
 * expired     → منقضی و آماده حذف
 */
export type MemoryLifecycle =
    | "active"
    | "summarized"
    | "archived"
    | "expired";

/**
 * منبع حافظه - از کجا ساخته شده
 */
export type MemorySource =
    | "conversation"    // از مکالمه استخراج شد
    | "voice"           // از ویس‌چت استخراج شد
    | "llm-extracted"   // LLM خودش استنباط کرد
    | "user-pinned"     // کاربر خودش گفت "یادت بمونه"
    | "system";         // سیستم ساخت (مثل خلاصه خودکار)

/**
 * تگ‌های حوزه‌ای - کمک به جستجو و دسته‌بندی
 */
export type MemoryDomain =
    | "personal"        // اطلاعات شخصی کاربر
    | "technical"       // اطلاعات فنی و کدنویسی
    | "gaming"          // اطلاعات گیمینگ
    | "emotional"       // وضعیت احساسی
    | "relationship"    // رابطه ویرا و کاربر
    | "project";        // پروژه‌های کاربر

// ============================================================
// 📊 IMPORTANCE SCORING
// ============================================================

/**
 * وزن اهمیت هر نوع حافظه
 *
 * این وزن‌ها مشخص می‌کنند:
 * - کدوم حافظه‌ها اول Prune بشن
 * - کدوم حافظه‌ها اول Recall بشن
 * - کدوم حافظه‌ها ارزش Summarize شدن دارن
 */
export const IMPORTANCE_WEIGHTS: Record<ImportanceLevel, number> = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
} as const;

/**
 * وزن پایه هر نوع حافظه
 *
 * pinned و skill بالاتر هستند چون ماندگارترند
 * event و emotion زودتر expire می‌شوند
 */
export const TYPE_BASE_WEIGHTS: Record<MemoryType, number> = {
    pinned: 0.95,
    skill: 0.85,
    project: 0.80,
    preference: 0.75,
    fact: 0.70,
    event: 0.50,
    emotion: 0.45,
    summary: 0.40,
} as const;

/**
 * TTL پیش‌فرض هر نوع حافظه (به ساعت)
 *
 * null = هرگز منقضی نمی‌شود
 */
export const DEFAULT_TTL_HOURS: Record<MemoryType, number | null> = {
    pinned: null,          // هرگز
    skill: null,           // هرگز
    project: null,         // هرگز
    preference: null,      // هرگز
    fact: 720,             // ۳۰ روز
    event: 168,            // ۷ روز
    emotion: 72,           // ۳ روز
    summary: 720,          // ۳۰ روز
} as const;

// ============================================================
// 🧬 MEMORY METADATA CLASS
// ============================================================

/**
 * متادیتای حافظه - DNA هر واحد حافظه
 *
 * هر MemoryEntry یک MemoryMetadata دارد.
 * این کلاس تعیین می‌کند:
 *   - حافظه چقدر مهمه
 *   - کِی باید حذف بشه
 *   - چطور باید جستجو بشه
 *   - چند بار بهش رجوع شده
 *
 * Immutable است - هر تغییر instance جدید می‌سازد.
 *
 * @example
 * ```typescript
 * const meta = MemoryMetadata.create({
 *   type: "skill",
 *   source: "conversation",
 *   domains: ["technical"],
 *   importance: "high",
 * });
 *
 * // بعد از recall
 * const updated = meta.withRecall();
 *
 * // چک کردن expire
 * if (meta.isExpired()) { ... }
 *
 * // محاسبه امتیاز
 * const score = meta.relevanceScore;
 * ```
 */
export class MemoryMetadata {
    // ─── Identity ────────────────────────────────────────────
    public readonly type: MemoryType;
    public readonly source: MemorySource;
    public readonly domains: readonly MemoryDomain[];

    // ─── Importance ──────────────────────────────────────────
    public readonly importance: ImportanceLevel;
    public readonly userPinned: boolean;

    // ─── Lifecycle ───────────────────────────────────────────
    public readonly lifecycle: MemoryLifecycle;
    public readonly createdAt: Date;
    public readonly updatedAt: Date;
    public readonly expiresAt: Date | null;

    // ─── Usage Tracking ──────────────────────────────────────
    public readonly recallCount: number;
    public readonly lastRecalledAt: Date | null;

    // ─── Relationships ───────────────────────────────────────
    public readonly channelId: string;
    public readonly userId: string;
    public readonly relatedMessageIds: readonly string[];
    public readonly tags: readonly string[];

    // ─── Private Constructor ─────────────────────────────────
    private constructor(params: {
        type: MemoryType;
        source: MemorySource;
        domains: readonly MemoryDomain[];
        importance: ImportanceLevel;
        userPinned: boolean;
        lifecycle: MemoryLifecycle;
        createdAt: Date;
        updatedAt: Date;
        expiresAt: Date | null;
        recallCount: number;
        lastRecalledAt: Date | null;
        channelId: string;
        userId: string;
        relatedMessageIds: readonly string[];
        tags: readonly string[];
    }) {
        this.type = params.type;
        this.source = params.source;
        this.domains = params.domains;
        this.importance = params.importance;
        this.userPinned = params.userPinned;
        this.lifecycle = params.lifecycle;
        this.createdAt = params.createdAt;
        this.updatedAt = params.updatedAt;
        this.expiresAt = params.expiresAt;
        this.recallCount = params.recallCount;
        this.lastRecalledAt = params.lastRecalledAt;
        this.channelId = params.channelId;
        this.userId = params.userId;
        this.relatedMessageIds = params.relatedMessageIds;
        this.tags = params.tags;
    }

    // ============================================================
    // 🏭 FACTORIES
    // ============================================================

    /**
     * ساخت metadata جدید
     *
     * @example
     * ```typescript
     * const meta = MemoryMetadata.create({
     *   type: "fact",
     *   source: "conversation",
     *   domains: ["personal"],
     *   importance: "high",
     *   channelId: "123",
     *   userId: "456",
     * });
     * ```
     */
    static create(params: {
        type: MemoryType;
        source: MemorySource;
        domains: MemoryDomain[];
        importance?: ImportanceLevel;
        channelId: string;
        userId: string;
        relatedMessageIds?: string[];
        tags?: string[];
        userPinned?: boolean;
    }): MemoryMetadata {
        const now = new Date();
        const importance = params.importance ?? MemoryMetadata.inferImportance(params.type, params.source);

        return new MemoryMetadata({
            type: params.type,
            source: params.source,
            domains: params.domains,
            importance,
            userPinned: params.userPinned ?? false,
            lifecycle: "active",
            createdAt: now,
            updatedAt: now,
            expiresAt: MemoryMetadata.calculateExpiry(params.type, now),
            recallCount: 0,
            lastRecalledAt: null,
            channelId: params.channelId,
            userId: params.userId,
            relatedMessageIds: params.relatedMessageIds ?? [],
            tags: params.tags ?? [],
        });
    }

    /**
     * ساخت metadata برای حافظه pin شده
     *
     * @example
     * ```typescript
     * // وقتی کاربر می‌گه: "یادت بمونه من قهوه دوست دارم"
     * const meta = MemoryMetadata.pinned({
     *   type: "preference",
     *   domains: ["personal"],
     *   channelId: "123",
     *   userId: "456",
     * });
     * ```
     */
    static pinned(params: {
        type: MemoryType;
        domains: MemoryDomain[];
        channelId: string;
        userId: string;
        tags?: string[];
    }): MemoryMetadata {
        return MemoryMetadata.create({
            ...params,
            source: "user-pinned",
            importance: "critical",
            userPinned: true,
        });
    }

    /**
     * ساخت metadata برای خلاصه خودکار
     */
    static forSummary(params: {
        channelId: string;
        userId: string;
        originalMessageIds: string[];
    }): MemoryMetadata {
        return MemoryMetadata.create({
            type: "summary",
            source: "system",
            domains: [],
            importance: "medium",
            channelId: params.channelId,
            userId: params.userId,
            relatedMessageIds: params.originalMessageIds,
            tags: ["auto-summary"],
        });
    }

    // ============================================================
    // 🔄 STATE TRANSITIONS (Immutable)
    // ============================================================

    /**
     * وقتی حافظه recall (بازیابی) شد
     * - recallCount افزایش می‌یابد
     * - lastRecalledAt به‌روز می‌شود
     * - expiry تمدید می‌شود (حافظه‌های پرکاربرد دیرتر expire)
     */
    withRecall(): MemoryMetadata {
        const now = new Date();
        const newExpiry = this.extendExpiry(now);

        return this.clone({
            recallCount: this.recallCount + 1,
            lastRecalledAt: now,
            updatedAt: now,
            expiresAt: newExpiry,
        });
    }

    /**
     * وقتی حافظه خلاصه شد
     */
    withSummarized(): MemoryMetadata {
        return this.clone({
            lifecycle: "summarized",
            updatedAt: new Date(),
        });
    }

    /**
     * وقتی حافظه آرشیو شد
     */
    withArchived(): MemoryMetadata {
        return this.clone({
            lifecycle: "archived",
            updatedAt: new Date(),
        });
    }

    /**
     * وقتی حافظه منقضی شد
     */
    withExpired(): MemoryMetadata {
        return this.clone({
            lifecycle: "expired",
            updatedAt: new Date(),
        });
    }

    /**
     * تغییر سطح اهمیت
     */
    withImportance(level: ImportanceLevel): MemoryMetadata {
        return this.clone({
            importance: level,
            updatedAt: new Date(),
        });
    }

    /**
     * pin/unpin کردن حافظه
     */
    withPinned(pinned: boolean): MemoryMetadata {
        return this.clone({
            userPinned: pinned,
            importance: pinned ? "critical" : this.importance,
            expiresAt: pinned ? null : this.expiresAt,
            updatedAt: new Date(),
        });
    }

    /**
     * اضافه کردن تگ جدید
     */
    withTag(tag: string): MemoryMetadata {
        if (this.tags.includes(tag)) return this;

        return this.clone({
            tags: [...this.tags, tag],
            updatedAt: new Date(),
        });
    }

    /**
     * اضافه کردن domain جدید
     */
    withDomain(domain: MemoryDomain): MemoryMetadata {
        if (this.domains.includes(domain)) return this;

        return this.clone({
            domains: [...this.domains, domain],
            updatedAt: new Date(),
        });
    }

    // ============================================================
    // 🔍 QUERY METHODS
    // ============================================================

    /**
     * آیا حافظه منقضی شده؟
     */
    isExpired(): boolean {
        // pinned هرگز expire نمی‌شود
        if (this.userPinned) return false;
        if (this.expiresAt === null) return false;

        return new Date() > this.expiresAt;
    }

    /**
     * آیا حافظه فعال و قابل استفاده است؟
     */
    isActive(): boolean {
        return this.lifecycle === "active" && !this.isExpired();
    }

    /**
     * آیا حافظه نیاز به خلاصه‌سازی دارد؟
     * (فقط eventها و emotionهای قدیمی)
     */
    needsSummarization(): boolean {
        if (this.lifecycle !== "active") return false;
        if (this.userPinned) return false;
        if (this.type === "summary") return false;

        const ageHours = this.ageInHours;
        const ttl = DEFAULT_TTL_HOURS[this.type];

        // وقتی ۷۰٪ عمرش گذشته، خلاصه‌سازی پیشنهاد بشه
        if (ttl !== null && ageHours > ttl * 0.7) return true;

        return false;
    }

    /**
     * آیا قابل حذف است؟
     */
    isDeletable(): boolean {
        if (this.userPinned) return false;
        if (this.importance === "critical") return false;

        return this.lifecycle === "expired" || this.isExpired();
    }

    /**
     * آیا مربوط به domain خاصی است؟
     */
    hasDomain(domain: MemoryDomain): boolean {
        return this.domains.includes(domain);
    }

    /**
     * آیا تگ خاصی دارد؟
     */
    hasTag(tag: string): boolean {
        return this.tags.includes(tag);
    }

    /**
     * آیا از کانال خاصی آمده؟
     */
    isFromChannel(channelId: string): boolean {
        return this.channelId === channelId;
    }

    /**
     * آیا مربوط به کاربر خاصی است؟
     */
    isFromUser(userId: string): boolean {
        return this.userId === userId;
    }

    // ============================================================
    // 📊 SCORING
    // ============================================================

    /**
     * امتیاز کلی اهمیت (0-1)
     *
     * فرمول:
     *   baseWeight × importanceWeight × recencyBoost × recallBoost
     *
     * - حافظه‌های جدیدتر امتیاز بالاتر
     * - حافظه‌های پرکاربرد امتیاز بالاتر
     * - حافظه‌های pin شده همیشه بالاترین امتیاز
     */
    get relevanceScore(): number {
        // pinned = همیشه بالاترین
        if (this.userPinned) return 1.0;

        const baseWeight = TYPE_BASE_WEIGHTS[this.type];
        const importanceWeight = IMPORTANCE_WEIGHTS[this.importance];
        const recencyBoost = this.recencyBoost;
        const recallBoost = this.recallBoost;

        // ترکیب وزنی
        const raw = baseWeight * 0.3
            + importanceWeight * 0.3
            + recencyBoost * 0.25
            + recallBoost * 0.15;

        // clamp به 0-1
        return Math.min(1, Math.max(0, raw));
    }

    /**
     * بوست تازگی (0-1)
     * حافظه‌های جدیدتر امتیاز بالاتر
     *
     * Exponential Decay:
     *   boost = e^(-ageHours / halfLife)
     *
     * halfLife = ۷۲ ساعت (۳ روز)
     * یعنی بعد ۳ روز، بوست به نصف می‌رسد
     */
    private get recencyBoost(): number {
        const halfLifeHours = 72;
        return Math.exp(-this.ageInHours / halfLifeHours);
    }

    /**
     * بوست بازیابی (0-1)
     * حافظه‌هایی که بیشتر recall شدند، مهم‌ترند
     *
     * Logarithmic Growth:
     *   boost = ln(1 + recallCount) / ln(1 + maxRecalls)
     *
     * maxRecalls = ۲۰ (بعد از ۲۰ بار recall، بوست saturate می‌شه)
     */
    private get recallBoost(): number {
        const maxRecalls = 20;
        return Math.log(1 + this.recallCount) / Math.log(1 + maxRecalls);
    }

    /**
     * سن حافظه به ساعت
     */
    get ageInHours(): number {
        return (Date.now() - this.createdAt.getTime()) / (1000 * 60 * 60);
    }

    /**
     * سن حافظه به روز
     */
    get ageInDays(): number {
        return this.ageInHours / 24;
    }

    /**
     * درصد عمر باقیمانده (0-100)
     * null = بدون محدودیت
     */
    get remainingLifePercent(): number | null {
        if (this.expiresAt === null) return null;

        const total = this.expiresAt.getTime() - this.createdAt.getTime();
        const remaining = this.expiresAt.getTime() - Date.now();

        if (remaining <= 0) return 0;

        return Math.round((remaining / total) * 100);
    }

    // ============================================================
    // 📦 SERIALIZATION
    // ============================================================

    /**
     * تبدیل به فرمت مارک‌داون (برای ذخیره در context files)
     *
     * @example
     * ```markdown
     * <!-- meta:fact:high:personal,technical:1703001600 -->
     * ```
     */
    toMarkdownComment(): string {
        const parts = [
            "meta",
            this.type,
            this.importance,
            this.domains.join(",") || "none",
            Math.floor(this.createdAt.getTime() / 1000),
            this.userPinned ? "pinned" : "",
            this.recallCount > 0 ? `rc:${this.recallCount}` : "",
        ].filter(Boolean);

        return `<!-- ${parts.join(":")} -->`;
    }

    /**
     * ساخت metadata از کامنت مارک‌داون
     *
     * @example
     * ```typescript
     * const meta = MemoryMetadata.fromMarkdownComment(
     *   "<!-- meta:fact:high:personal,technical:1703001600:pinned:rc:5 -->",
     *   "channel_123",
     *   "user_456",
     * );
     * ```
     */
    static fromMarkdownComment(
        comment: string,
        channelId: string,
        userId: string,
    ): MemoryMetadata | null {
        const match = comment.match(/<!--\s*(.+?)\s*-->/);
        if (!match) return null;

        const parts = match[1].split(":");
        if (parts[0] !== "meta" || parts.length < 5) return null;

        const type = parts[1] as MemoryType;
        const importance = parts[2] as ImportanceLevel;
        const domains = parts[3] === "none"
            ? []
            : parts[3].split(",") as MemoryDomain[];
        const timestamp = parseInt(parts[4], 10) * 1000;
        const isPinned = parts.includes("pinned");

        // rc:5 → recallCount = 5
        const rcPart = parts.find((p) => p.startsWith("rc"));
        const recallCount = rcPart
            ? parseInt(rcPart.replace("rc", ""), 10)
            : 0;

        const createdAt = new Date(timestamp);

        return new MemoryMetadata({
            type,
            source: isPinned ? "user-pinned" : "conversation",
            domains,
            importance,
            userPinned: isPinned,
            lifecycle: "active",
            createdAt,
            updatedAt: createdAt,
            expiresAt: MemoryMetadata.calculateExpiry(type, createdAt),
            recallCount,
            lastRecalledAt: null,
            channelId,
            userId,
            relatedMessageIds: [],
            tags: [],
        });
    }

    /**
     * تبدیل به JSON (برای logging/metrics)
     */
    toJSON(): Record<string, unknown> {
        return {
            type: this.type,
            source: this.source,
            domains: [...this.domains],
            importance: this.importance,
            userPinned: this.userPinned,
            lifecycle: this.lifecycle,
            relevanceScore: Math.round(this.relevanceScore * 100) / 100,
            recallCount: this.recallCount,
            ageInHours: Math.round(this.ageInHours * 10) / 10,
            remainingLifePercent: this.remainingLifePercent,
            channelId: this.channelId,
            userId: this.userId,
            tags: [...this.tags],
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString(),
            expiresAt: this.expiresAt?.toISOString() ?? null,
        };
    }

    // ============================================================
    // 🔧 PRIVATE HELPERS
    // ============================================================

    /**
     * استنباط خودکار سطح اهمیت بر اساس نوع و منبع
     */
    private static inferImportance(
        type: MemoryType,
        source: MemorySource,
    ): ImportanceLevel {
        // pin شده = همیشه critical
        if (source === "user-pinned") return "critical";

        // بر اساس نوع
        switch (type) {
            case "pinned":
                return "critical";
            case "skill":
            case "project":
                return "high";
            case "fact":
            case "preference":
                return "medium";
            case "event":
            case "emotion":
            case "summary":
                return "low";
            default:
                return "medium";
        }
    }

    /**
     * محاسبه زمان انقضا بر اساس نوع
     */
    private static calculateExpiry(
        type: MemoryType,
        from: Date,
    ): Date | null {
        const ttlHours = DEFAULT_TTL_HOURS[type];

        if (ttlHours === null) return null;

        return new Date(from.getTime() + ttlHours * 60 * 60 * 1000);
    }

    /**
     * تمدید expiry بعد از recall
     * هر recall ← ۱۰٪ عمر اضافه
     * حداکثر ۲ برابر عمر اولیه
     */
    private extendExpiry(now: Date): Date | null {
        if (this.expiresAt === null) return null;

        const ttlHours = DEFAULT_TTL_HOURS[this.type];
        if (ttlHours === null) return null;

        const originalTTLMs = ttlHours * 60 * 60 * 1000;
        const extension = originalTTLMs * 0.1;
        const maxExpiry = this.createdAt.getTime() + originalTTLMs * 2;

        const newExpiry = Math.min(
            this.expiresAt.getTime() + extension,
            maxExpiry,
        );

        return new Date(Math.max(newExpiry, now.getTime()));
    }

    /**
     * ساخت کپی با تغییرات
     */
    private clone(overrides: Partial<{
        type: MemoryType;
        source: MemorySource;
        domains: readonly MemoryDomain[];
        importance: ImportanceLevel;
        userPinned: boolean;
        lifecycle: MemoryLifecycle;
        createdAt: Date;
        updatedAt: Date;
        expiresAt: Date | null;
        recallCount: number;
        lastRecalledAt: Date | null;
        channelId: string;
        userId: string;
        relatedMessageIds: readonly string[];
        tags: readonly string[];
    }>): MemoryMetadata {
        return new MemoryMetadata({
            type: overrides.type ?? this.type,
            source: overrides.source ?? this.source,
            domains: overrides.domains ?? this.domains,
            importance: overrides.importance ?? this.importance,
            userPinned: overrides.userPinned ?? this.userPinned,
            lifecycle: overrides.lifecycle ?? this.lifecycle,
            createdAt: overrides.createdAt ?? this.createdAt,
            updatedAt: overrides.updatedAt ?? this.updatedAt,
            expiresAt: overrides.expiresAt ?? this.expiresAt,
            recallCount: overrides.recallCount ?? this.recallCount,
            lastRecalledAt: overrides.lastRecalledAt ?? this.lastRecalledAt,
            channelId: overrides.channelId ?? this.channelId,
            userId: overrides.userId ?? this.userId,
            relatedMessageIds: overrides.relatedMessageIds ?? this.relatedMessageIds,
            tags: overrides.tags ?? this.tags,
        });
    }
}