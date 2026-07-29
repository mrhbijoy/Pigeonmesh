// Database client selector.
// On Vercel (or any serverless host), Prisma + SQLite doesn't work
// because the filesystem is read-only. We use an in-memory store that
// survives as long as at least one serverless instance is warm.
//
// To make it durable, set these env vars and run `prisma db push`:
//   PIGEONMESH_USE_PRISMA=1
//   DATABASE_URL=postgres://...  (Vercel Postgres)

import { db as memDb } from "@/lib/db-memory";
import { db as prismaDb } from "@/lib/db-prisma";

const usePrisma =
  process.env.PIGEONMESH_USE_PRISMA === "1" &&
  !!process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.startsWith("file:");

// Force in-memory on Vercel unless explicitly configured.
const isVercel = !!process.env.VERCEL;
const useMemory = !usePrisma || (isVercel && process.env.PIGEONMESH_USE_PRISMA !== "1");

export const db = useMemory ? memDb : prismaDb;

export const isInMemory = useMemory;
