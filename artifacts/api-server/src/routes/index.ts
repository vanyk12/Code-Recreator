import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authConfigRouter from "./auth-config";
import chatsRouter from "./chats";
import streamRouter from "./stream";
import filesRouter from "./files";
import terminalRouter from "./terminal";
import settingsRouter from "./settings";
import modelsRouter from "./models";
import botRouter from "./bot";
import tgCrawlRouter from "./tg-crawl";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authConfigRouter);
router.use(chatsRouter);
router.use(streamRouter);
router.use(filesRouter);
router.use(terminalRouter);
router.use(settingsRouter);
router.use(modelsRouter);
router.use(botRouter);
router.use(tgCrawlRouter);

export default router;
