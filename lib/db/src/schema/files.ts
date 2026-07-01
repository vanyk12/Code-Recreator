
import { pgTable, serial, text, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { chats } from "./chats";

export const files = pgTable("files", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id")
    .references(() => chats.id, { onDelete: "cascade" })
    .notNull(),
  path: varchar("path", { length: 512 }).notNull(),
  content: text("content").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
