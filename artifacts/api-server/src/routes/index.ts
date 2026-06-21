import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatsRouter from "./chats";
import streamRouter from "./stream";
import filesRouter from "./files";
import terminalRouter from "./terminal";
import settingsRouter from "./settings";
import modelsRouter from "./models";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatsRouter);
router.use(streamRouter);
router.use(filesRouter);
router.use(terminalRouter);
router.use(settingsRouter);
router.use(modelsRouter);

export default router;
