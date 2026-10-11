import { Router } from "express";
import { chatHandeler } from "../Controllers/chatController";
import { optionalAuth, requireAuth, requireSameOrigin } from "../Services/auth";

const router = Router();
router.use(optionalAuth, requireAuth, requireSameOrigin);

router.post("/",chatHandeler)
router.post("/image", chatHandeler);

export default router;
