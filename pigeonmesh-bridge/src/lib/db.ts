// Database client selector.
// On Vercel (or any serverless host), Prisma + SQLite doesn't work
// because the filesystem is read-only. We use an in-memory store that
// survives as long as at least one serverless instance is warm.
//
// To make it durable, set these env vars and run `prisma db push`:
//   PIGEONMESH_USE_PRISMA=1
//   DATABASE_URL=postgres://...  (Vercel Postgres)





import { db as memDb } from "@/lib/db-memory";


const usePrisma =
  process.env.PIGEONMESH_USE_PRISMA === "1" &&
  !!process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.startsWith("file:");

// Force in-memory on Vercel unless explicitly configured.
const isVercel = !!process.env.VERCEL;
const useMemory = !usePrisma || (isVercel && process.env.PIGEONMESH_USE_PRISMA !== "1");



// Dynamically lazily load Prisma only when called, or fallback to memDb
export const db = useMemory
  ? memDb
  : (() => {
      // Lazy load only when db is accessed
      return require("@/lib/db-prisma").db;
    })();




export const isInMemory = useMemory;
