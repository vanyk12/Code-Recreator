import { createHmac } from "crypto";
import type { Request, Response, NextFunction } from "express";

const hasClerk = !!process.env.CLERK_SECRET_KEY;

// Lazy Clerk import — only loaded when actually needed
let _getAuth: ((req: any) => any) | null = null;
async function loadClerkGetAuth() {
  if (!_getAuth && hasClerk) {
    try {
      const mod = await import("@clerk/express");
      _getAuth = mod.getAuth;
    } catch {
      _getAuth = null;
    }
  }
  return _getAuth;
}

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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
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
      next();
      return;
    }
  }

  // Try Clerk auth only if configured
  if (hasClerk) {
    const getAuth = await loadClerkGetAuth();
    if (getAuth) {
      try {
        const auth = getAuth(req);
        const userId = auth?.userId;
        if (userId) {
          (req as Request & { userId: string }).userId = userId;
          next();
          return;
        }
      } catch {
        // Clerk auth failed, fall through
      }
    }
  }

  // No auth method succeeded — use default user for Railway standalone mode
  (req as Request & { userId: string }).userId = "railway_default_user";
  next();
}

export async function getUserId(req: Request): Promise<string | null> {
  const tgInitData = req.headers["x-telegram-init-data"] as string | undefined;
  if (tgInitData) {
    const userId = validateTelegramInitData(tgInitData);
    if (userId) return userId;
  }
  if (hasClerk) {
    const getAuth = await loadClerkGetAuth();
    if (getAuth) {
      try {
        const auth = getAuth(req);
        return auth?.userId ?? null;
      } catch {
        // Clerk not available
      }
    }
  }
  return (req as any).userId ?? null;
}