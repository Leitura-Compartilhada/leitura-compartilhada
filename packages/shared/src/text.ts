import { z } from "zod";

/** Caracteres de largura zero: passam pelo `trim()` mas não aparecem na tela. */
const INVISIBLE = /[​-‍⁠﻿]/g;
const HAS_VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Texto de usuário em forma única: Unicode NFC (o "é" digitado e o "e" + acento viram o mesmo),
 * sem caracteres invisíveis e sem espaços nas pontas.
 */
export function cleanText(text: string): string {
  return text.normalize("NFC").replace(INVISIBLE, "").trim();
}

/** Texto limpo, com ao menos um caractere visível e no máximo `max` caracteres. */
export const visibleText = (max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .refine((text) => HAS_VISIBLE.test(text), {
          message: "o texto precisa ter um caractere visível",
        }),
    );
