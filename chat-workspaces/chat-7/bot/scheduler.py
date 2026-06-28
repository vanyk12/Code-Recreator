
import asyncio
import logging
from datetime import datetime
from database import get_pending_reminders, mark_reminder_sent
from aiogram import Bot

logger = logging.getLogger(__name__)


async def reminder_checker(bot: Bot):
    """Проверяет и отправляет просроченные напоминания каждые 30 секунд."""
    while True:
        try:
            reminders = await get_pending_reminders()
            for rem in reminders:
                try:
                    text = f"⏰ Напоминание!\n{rem['text']}"
                    await bot.send_message(chat_id=rem["user_id"], text=text)
                    await mark_reminder_sent(rem["id"])
                    logger.info(f"Reminder {rem['id']} sent to user {rem['user_id']}")
                except Exception as e:
                    logger.error(f"Failed to send reminder {rem['id']}: {e}")
        except Exception as e:
            logger.error(f"Error in reminder checker: {e}")
        await asyncio.sleep(30)
