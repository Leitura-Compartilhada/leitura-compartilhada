ALTER TABLE "conversion_jobs" ADD COLUMN "source_filename" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversion_jobs" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "conversion_jobs" ADD COLUMN "result_key" text;--> statement-breakpoint
ALTER TABLE "conversion_jobs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "conversion_jobs" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;