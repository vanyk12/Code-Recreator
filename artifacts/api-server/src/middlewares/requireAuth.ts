import { createHmac, createPublicKey } from "crypto";
import type { Request, Response, NextFunction } from "express";

// ─── Supabase JWT verification (ES256 via JWKS) ──────────────────────
const hasSupabase = !!process.env.SUPABASE_JWT_SECRET;

// Cache for JWKS public keys
let jwksCache: { keys: Map<string, string>; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getJwksPublicKey(kid: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return null;

  const now = Date.now();

  // Return cached key if available and fresh
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL) {
    const key = jwksCache.keys.get(kid);
    if (key) return key;
  }

  // Fetch JWKS from Supabase
  try {
    const jwksUrl = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/jwks.json`;
    const res = await fetch(jwksUrl);
    if (!res.ok) return null;
    const jwks = await res.json();

    const keys = new Map<string, string>();
    for (const jwk of jwks.keys || []) {
      // Convert JWK to PEM
      if (jwk.kty === "EC" || jwk.kty === "RSA") {
        const pem = jwkToPem(jwk);
        if (pem) keys.set(jwk.kid, pem);
      }
    }

    jwksCache = { keys, fetchedAt: now };
    return keys.get(kid) || null;
  } catch {
    return null;
  }
}

/** Convert a JWK to PEM format using Node.js crypto */
function jwkToPem(jwk: Record<string, unknown>): string | null {
  try {
    // Node.js createPublicKey accepts JWK directly (in object form)
    const publicKey = createPublicKey({ format: "jwk", key: jwk });
    return publicKey.export({ type: "spki", format: "pem" }) as string;
  } catch {
    return null;
  }
}

async function verifySupabaseJWT(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    // Decode header to get algorithm and kid
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8"));
    const kid = header.kid;
    const alg = header.alg;

    // Decode payload for expiration/issuer checks
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Check issuer (Supabase project URL)
    if (process.env.SUPABASE_URL && payload.iss) {
      if (!payload.iss.startsWith(process.env.SUPABASE_URL)) return null;
    }

    // ES256/ES384/ES512: verify with public key from JWKS
    if (alg?.startsWith("ES") && kid) {
      const pem = await getJwksPublicKey(kid);
      if (!pem) return null;

      const publicKey = createPublicKey(pem);
      const algMap: Record<string, string> = {
        ES256: "sha256",
        ES384: "sha384",
        ES512: "sha512",
      };
      const hashAlg = algMap[alg] || "sha256";

      const signature = Buffer.from(parts[2], "base64url");
      const data = Buffer.from(`${parts[0]}.${parts[1]}`, "utf-8");

      const valid = require("crypto").verify(hashAlg, data, publicKey, signature);
      return valid ? (payload.sub || null) : null;
    }

    // HS256/HS384/HS512: verify with JWT secret (legacy)
    if (alg?.startsWith("HS") && process.env.SUPABASE_JWT_SECRET) {
      const algMap: Record<string, string> = {
        HS256: "sha256",
        HS384: "sha384",
        HS512: "sha512",
      };
      const hashAlg = algMap[alg] || "sha256";

      const signature = createHmac(hashAlg, process.env.SUPABASE_JWT_SECRET)
        .update(`${parts[0]}.${parts[1]}`)
        .digest("base64url");

      return signature === parts[2] ? (payload.sub || null) : null;
    }

    // Unsupported algorithm
    return null;
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