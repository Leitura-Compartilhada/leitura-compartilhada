ALTER TABLE "books" ADD COLUMN "source_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "books_owner_source_hash_uq" ON "books" USING btree ("owner_id","source_hash");