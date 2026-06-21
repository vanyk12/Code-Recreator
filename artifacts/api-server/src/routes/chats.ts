import { Router } from "express";
import { db, chatsTable, messagesTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/chats", requireAuth, async (req, res) => {
  try {
    const userId = (req as typeof req & { userId: string }).userId;
    const chats = await db
      .select({
        id: chatsTable.id,
        title: chatsTable.title,
        model: chatsTable.model,
        createdAt: chatsTable.createdAt,
        updatedAt: chatsTable.updatedAt,
        messageCount: sql<number>`cast(count(${messagesTable.id}) as int)`,
        totalTokens: sql<number>`cast(coalesce(sum(${messagesTable.tokensUsed}), 0) as int)`,
      })
      .from(chatsTable)
      .leftJoin(messagesTable, eq(messagesTable.chatId, chatsTable.id))
      .where(eq(chatsTable.userId, userId))
      .groupBy(chatsTable.id)
      .orderBy(desc(chatsTable.updatedAt));

    res.json(chats.map(c => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list chats" });
  }
});

router.post("/chats", requireAuth, async (req, res) => {
  try {
    const userId = (req as typeof req & { userId: string }).userId;
    const { title, model } = req.body;
    const [chat] = await db.insert(chatsTable).values({
      userId,
      title: title || "Новый чат",
      model: model || "anthropic/claude-3.5-sonnet",
    }).returning();

    res.status(201).json({
      ...chat,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      messageCount: 0,
      totalTokens: 0,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create chat" });
  }
});

router.get("/chats/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as typeof req & { userId: string }).userId;
    const rawId = req.params.id; const id = parseInt(Array.isArray(rawId) ? rawId[0] : rawId);
    const [chat] = await db
      .select({
        id: chatsTable.id,
        title: chatsTable.title,
        model: chatsTable.model,
        createdAt: chatsTable.createdAt,
        updatedAt: chatsTable.updatedAt,
        messageCount: sql<number>`cast(count(${messagesTable.id}) as int)`,
        totalTokens: sql<number>`cast(coalesce(sum(${messagesTable.tokensUsed}), 0) as int)`,
      })
      .from(chatsTable)
      .leftJoin(messagesTable, eq(messagesTable.chatId, chatsTable.id))
      .where(and(eq(chatsTable.id, id), eq(chatsTable.userId, userId)))
      .groupBy(chatsTable.id);

    if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }
    res.json({
      ...chat,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get chat" });
  }
});

router.patch("/chats/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as typeof req & { userId: string }).userId;
    const rawId2 = req.params.id; const id = parseInt(Array.isArray(rawId2) ? rawId2[0] : rawId2);
    const { title, model } = req.body;
    const [chat] = await db.update(chatsTable)
      .set({ ...(title && { title }), ...(model && { model }), updatedAt: new Date() })
      .where(and(eq(chatsTable.id, id), eq(chatsTable.userId, userId)))
      .returning();
    if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }
    res.json({
      ...chat,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      messageCount: 0,
      totalTokens: 0,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update chat" });
  }
});

router.delete("/chats/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as typeof req & { userId: string }).userId;
    const rawId3 = req.params.id; const id = parseInt(Array.isArray(rawId3) ? rawId3[0] : rawId3);
    const deleted = await db.delete(chatsTable)
      .where(and(eq(chatsTable.id, id), eq(chatsTable.userId, userId)))
      .returning();
    if (!deleted.length) { res.status(404).json({ error: "Chat not found" }); return; }
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

router.get("/chats/:id/messages", requireAuth, async (req, res) => {
  try {
    const userId = (req as typeof req & { userId: string }).userId;
    const rawId4 = req.params.id; const id = parseInt(Array.isArray(rawId4) ? rawId4[0] : rawId4);
    const [chat] = await db.select({ id: chatsTable.id })
      .from(chatsTable)
      .where(and(eq(chatsTable.id, id), eq(chatsTable.userId, userId)));
    if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }

    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.chatId, id))
      .orderBy(messagesTable.createdAt);
    res.json(messages.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list messages" });
  }
});

export default router;
