import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const hasClerk = !!process.env.CLERK_SECRET_KEY;

// Conditionally import Clerk — only when CLERK_SECRET_KEY is set
let clerkMiddleware: any = null;
let publishableKeyFromHost: any = null;
let CLERK_PROXY_PATH = "/api/__clerk";
let clerkProxyMiddleware: any = () => (_req: any, _res: any, next: any) => next();
let getClerkProxyHost: any = () => undefined;

if (hasClerk) {
  const clerkExpress = await import("@clerk/express");
  clerkMiddleware = clerkExpress.clerkMiddleware;
  const clerkShared = await import("@clerk/shared/keys");
  publishableKeyFromHost = clerkShared.publishableKeyFromHost;
  const clerkProxy = await import("./middlewares/clerkProxyMiddleware");
  CLERK_PROXY_PATH = clerkProxy.CLERK_PROXY_PATH;
  clerkProxyMiddleware = clerkProxy.clerkProxyMiddleware;
  getClerkProxyHost = clerkProxy.getClerkProxyHost;
  logger.info("Clerk authentication enabled");
} else {
  logger.info("Clerk not configured — running without auth");
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

if (hasClerk && clerkMiddleware) {
  app.use(
    clerkMiddleware((req: any) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

app.use("/api", router);

export default app;
