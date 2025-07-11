import { Router } from "express";
import { chatHandeler } from "../Controllers/chatController";

const router = Router();

router.post("/",chatHandeler)
router.post("/image", chatHandeler);

export default router;
