import { Router } from "express";
import { chatHandeler } from "../Controllers/chatController";

const router = Router();

router.post("/",chatHandeler)


export default router;
