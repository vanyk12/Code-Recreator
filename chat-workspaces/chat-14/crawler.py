
"""
Умный краулер Telegram-бота
Обходит все меню бота без повторов, сохраняет структуру в JSON и текстовый файл.

Установка:
    pip install telethon

Запуск:
    python crawler.py
"""

import asyncio
import json
import os
import time
from datetime import datetime
from telethon import TelegramClient, events
from telethon.tl.custom import Button
from telethon.errors import FloodWaitError

# ─── КОНФИГУРАЦИЯ ─────────────────────────────────────────────────────────────
API_ID = 0          # ← впишите ваш api_id с https://my.telegram.org
API_HASH = ""       # ← впишите ваш api_hash
SESSION_NAME = "crawler_session"  # создаст файл crawler_session.session

# Бот для обхода (без @)
BOT_USERNAME = "zipppppppppaaaabot"

# Максимальная глубина обхода (0 = только /start, 1 = первый уровень кнопок, и т.д.)
MAX_DEPTH = 3

# Задержка между нажатиями (сек), чтобы не получить флуд-вейт
DELAY = 1.5

# ─── ЛОГИКА ───────────────────────────────────────────────────────────────────

class BotCrawler:
    def __init__(self, client, bot_username):
        self.client = client
        self.bot_username = bot_username
        self.bot_entity = None
        self.menu_tree = {}        # {callback_data: {label, text, buttons, children}}
        self.visited = set()       # множество callback_data, которые уже нажимали
        self.results = []          # плоский список всех посещённых узлов
        self.queue = []            # очередь BFS: [(callback_data_or_None, depth, parent_path)]

    async def init(self):
        self.bot_entity = await self.client.get_entity(self.bot_username)
        print(f"✅ Бот найден: {self.bot_entity.first_name} (@{self.bot_entity.username})")

    async def send_start(self):
        """Отправляет /start и собирает первое сообщение"""
        print(f"\n🚀 Отправляю /start боту @{self.bot_username}...")
        await self.client.send_message(self.bot_entity, "/start")
        await asyncio.sleep(DELAY)

        messages = await self.client.get_messages(self.bot_entity, limit=1)
        if not messages:
            print("❌ Нет ответа от бота")
            return None

        msg = messages[0]
        text, buttons = self._extract(msg)
        node = {
            "path": "/start",
            "label": "/start",
            "text": text,
            "buttons": buttons,
            "depth": 0,
            "children": {},
        }
        self.menu_tree = node
        self.results.append(node)
        self._print_node(node)
        return node

    def _extract(self, msg):
        """Извлекает текст и кнопки из сообщения"""
        text = msg.message or "(без текста)"
        buttons = []
        if msg.buttons:
            for row in msg.buttons:
                row_buttons = []
                for btn in row:
                    callback = None
                    url = None
                    if hasattr(btn, "data") and btn.data:
                        callback = btn.data.decode("utf-8", errors="replace")
                    if hasattr(btn, "url") and btn.url:
                        url = btn.url
                    row_buttons.append({
                        "label": btn.text,
                        "callback": callback,
                        "url": url,
                    })
                buttons.append(row_buttons)
        return text, buttons

    def _print_node(self, node, indent=0):
        prefix = "  " * indent
        label = node["label"][:50]
        print(f"{prefix}{'→ ' if indent > 0 else ''}{label}")
        if node["buttons"]:
            for row in node["buttons"]:
                for btn in row:
                    cb_or_url = btn.get("callback") or btn.get("url") or ""
                    print(f"{prefix}  [button] {btn['label']} → {cb_or_url[:40]}")

    async def click_button(self, callback_data, depth, parent_path, label):
        """Нажимает кнопку и собирает результат"""
        if callback_data in self.visited:
            return None
        self.visited.add(callback_data)

        # Не нажимаем URL-кнопки
        if callback_data.startswith("http") or callback_data.startswith("url:"):
            return None

        print(f"\n📋 [глубина {depth}] Нажимаю: {label} ({callback_data})")
        await asyncio.sleep(DELAY)

        try:
            # Ищем сообщение с этой кнопкой
            messages = await self.client.get_messages(self.bot_entity, limit=5)
            clicked = False
            for msg in messages:
                if not msg.buttons:
                    continue
                for row in msg.buttons:
                    for btn in row:
                        if hasattr(btn, "data") and btn.data:
                            cb = btn.data.decode("utf-8", errors="replace")
                            if cb == callback_data:
                                await btn.click()
                                clicked = True
                                break
                    if clicked:
                        break
                if clicked:
                    break

            if not clicked:
                print(f"  ⚠️ Кнопка не найдена в последних сообщениях, пропускаю")
                return None

            await asyncio.sleep(DELAY)

            # Собираем новое сообщение
            new_messages = await self.client.get_messages(self.bot_entity, limit=1)
            if not new_messages:
                return None

            msg = new_messages[0]
            text, buttons = self._extract(msg)
            node = {
                "path": f"{parent_path} > {label}",
                "label": label,
                "callback": callback_data,
                "text": text,
                "buttons": buttons,
                "depth": depth,
                "children": {},
            }
            self.results.append(node)
            self._print_node(node, indent=depth)
            return node

        except FloodWaitError as e:
            print(f"  ⏳ FloodWait: ждём {e.seconds} сек...")
            await asyncio.sleep(e.seconds + 1)
            return None
        except Exception as e:
            print(f"  ❌ Ошибка: {e}")
            return None

    async def crawl(self):
        """BFS обход меню"""
        root = await self.send_start()
        if not root:
            return

        # Собираем кнопки из корня
        queue = []
        for row in root["buttons"]:
            for btn in row:
                cb = btn.get("callback")
                if cb and cb not in self.visited:
                    queue.append((cb, 1, "/start", btn["label"]))

        while queue:
            next_queue = []
            for cb_data, depth, parent_path, label in queue:
                if depth > MAX_DEPTH:
                    continue
                node = await self.click_button(cb_data, depth, parent_path, label)
                if node:
                    # Добавляем кнопки в очередь (если не повторные)
                    for row in node["buttons"]:
                        for btn in row:
                            cb = btn.get("callback")
                            if cb and cb not in self.visited and not cb.startswith("http"):
                                next_queue.append((cb, depth + 1, node["path"], btn["label"]))
            queue = next_queue

    def save_results(self):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        json_file = f"crawl_result_{timestamp}.json"
        txt_file = f"crawl_result_{timestamp}.txt"

        # JSON
        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(self.results, f, ensure_ascii=False, indent=2)
        print(f"\n💾 JSON сохранён: {json_file}")

        # Текстовое дерево
        with open(txt_file, "w", encoding="utf-8") as f:
            for node in self.results:
                indent = "  " * node["depth"]
                f.write(f"{indent}{'→ ' if node['depth'] > 0 else ''}{node['label']}\n")
                f.write(f"{indent}  Текст: {node['text'][:200]}\n")
                if node["buttons"]:
                    for row in node["buttons"]:
                        for btn in row:
                            cb = btn.get("callback") or btn.get("url") or ""
                            f.write(f"{indent}  [btn] {btn['label']} → {cb}\n")
                f.write("\n")
        print(f"📄 Текст сохранён: {txt_file}")


async def main():
    if not API_ID or not API_HASH:
        print("❌ Заполните API_ID и API_HASH в начале файла crawler.py")
        print("   Получить: https://my.telegram.org → API development tools")
        return

    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    print(f"👤 Авторизован как: {me.first_name} (@{me.username})")

    crawler = BotCrawler(client, BOT_USERNAME)
    await crawler.init()
    await crawler.crawl()
    crawler.save_results()

    print(f"\n✅ Обход завершён! Посещено узлов: {len(crawler.results)}")
    print(f"📦 Уникальных кнопок нажато: {len(crawler.visited)}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
