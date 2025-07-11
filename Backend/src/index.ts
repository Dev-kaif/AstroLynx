// src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import chatRoute from "./Routes/chatRoute";
import sessionRoutes from "./Routes/sessionRoutes";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.use("/api/chat",chatRoute)
app.use("/api/session",sessionRoutes)


app.listen(port, () => {
  console.log(`🚀 AstroLynx backend listening at http://localhost:${port}`);
});