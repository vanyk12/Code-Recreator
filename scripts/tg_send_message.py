#!/usr/bin/env python3
"""Send a Telegram message using Telethon. Called by the API server."""
import sys, os, asyncio, json
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

def main():
    args = {a.split("=", 1)[0]: a.split("=", 1)[1] for a in sys.argv[1:] if "=" in a}
    api_id = int(args.get("api_id", "0"))
    api_hash = args.get("api_hash", "")
    phone = args.get("phone", "")
    session_dir = args.get("session_dir", "/tmp/tg_sessions")
    message = args.get("message", "")

    if not api_id or not api_hash or not phone:
        print(json.dumps({"type": "error", "message": "Missing api_id, api_hash or phone"}))
        return

    os.makedirs(session_dir, exist_ok=True)
    session_path = os.path.join(session_dir, phone)

    async def send():
        client = TelegramClient(session_path, api_id, api_hash)
        await client.connect()

        if not await client.is_user_authorized():
            print(json.dumps({"type": "error", "message": "Not authorized. Run crawl first to create session."}))
            return

        entity = await client.get_entity(phone)
        await client.send_message(entity, message)
        print(f"Message sent to {phone}: {message[:100]}")
        await client.disconnect()

    asyncio.run(send())

if __name__ == "__main__":
    main()