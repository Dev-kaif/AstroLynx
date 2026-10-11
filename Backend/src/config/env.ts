import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().trim().min(1).optional()
);

const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5001),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
    CHAT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    SESSION_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(5000).default(120),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      )
      .pipe(z.array(z.string().url()).min(1)),
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: optionalString.default("gemini-2.5-flash"),
    GEMINI_TITLE_MODEL: optionalString.default("gemini-3.5-flash-lite"),
    GEMINI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(8192).default(2048),
    PINECONE_API_KEY: optionalString,
    PINECONE_INDEX_NAME: optionalString,
    PINECONE_ENVIRONMENT: optionalString,
    MONGO_URI: optionalString,
    MONGO_DB_NAME: optionalString,
    MONGO_COLLECTION_NAME: optionalString,
    MONGO_MESSAGES_COLLECTION_NAME: z.string().trim().min(1).default("astrolynx_chat_messages_v2"),
    NEO4J_URI: optionalString,
    NEO4J_USERNAME: optionalString,
    NEO4J_PASSWORD: optionalString,
    SARVAM_AI_API_KEY: optionalString,
    JWT_SECRET: optionalString,
    OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
    MOSDAC_BROWSER_EXECUTABLE_PATH: optionalString,
    MOSDAC_LEXICAL_INDEX_PATH: optionalString,
  })
  .superRefine((value, context) => {
    const groups: Array<[string, Array<[string, string | undefined]>]> = [
      ["MongoDB", [["MONGO_URI", value.MONGO_URI], ["MONGO_DB_NAME", value.MONGO_DB_NAME], ["MONGO_COLLECTION_NAME", value.MONGO_COLLECTION_NAME]]],
      ["Pinecone", [["PINECONE_API_KEY", value.PINECONE_API_KEY], ["PINECONE_INDEX_NAME", value.PINECONE_INDEX_NAME]]],
      ["Neo4j", [["NEO4J_URI", value.NEO4J_URI], ["NEO4J_USERNAME", value.NEO4J_USERNAME], ["NEO4J_PASSWORD", value.NEO4J_PASSWORD]]],
    ];

    for (const [service, fields] of groups) {
      const configured = fields.some(([, fieldValue]) => fieldValue !== undefined);
      if (!configured) continue;

      for (const [fieldName, fieldValue] of fields) {
        if (fieldValue === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [fieldName],
            message: `${service} configuration is partial; set all ${service} fields or leave them all empty`,
          });
        }
      }
    }
  });

const parsedEnvironment = serverEnvironmentSchema.safeParse(process.env);
if (!parsedEnvironment.success) {
  const issues = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid server environment configuration:\n${issues}`);
}

/** Validated settings only. Secret values are never logged by this module. */
export const env = parsedEnvironment.data;
