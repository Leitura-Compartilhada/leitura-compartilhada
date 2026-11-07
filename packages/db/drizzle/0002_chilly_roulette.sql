ALTER TABLE "books" ADD COLUMN "reading_status" "reading_status" DEFAULT 'want_to_read' NOT NULL;
--> statement-breakpoint
-- Copia o status que já existia por usuário e livro. O dono do livro é o único usuário com
-- estado de leitura nele, então o join por owner_id é exato. Livros sem estado ficam no padrão.
UPDATE "books" AS b
SET "reading_status" = rs."status"
FROM "reading_states" AS rs
WHERE rs."book_id" = b."id"
  AND rs."user_id" = b."owner_id"
  AND rs."status" <> 'want_to_read';
