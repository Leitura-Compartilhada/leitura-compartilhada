CREATE INDEX "book_tags_tag_idx" ON "book_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "shelf_books_book_idx" ON "shelf_books" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "reading_states_book_idx" ON "reading_states" USING btree ("book_id");