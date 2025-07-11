// src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import chatRoute from "./Routes/chatRoute";
import sessionRoutes from "./Routes/sessionRoutes";
import cors from 'cors'

dotenv.config();

const app = express();
const port = process.env.PORT;

app.use(cors());
// Increase limit for image uploads (Base64 can be large)
app.use(express.json({ limit: '50mb' })); // Ensure this is applied before routes

app.use("/api/chat", chatRoute);
app.use("/api/session", sessionRoutes);

app.listen(port, () => {
  console.log(`🚀 AstroLynx backend listening at http://localhost:${port}`);
});