ALTER TABLE "conversion_jobs" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversion_jobs" ADD COLUMN "source_hash" text;--> statement-breakpoint
CREATE INDEX "conversion_jobs_owner_hash_idx" ON "conversion_jobs" USING btree ("owner_id","source_hash");