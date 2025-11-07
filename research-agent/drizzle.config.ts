import { defineConfig } from "drizzle-kit";

if (!process.env.RA_DATABASE_URL) {
  throw new Error("RA_DATABASE_URL environment variable is required for Research Agent");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.RA_DATABASE_URL,
  },
});
