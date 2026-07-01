import { Router } from "express";
import { db, settingsTable, chatsTable, messagesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

/**
 * POST /api/generate-image
 * Генерирует изображение через OpenRouter Image API.
 *
 * Body: { chatId: number, prompt: string, model?: string }
 * Returns: { url?: string, b64_json?: string, revised_prompt?: string, message_id?: number }
 */
router.post("/generate-image", requireAuth, async (req, res) => {
  const { chatId, prompt, model: requestedModel } = req.body as {
    chatId?: number;
    prompt?: string;
    model?: string;
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: "Промпт обязателен" });
    return;
  }
  if (!chatId) {
    res.status(400).json({ error: "chatId обязателен" });
    return;
  }

  // Get OpenRouter API key and image model
  let apiKey = "";
  let imageModel = requestedModel || "";

  try {
    const rows = await db.select().from(settingsTable);
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    apiKey = map.openrouter_key || "";
    imageModel = imageModel || map.image_model || "openai/dall-e-3";
  } catch {
    // continue with empty
  }

  if (!apiKey) {
    res.status(422).json({ error: "OpenRouter API ключ не настроен. Добавь его в Настройках." });
    return;
  }

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://agentsynapse.replit.app",
        "X-Title": "SYNAPSE AGENT",
      },
      body: JSON.stringify({
        model: imageModel,
        prompt: prompt.trim(),
        n: 1,
        size: "1024x1024",
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      req.log.error({ status: orRes.status, errText }, "OpenRouter image gen error");
      let errorMsg = `Ошибка генерации: ${orRes.status}`;
      try {
        const errJson = JSON.parse(errText);
        errorMsg = errJson.error?.message || errorMsg;
      } catch {}
      res.status(502).json({ error: errorMsg });
      return;
    }

    const data = await orRes.json() as {
      data?: Array<{
        url?: string;
        b64_json?: string;
        revised_prompt?: string;
      }>;
    };

    const image = data.data?.[0];
    if (!image) {
      res.status(502).json({ error: "Пустой ответ от модели" });
      return;
    }

    const imageUrl = image.url || (image.b64_json ? `data:image/png;base64,${image.b64_json}` : null);
    const revisedPrompt = image.revised_prompt || "";

    // Save user message to DB
    try {
      await db.insert(messagesTable).values({
        chatId,
        role: "user",
        content: prompt.trim(),
        tokensUsed: Math.ceil(prompt.length / 4),
      });
    } catch { /* ignore DB errors */ }

    // Save assistant message (image as markdown) to DB
    let savedMsgId: number | null = null;
    try {
      // Store image as markdown: ![description](url)
      const displayText = revisedPrompt
        ? `![${revisedPrompt.slice(0, 100)}](${imageUrl})\n\n*${revisedPrompt}*`
        : `![Сгенерированное изображение](${imageUrl})`;

      const [inserted] = await db.insert(messagesTable).values({
        chatId,
        role: "assistant",
        content: displayText,
        tokensUsed: 0,
        status: "done",
      }).returning({ id: messagesTable.id });

      savedMsgId = inserted?.id ?? null;
    } catch { /* ignore DB errors */ }

    // Update chat token count and message count
    try {
      await db.update(chatsTable)
        .set({
          totalTokens: sql`COALESCE(${chatsTable.totalTokens}, 0) + ${Math.ceil(prompt.length / 4)}`,
          updatedAt: new Date(),
        })
        .where(eq(chatsTable.id, chatId));
    } catch { /* ignore */ }

    res.json({
      url: imageUrl,
      revised_prompt: revisedPrompt,
      message_id: savedMsgId,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Внутренняя ошибка генерации" });
  }
});

export default router;