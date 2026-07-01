#!/usr/bin/env python3
"""
SYNAPSE AGENT — Telegram Bot Crawler (production)
Запускается из Node.js API сервера как subprocess.
Ввод:  CLI args (api_id, api_hash, phone, bot_username, max_depth, session_dir)
Вывод: JSON на stdout (по строкам — прогресс, финальный результат — последняя строка)

Формат прогресс-строк (stdout):
  {"type":"progress","step":"auth","message":"Авторизация..."}
  {"type":"progress","step":"crawling","message":"Нажимаю: Купить звёзды","current":3,"total":12}
  {"type":"result","data":{...}}          ← финальная строка
  {"type":"error","message":"..."}        ← ошибка

Сессии хранятся в session_dir/ по номеру телефона.
Первый запуск требует код подтверждения (передаётся через stdin).
"""

import asyncio
import json
import os
import sys
import signal
from datetime import datetime
from pathlib import Path

try:
    from telethon import TelegramClient
    from telethon.errors import (
        FloodWaitError,
        SessionPasswordNeededError,
        PhoneNumberInvalidError,
        ApiIdInvalidError,
        AuthKeyDuplicatedError,
    )
except ImportError:
    print(json.dumps({"type": "error", "message": "telethon не установлен. Запусти: pip install telethon"}))
    sys.exit(1)

# ─── Helpers ──────────────────────────────────────────────────────────────

def log_progress(step: str, message: str, **extra):
    """Отправить прогресс в stdout (одна JSON строка)"""
    obj = {"type": "progress", "step": step, "message": message}
    obj.update(extra)
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def log_result(data: dict):
    """Отправить финальный результат"""
    print(json.dumps({"type": "result", "data": data}, ensure_ascii=False), flush=True)


def log_error(message: str):
    """Отправить ошибку"""
    print(json.dumps({"type": "error", "message": message}, ensure_ascii=False), flush=True)


# ─── Crawler ──────────────────────────────────────────────────────────────

