import { Router } from "express";
import { createSession, getChatHistory } from "../Controllers/sessionController";

const router = Router();

router.get("/",createSession)

router.get("/histroy/:sessionId",getChatHistory)


export default router;
