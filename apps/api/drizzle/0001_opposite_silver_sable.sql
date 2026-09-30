CREATE TYPE "public"."session_revoke_reason" AS ENUM('rotated', 'logout', 'reuse', 'suspended');--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked_reason" "session_revoke_reason";