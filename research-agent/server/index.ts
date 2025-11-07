import express from "express";
import { createServer } from "http";
import { setupSession, setupPassport } from "./auth/setup";
import { registerRoutes } from "./api/routes";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Setup authentication
  setupSession(app);
  setupPassport(app);

  // Register API routes
  registerRoutes(app);

  const PORT = process.env.PORT || 5001;

  if (process.env.NODE_ENV === "development") {
    // Development mode with Vite dev server
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    // Production mode
    app.use(express.static(path.join(__dirname, "../dist/public")));
  }

  server.listen(PORT, () => {
    console.log(`[Research Agent] Server running on port ${PORT}`);
    console.log(`[Research Agent] Environment: ${process.env.NODE_ENV}`);
  });
}

startServer().catch(console.error);
