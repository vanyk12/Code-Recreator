
import asyncio
import logging
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties

from config import BOT_TOKEN
from database import init_db
from handlers import routers
from scheduler import reminder_checker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    # Инициализация БД
    init_db()
    logger.info("Database initialized")

    # Бот и диспетчер
    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN),
    )
    dp = Dispatcher()

    # Подключаем роутеры
    for router in routers:
        dp.include_router(router)

    # Запускаем проверку напоминаний в фоне
    asyncio.create_task(reminder_checker(bot))

    # Пропускаем накопившиеся апдейты и стартуем
    await bot.delete_webhook(drop_pending_updates=True)
    logger.info("Bot started polling")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
