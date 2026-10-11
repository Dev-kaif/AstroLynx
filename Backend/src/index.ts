// src/index.ts
import express from 'express';
import chatRoute from "./Routes/chatRoute";
import sessionRoutes from "./Routes/sessionRoutes";
import authRoutes from "./Routes/authRoutes";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { env } from "./config/env";
import { closeChatService } from "./Services/initializeChatService";

const app = express();
const port = env.PORT;

// Only trust forwarded client IP headers when the deployment's exact proxy
// hop count is configured. The default is to trust no proxy headers.
app.set("trust proxy", env.TRUST_PROXY_HOPS);
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
// Chat accepts at most 7 MB of base64 image data plus JSON overhead.
app.use(express.json({ limit: "8mb" }));

// Liveness only: provider/database readiness is checked when the chat service
// is first used, so the API can start for local UI and ingestion development.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const chatRateLimit = rateLimit({
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  limit: env.CHAT_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  ipv6Subnet: 56,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many chat requests. Please try again shortly." });
  },
});

const sessionRateLimit = rateLimit({
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  limit: env.SESSION_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  ipv6Subnet: 56,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many session requests. Please try again shortly." });
  },
});

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  ipv6Subnet: 56,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many sign-in attempts. Please wait and try again." });
  },
});

app.use("/api/chat", chatRateLimit, chatRoute);
app.use("/api/session", sessionRateLimit, sessionRoutes);
app.use("/api/auth", authRateLimit, authRoutes);

const server = app.listen(port, () => {
  console.log(`AstroLynx API listening on port ${port}`);
});

let shutdownStarted = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.info(`Received ${signal}; draining API requests before shutdown.`);

  const deadline = setTimeout(() => {
    console.error("API shutdown exceeded the 10-second deadline; exiting.");
    process.exit(1);
  }, 10_000);
  deadline.unref();

  server.close(async (serverError) => {
    if (serverError) {
      console.error("HTTP server failed to close cleanly:", serverError.name);
      process.exitCode = 1;
    }
    server.closeIdleConnections();
    try {
      await closeChatService();
    } catch (error) {
      console.error(
        "Chat service shutdown failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  });
  server.closeIdleConnections();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
