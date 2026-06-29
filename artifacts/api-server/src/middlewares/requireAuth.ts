import { createHmac, createPublicKey, verify } from "crypto";
import type { Request, Response, NextFunction } from "express";

// Supabase auth is active when both URL and anon key are configured
// (matches the frontend check in /api/auth/config)
const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

// Cache for JWKS public keys
let jwksCache: { keys: Map<string, string>; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getJwksPublicKey(kid: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("[JWKS] SUPABASE_URL not set, cannot fetch JWKS");
    return null;
  }

  const now = Date.now();

  // Return cached key if available and fresh
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL) {
    const key = jwksCache.keys.get(kid);
    if (key) return key;
  }

  // Fetch JWKS from Supabase
  try {
    const baseUrl = supabaseUrl.replace(/\/$/, "");
    const jwksUrl = `${baseUrl}/auth/v1/jwks.json`;
    const headers: Record<string, string> = {};
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (anonKey) headers["apikey"] = anonKey;
    console.log(`[JWKS] Fetching keys from ${jwksUrl}`);
    const res = await fetch(jwksUrl, { headers });
    if (!res.ok) {
      console.error(`[JWKS] Fetch failed: HTTP ${res.status}`);
      return null;
    }
    const jwks = await res.json();

    const keys = new Map<string, string>();
    for (const jwk of jwks.keys || []) {
      if (jwk.kty === "EC" || jwk.kty === "RSA") {
        const pem = jwkToPem(jwk);
        if (pem) keys.set(jwk.kid, pem);
      }
    }

    jwksCache = { keys, fetchedAt: now };
    console.log(`[JWKS] Cached ${keys.size} key(s)`);
    return keys.get(kid) || null;
  } catch (err) {
    console.error("[JWKS] Fetch error:", err);
    return null;
  }
}

/** Convert a JWK to PEM format using Node.js crypto */
function jwkToPem(jwk: Record<string, unknown>): string | null {
  try {
    const publicKey = createPublicKey({ format: "jwk", key: jwk });
    return publicKey.export({ type: "spki", format: "pem" }) as string;
  } catch (err) {
    console.error("[JWKS] jwkToPem error:", err);
    return null;
  }
}

async function verifySupabaseJWT(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    console.error("[JWT] Token doesn't have 3 parts");
    return null;
  }

  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8"));
    const kid = header.kid;
    const alg = header.alg;

    console.log(`[JWT] Verifying: alg=${alg}, kid=${kid}`);

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.error(`[JWT] Token expired at ${payload.exp}`);
      return null;
    }

    if (process.env.SUPABASE_URL && payload.iss) {
      if (!payload.iss.startsWith(process.env.SUPABASE_URL)) {
        console.error(`[JWT] Issuer mismatch: ${payload.iss}`);
        return null;
      }
    }

    // ES256/ES384/ES512: verify with public key from JWKS
    if (alg?.startsWith("ES") && kid) {
      const pem = await getJwksPublicKey(kid);
      if (!pem) {
        console.error("[JWT] JWKS public key not found");
        return null;
      }

      const publicKey = createPublicKey(pem);
      const algMap: Record<string, string> = {
        ES256: "sha256",
        ES384: "sha384",
        ES512: "sha512",
      };
      const hashAlg = algMap[alg] || "sha256";

      const signature = Buffer.from(parts[2], "base64url");
      const data = Buffer.from(`${parts[0]}.${parts[1]}`, "utf-8");

      const valid = verify(
        hashAlg,
        data,
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      );
      console.log(`[JWT] ES256 result: ${valid ? "OK" : "FAILED"}`);
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

      const valid = signature === parts[2];
      console.log(`[JWT] HS256 result: ${valid ? "OK" : "FAILED"}`);
      return valid ? (payload.sub || null) : null;
    }

    console.error(`[JWT] Unsupported algorithm: ${alg}`);
    return null;
  } catch (err) {
    console.error("[JWT] Verification error:", err);
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
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const userId = await verifySupabaseJWT(token);
    if (userId) {
      (req as Request & { userId: string }).userId = `sb_${userId}`;
      return next();
    }
    // If hasSupabase and token was provided but invalid -> 401
    if (hasSupabase) {
      console.error("[requireAuth] JWT verification failed");
      res.status(401).json({ error: "Unauthorized: invalid token" });
      return;
    }
  }

  // 3. Fallback: no auth configured -> use default user
  if (!hasSupabase) {
    (req as Request & { userId: string }).userId = "railway_default_user";
    return next();
  }

  // 4. Auth is configured but no token provided
  res.status(401).json({ error: "Unauthorized: no token" });
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
