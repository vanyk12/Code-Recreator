import { createHmac } from "crypto";
import type { Request, Response, NextFunction } from "express";

// ─── Supabase JWT verification ────────────────────────────────────────
const hasSupabase = !!process.env.SUPABASE_JWT_SECRET;

async function verifySupabaseJWT(token: string): Promise<string | null> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;

  try {
    // Supabase uses HS256 JWTs
    // Split token into header.payload.signature
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Verify signature
    const signature = createHmac("sha256", secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest("base64url");

    if (signature !== parts[2]) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Check issuer (Supabase project URL)
    if (process.env.SUPABASE_URL && payload.iss) {
      if (!payload.iss.startsWith(process.env.SUPABASE_URL)) return null;
    }

    return payload.sub || null;
  } catch {
    return null;
  }
}

// ─── Telegram auth verification ───────────────────────────────────────
function validateTelegramInitData(initData: string): string | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!initData) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");

    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    if (botToken) {
      const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
      const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
      if (expectedHash !== hash) return null;
    }

    const userRaw = params.get("user");
    if (userRaw) {
      const user = JSON.parse(userRaw);
      if (user?.id) return `tg_${user.id}`;
    }

    const userId = params.get("user_id");
    if (userId) return `tg_${userId}`;
  } catch {
    return null;
  }
  return null;
}

// ─── Main auth middleware ─────────────────────────────────────────────
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 1. Try Telegram auth (for Telegram Mini App mode)
  const tgInitData = req.headers["x-telegram-init-data"] as string | undefined;
  if (tgInitData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    let userId: string | null;
    if (!botToken) {
      try {
        const params = new URLSearchParams(tgInitData);
        const userRaw = params.get("user");
        if (userRaw) {
          const user = JSON.parse(userRaw);
          userId = user?.id ? `tg_${user.id}` : null;
        } else {
          userId = null;
        }
      } catch {
        userId = null;
      }
    } else {
      userId = validateTelegramInitData(tgInitData);
    }

    if (userId) {
      (req as Request & { userId: string }).userId = userId;
      return next();
    }
  }

  // 2. Try Supabase JWT (Bearer token)
  const authHeader = req.headers.authorization;
  if (hasSupabase && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const userId = await verifySupabaseJWT(token);
    if (userId) {
      (req as Request & { userId: string }).userId = `sb_${userId}`;
      return next();
    }
  }

  // 3. Fallback: no auth configured — use default user
  if (!hasSupabase) {
    (req as Request & { userId: string }).userId = "railway_default_user";
    return next();
  }

  // 4. Auth is configured but no valid credentials
  res.status(401).json({ error: "Unauthorized" });
}

export async function getUserId(req: Request): Promise<string | null> {
  const tgInitData = req.headers["x-telegram-init-data"] as string | undefined;
  if (tgInitData) {
    const userId = validateTelegramInitData(tgInitData);
    if (userId) return userId;
  }
  const authHeader = req.headers.authorization;
  if (hasSupabase && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const userId = await verifySupabaseJWT(token);
    if (userId) return `sb_${userId}`;
  }
  return (req as any).userId ?? null;
}