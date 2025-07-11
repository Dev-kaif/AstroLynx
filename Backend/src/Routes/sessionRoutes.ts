import { Router } from "express";
import { createSession, getChatHistory } from "../Controllers/sessionController";

const router = Router();

router.get("/",createSession)

router.get("/history/:sessionId",getChatHistory)


export default router;
