import { Router } from "express";
import { randomBytes } from "crypto";
import { db, botTokensTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

/* ── helpers ──────────────────────────────────────────────────────────── */

function checkBotSecret(req: import("express").Request, res: import("express").Response): boolean {
  const envSecret = process.env.BOT_API_SECRET;
  if (envSecret) {
    const provided = (req.query.secret as string | undefined) ?? req.headers["x-bot-secret"] as string | undefined;
    if (provided !== envSecret) {
      res.status(401).json({ error: "Invalid secret" });
      return false;
    }
  }
  return true;
}

async function getOpenRouterKey(userId: string): Promise<string | null> {
  // Try user-specific key first (key namespaced by userId)
  const userKeyRow = await db.select().from(settingsTable).where(eq(settingsTable.key, `openrouter_key_${userId}`));
  if (userKeyRow[0]?.value) return userKeyRow[0].value;
  // Fall back to global key
  const globalRow = await db.select().from(settingsTable).where(eq(settingsTable.key, "openrouter_key"));
  return globalRow[0]?.value ?? null;
}

async function getModel(userId: string): Promise<string> {
  const userModel = await db.select().from(settingsTable).where(eq(settingsTable.key, `model_${userId}`));
  if (userModel[0]?.value) return userModel[0].value;
  const globalModel = await db.select().from(settingsTable).where(eq(settingsTable.key, "model"));
  return globalModel[0]?.value ?? "anthropic/claude-3.5-sonnet";
}

/* ── POST /api/bot-token ──────────────────────────────────────────────── */
// Authenticated user generates or replaces their bot-link token
router.post("/bot-token", requireAuth, async (req, res) => {
  const userId = (req as import("express").Request & { userId: string }).userId;
  try {
    // Delete existing token(s) for this user
    await db.delete(botTokensTable).where(eq(botTokensTable.clerkUserId, userId));

    const token = randomBytes(20).toString("hex");
    await db.insert(botTokensTable).values({ token, clerkUserId: userId });

    res.json({ token });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

/* ── GET /api/bot-token ───────────────────────────────────────────────── */
// Returns existing token for the authenticated user (null if not set)
router.get("/bot-token", requireAuth, async (req, res) => {
  const userId = (req as import("express").Request & { userId: string }).userId;
  try {
    const rows = await db.select().from(botTokensTable).where(eq(botTokensTable.clerkUserId, userId));
    res.json({ token: rows[0]?.token ?? null });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get token" });
  }
});

/* ── DELETE /api/bot-token ────────────────────────────────────────────── */
router.delete("/bot-token", requireAuth, async (req, res) => {
  const userId = (req as import("express").Request & { userId: string }).userId;
  try {
    await db.delete(botTokensTable).where(eq(botTokensTable.clerkUserId, userId));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete token" });
  }
});

/* ── POST /api/bot-task ───────────────────────────────────────────────── */
// Called by Railway bot: validates BOT_API_SECRET + token, runs AI task, returns text
router.post("/bot-task", async (req, res) => {
  if (!checkBotSecret(req, res)) return;

  const { token, task, chatId } = req.body as { token?: string; task?: string; chatId?: number };

  if (!token || !task) {
    res.status(400).json({ error: "token and task are required" });
    return;
  }

  try {
    // Resolve clerkUserId from token
    const tokenRows = await db.select().from(botTokensTable).where(eq(botTokensTable.token, token));
    if (!tokenRows.length) {
      res.status(401).json({ error: "Invalid token. Use /connect in the bot to get a token, then save it in SYNAPSE AGENT settings." });
      return;
    }
    const { clerkUserId } = tokenRows[0];

    // Get API key and model
    const apiKey = await getOpenRouterKey(clerkUserId);
    if (!apiKey) {
      res.status(422).json({ error: "No OpenRouter API key configured for this user. Please add it in SYNAPSE AGENT settings." });
      return;
    }
    const model = await getModel(clerkUserId);

    // Call OpenRouter (non-streaming)
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://agentsynapse.replit.app",
        "X-Title": "SYNAPSE AGENT",
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are SYNAPSE AGENT, an expert AI assistant. Answer concisely and helpfully. If the task involves code, provide complete, working code. Keep your response under 3000 characters when possible.",
          },
          { role: "user", content: task },
        ],
        max_tokens: 2000,
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      req.log.error({ status: orRes.status, errText }, "OpenRouter error");
      res.status(502).json({ error: `AI error: ${orRes.status}` });
      return;
    }

    const data = await orRes.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const answer = data.choices?.[0]?.message?.content ?? "(no response)";

    res.json({
      answer,
      model,
      chatId: chatId ?? null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