class BotCrawler:
    def __init__(self, api_id: int, api_hash: str, phone: str, bot_username: str,
                 session_dir: str, max_depth: int = 3, delay: float = 1.5):
        self.api_id = api_id
        self.api_hash = api_hash
        self.phone = phone
        self.bot_username = bot_username.lstrip("@")
        self.session_dir = Path(session_dir)
        self.max_depth = max_depth
        self.delay = delay

        self.session_dir.mkdir(parents=True, exist_ok=True)
        session_path = str(self.session_dir / f"{phone}.session")

        self.client = TelegramClient(session_path, api_id, api_hash)
        self.bot_entity = None
        self.visited = set()
        self.results = []
        self.bot_info = {}

    async def connect_and_auth(self):
        """Подключиться к Telegram. Если нужна код — читает из stdin."""
        log_progress("auth", "Подключаюсь к Telegram...")

        await self.client.connect()

        if not await self.client.is_user_authorized():
            log_progress("auth", "Отправляю код на телефон...")
            try:
                await self.client.send_code_request(self.phone)
            except PhoneNumberInvalidError:
                raise Exception("Неверный номер телефона")
            except ApiIdInvalidError:
                raise Exception("Неверный API ID или API Hash")

            log_progress("auth", "waiting_code", needs_input="code",
                         message="Жду код подтверждения...")

            # Читаем код из stdin (отправляет Node.js)
            code = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
            code = code.strip()
            if not code:
                raise Exception("Код не получен")

            try:
                await self.client.sign_in(self.phone, code)
            except SessionPasswordNeededError:
                log_progress("auth", "waiting_2fa", needs_input="password",
                             message="Нужен 2FA пароль...")
                password = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
                password = password.strip()
                if not password:
                    raise Exception("Пароль 2FA не получен")
                await self.client.sign_in(password=password)

        me = await self.client.get_me()
        log_progress("auth", f"Авторизован: {me.first_name} (@{me.username or 'no_username'})")

    async def get_bot_info(self):
        """Получить информацию о боте"""
        log_progress("bot_info", f"Ищу бота @{self.bot_username}...")
        try:
            self.bot_entity = await self.client.get_entity(self.bot_username)
            self.bot_info = {
                "id": self.bot_entity.id,
                "first_name": self.bot_entity.first_name or "",
                "last_name": self.bot_entity.last_name or "",
                "username": self.bot_entity.username or "",
                "description": getattr(self.bot_entity, "about", "") or "",
                "bot": getattr(self.bot_entity, "bot", False),
            }
            log_progress("bot_info", f"Бот найден: {self.bot_entity.first_name} (@{self.bot_entity.username})")
        except Exception as e:
            raise Exception(f"Бот @{self.bot_username} не найден: {e}")

    def _extract(self, msg):
        """Извлечь текст и кнопки из сообщения"""
        text = msg.message or ""
        # Убираем HTML-теги для чистого текста
        import re
        text = re.sub(r"<[^>]+>", "", text)

        buttons = []
        if msg.reply_markup and hasattr(msg.reply_markup, "rows"):
            for row in msg.reply_markup.rows:
                row_btns = []
                for btn in row.buttons:
                    callback = None
                    url = None
                    if hasattr(btn, "data") and btn.data:
                        try:
                            callback = btn.data.decode("utf-8", errors="replace")
                        except Exception:
                            callback = btn.data.hex()
                    if hasattr(btn, "url") and btn.url:
                        url = btn.url
                    row_btns.append({
                        "label": btn.text,
                        "callback": callback,
                        "url": url,
                    })
                buttons.append(row_btns)

        return text, buttons

    async def send_start(self):
        """Отправить /start и получить первое сообщение"""
        log_progress("crawling", "Отправляю /start...")
        await self.client.send_message(self.bot_entity, "/start")
        await asyncio.sleep(self.delay)

        messages = await self.client.get_messages(self.bot_entity, limit=1)
        if not messages:
            raise Exception("Бот не ответил на /start")

        msg = messages[0]
        text, buttons = self._extract(msg)

        # Собираем BotCommands если есть
        bot_commands = []
        try:
            cmds = await self.client.get_bot_info(self.bot_entity)
            if cmds and hasattr(cmds, "bot_info") and cmds.bot_info:
                for cmd in cmds.bot_info.commands:
                    bot_commands.append({"command": cmd.command, "description": cmd.description})
        except Exception:
            pass

        node = {
            "path": "/start",
            "label": "/start",
            "text": text,
            "buttons": buttons,
            "depth": 0,
        }
        self.results.append(node)
        self.visited.add("/start")
        log_progress("crawling", "Получено стартовое меню", current=1, total=1)
        return node, bot_commands

    async def click_button(self, callback_data: str, depth: int, parent_path: str, label: str):
        """Нажать inline-кнопку и собрать результат"""
        if callback_data in self.visited:
            return None
        self.visited.add(callback_data)

        # Не кликаем URL-кнопки
        if callback_data.startswith("http"):
            return None

        log_progress("crawling", f"Нажимаю: {label}",
                     current=len(self.results), depth=depth)

        await asyncio.sleep(self.delay)

        try:
            # Ищем кнопку в последних сообщениях
            messages = await self.client.get_messages(self.bot_entity, limit=5)
            clicked = False
            for msg in messages:
                if not msg.reply_markup or not hasattr(msg.reply_markup, "rows"):
                    continue
                for row in msg.reply_markup.rows:
                    for btn in row.buttons:
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
                return None

            await asyncio.sleep(self.delay)

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
            }
            self.results.append(node)
            log_progress("crawling", f"Готово: {label}",
                         current=len(self.results), depth=depth)
            return node

        except FloodWaitError as e:
            log_progress("crawling", f"FloodWait: ждём {e.seconds}с...")
            await asyncio.sleep(e.seconds + 1)
            return None
        except Exception as e:
            log_progress("crawling", f"Ошибка при нажатии {label}: {e}")
            return None

    async def crawl(self):
        """BFS обход всех кнопок меню"""
        root, bot_commands = await self.send_start()

        # Собираем все callback кнопки из корня
        queue = []
        total_buttons_estimate = 0
        if root["buttons"]:
            for row in root["buttons"]:
                for btn in row:
                    cb = btn.get("callback")
                    if cb and cb not in self.visited and not cb.startswith("http"):
                        queue.append((cb, 1, "/start", btn["label"]))
                        total_buttons_estimate += 1

        log_progress("crawling", f"Найдено кнопок для обхода: {total_buttons_estimate}",
                     total=total_buttons_estimate + len(self.results))

        while queue:
            next_queue = []
            for cb_data, depth, parent_path, label in queue:
                if depth > self.max_depth:
                    continue
                node = await self.click_button(cb_data, depth, parent_path, label)
                if node and node["buttons"]:
                    for row in node["buttons"]:
                        for btn in row:
                            cb = btn.get("callback")
                            if cb and cb not in self.visited and not cb.startswith("http"):
                                next_queue.append((cb, depth + 1, node["path"], btn["label"]))
            queue = next_queue

        return bot_commands

    def build_result(self, bot_commands: list) -> dict:
        """Собрать финальный результат"""
        # Генерируем текстовое описание структуры для ИИ
        structure_text = self._build_structure_text(bot_commands)

        return {
            "bot_info": self.bot_info,
            "bot_commands": bot_commands,
            "menu_nodes": self.results,
            "total_nodes": len(self.results),
            "crawled_at": datetime.utcnow().isoformat() + "Z",
            "structure_text": structure_text,
        }

    def _build_structure_text(self, bot_commands: list) -> str:
        """Сгенерировать человекочитаемое описание структуры бота"""
        lines = []
        lines.append(f"=== ПАРСИНГ БОТА @{self.bot_username} ===")
        lines.append(f"Имя: {self.bot_info.get('first_name', '')}")
        lines.append(f"Описание: {self.bot_info.get('description', '')}")
        lines.append(f"Всего узлов меню: {len(self.results)}")
        lines.append("")

        if bot_commands:
            lines.append("--- Bot Commands ---")
            for cmd in bot_commands:
                lines.append(f"/{cmd['command']} — {cmd['description']}")
            lines.append("")

        for node in self.results:
            indent = "  " * node["depth"]
            prefix = "→ " if node["depth"] > 0 else ""
            lines.append(f"{indent}{prefix}{node['label']}")
            if node["text"]:
                lines.append(f"{indent}  Текст: {node['text'][:300]}")
            if node["buttons"]:
                for row in node["buttons"]:
                    for btn in row:
                        cb = btn.get("callback") or btn.get("url") or ""
                        lines.append(f"{indent}  [btn] {btn['label']} → {cb}")
            lines.append("")

        return "\n".join(lines)


