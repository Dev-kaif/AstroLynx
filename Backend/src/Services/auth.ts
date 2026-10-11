import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Request, Response, NextFunction } from "express";
import { Collection, ObjectId } from "mongodb";
import { z } from "zod";
import { env } from "../config/env";
import { initializeMongoChatStorage, mongoClient } from "./initializeChatService";

const scrypt = promisify(scryptCallback);
const AUTH_COOKIE = "astrolynx_session";
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE_SECONDS = AUTH_TTL_MS / 1000;

type AuthUserDocument = {
  _id: ObjectId;
  email: string;
  name: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: Date;
};
type AuthSessionDocument = {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: { userId: string; email: string; name: string };
    }
  }
}

function users(): Collection<AuthUserDocument> {
  const collection = mongoClient?.db(env.MONGO_DB_NAME).collection<AuthUserDocument>("astrolynx_users");
  if (!collection) throw new Error("Authentication storage is not initialized.");
  return collection;
}

function sessions(): Collection<AuthSessionDocument> {
  const collection = mongoClient?.db(env.MONGO_DB_NAME).collection<AuthSessionDocument>("astrolynx_auth_sessions");
  if (!collection) throw new Error("Authentication storage is not initialized.");
  return collection;
}

function cookieToken(request: Request): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === AUTH_COOKIE) return parts.join("=");
  }
  return undefined;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function writeAuthCookie(response: Response, token: string): void {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`
  );
}

function clearAuthCookie(response: Response): void {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

const signupSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(256),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

async function passwordDigest(password: string, salt: string): Promise<Buffer> {
  return await scrypt(password, Buffer.from(salt, "hex"), 64) as Buffer;
}

async function issueSession(user: AuthUserDocument, response: Response): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await sessions().insertOne({
    tokenHash: hashToken(token),
    userId: String(user._id),
    expiresAt: new Date(Date.now() + AUTH_TTL_MS),
    createdAt: new Date(),
  });
  writeAuthCookie(response, token);
}

function publicUser(user: Pick<AuthUserDocument, "_id" | "email" | "name">) {
  return { id: String(user._id), email: user.email, name: user.name };
}

export async function optionalAuth(request: Request, _response: Response, next: NextFunction): Promise<void> {
  try {
    const token = cookieToken(request);
    if (!token || !/^[A-Za-z0-9_-]{40,60}$/u.test(token)) {
      next();
      return;
    }
    await initializeMongoChatStorage();
    const authSession = await sessions().findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    });
    if (authSession && ObjectId.isValid(authSession.userId)) {
      const user = await users().findOne(
        { _id: new ObjectId(authSession.userId) },
        { projection: { email: 1, name: 1 } },
      );
      if (user) request.authUser = { userId: String(user._id), email: user.email, name: user.name };
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (!request.authUser) {
    response.status(401).json({ error: "Sign in to continue." });
    return;
  }
  next();
}

/** CORS alone does not prevent state-changing cross-site requests. */
export function requireSameOrigin(request: Request, response: Response, next: NextFunction): void {
  const origin = request.get("origin");
  if (!origin || !env.CORS_ORIGINS.includes(origin)) {
    response.status(403).json({ error: "Request origin is not allowed." });
    return;
  }
  next();
}

export async function signup(request: Request, response: Response): Promise<void> {
  const parsed = signupSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Provide a valid name, email, and password of at least 10 characters." });
    return;
  }
  try {
    await initializeMongoChatStorage();
    const email = parsed.data.email.toLowerCase();
    const existing = await users().findOne({ email }, { projection: { _id: 1 } });
    if (existing) {
      response.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await passwordDigest(parsed.data.password, salt)).toString("hex");
    const user: AuthUserDocument = {
      _id: new ObjectId(),
      email,
      name: parsed.data.name,
      passwordSalt: salt,
      passwordHash,
      createdAt: new Date(),
    };
    await users().insertOne(user);
    await issueSession(user, response);
    response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    const duplicateKey = typeof error === "object" && error !== null && "code" in error && error.code === 11000;
    if (duplicateKey) {
      response.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    console.error("Account registration failed:", error instanceof Error ? error.name : "unknown error");
    response.status(500).json({ error: "Could not create the account. Please try again." });
  }
}

export async function login(request: Request, response: Response): Promise<void> {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  try {
    await initializeMongoChatStorage();
    const user = await users().findOne({ email: parsed.data.email.toLowerCase() });
    const candidate = await passwordDigest(parsed.data.password, user?.passwordSalt ?? "00000000000000000000000000000000");
    const expected = user ? Buffer.from(user.passwordHash, "hex") : Buffer.alloc(0);
    const passwordMatches = expected.length === candidate.length && timingSafeEqual(candidate, expected);
    if (!user || !passwordMatches) {
      response.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    await issueSession(user, response);
    response.status(200).json({ user: publicUser(user) });
  } catch (error) {
    console.error("Login failed:", error instanceof Error ? error.name : "unknown error");
    response.status(500).json({ error: "Could not sign in. Please try again." });
  }
}

export async function logout(request: Request, response: Response): Promise<void> {
  const token = cookieToken(request);
  if (token) {
    try {
      await initializeMongoChatStorage();
      await sessions().deleteOne({ tokenHash: hashToken(token) });
    } catch (error) {
      console.error("Logout session cleanup failed:", error instanceof Error ? error.name : "unknown error");
    }
  }
  clearAuthCookie(response);
  response.status(200).json({ ok: true });
}

export function currentUser(request: Request, response: Response): void {
  response.status(200).json({ user: request.authUser ?? null });
}

