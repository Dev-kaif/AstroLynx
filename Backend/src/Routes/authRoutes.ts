import { Router } from "express";
import { currentUser, login, logout, optionalAuth, requireSameOrigin, signup } from "../Services/auth";

const router = Router();
router.use(optionalAuth);
router.get("/me", currentUser);
router.post("/signup", requireSameOrigin, signup);
router.post("/login", requireSameOrigin, login);
router.post("/logout", requireSameOrigin, logout);

export default router;