# ─── Main ─────────────────────────────────────────────────────────────────

async def main():
    # Парсим аргументы
    args = {}
    for arg in sys.argv[1:]:
        if "=" in arg:
            key, val = arg.split("=", 1)
            args[key] = val

    api_id = int(args.get("api_id", "0"))
    api_hash = args.get("api_hash", "")
    phone = args.get("phone", "")
    bot_username = args.get("bot", "")
    session_dir = args.get("session_dir", "/tmp/tg_sessions")
    max_depth = int(args.get("max_depth", "3"))

    if not api_id or not api_hash:
        log_error("api_id и api_hash обязательны")
        sys.exit(1)
    if not phone:
        log_error("phone обязателен")
        sys.exit(1)
    if not bot_username:
        log_error("bot username обязателен")
        sys.exit(1)

    crawler = BotCrawler(
        api_id=api_id,
        api_hash=api_hash,
        phone=phone,
        bot_username=bot_username,
        session_dir=session_dir,
        max_depth=max_depth,
    )

    try:
        await crawler.connect_and_auth()
        await crawler.get_bot_info()
        bot_commands = await crawler.crawl()
        result = crawler.build_result(bot_commands)
        log_result(result)
    except Exception as e:
        log_error(str(e))
        sys.exit(1)
    finally:
        try:
            await crawler.client.disconnect()
        except Exception:
            pass


# Graceful shutdown
def signal_handler(sig, frame):
    log_error(f"Получен сигнал {sig}, завершаю...")
    sys.exit(0)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

if __name__ == "__main__":
    asyncio.run(main())