import { Router } from "express";
import { createSession, getChatHistory, listConversations } from "../Controllers/sessionController";
import { optionalAuth, requireAuth, requireSameOrigin } from "../Services/auth";

const router = Router();
router.use(optionalAuth, requireAuth);

router.get("/", listConversations);
router.post("/", requireSameOrigin, createSession);

router.get("/history/:sessionId", getChatHistory);


export default router;
