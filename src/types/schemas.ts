import { z } from 'zod';

export const QuestionSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1, 'A pergunta não pode estar vazia.')
      .max(500, 'A pergunta deve ter no máximo 500 caracteres.'),
    options: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'A opção não pode estar vazia.')
          .max(200, 'Cada opção deve ter no máximo 200 caracteres.'),
      )
      .min(2, 'A pergunta deve ter no mínimo 2 opções.')
      .max(6, 'A pergunta pode ter no máximo 6 opções.'),
    answer: z
      .number()
      .int()
      .min(0, 'O índice da resposta correta deve ser maior ou igual a zero.'),
  })
  .refine((data) => data.answer < data.options.length, {
    message: 'O índice da resposta correta deve corresponder a uma das opções.',
    path: ['answer'],
  });

export const CreateRoomSchema = z.object({
  questions: z
    .array(QuestionSchema)
    .min(1, 'É necessário fornecer pelo menos 1 pergunta.')
    .max(100, 'O número máximo permitido de perguntas por partida é 100.'),
  timePerQuestion: z.number().int().min(10).max(300).optional().default(15),
  maxPlayers: z.number().int().min(1).max(150).optional().default(10),
});

export const HostRoomAuthSchema = z.object({
  roomId: z.string().trim().min(1, 'Código da sala é obrigatório.'),
  hostToken: z.string().trim().min(1, 'Token de host é obrigatório.'),
});

export const HostKickPlayerSchema = HostRoomAuthSchema.extend({
  playerId: z.string().trim().min(1, 'ID do jogador é obrigatório.'),
});

export const PlayerJoinSchema = z.object({
  roomId: z.string().trim().min(1, 'Código da sala é obrigatório.'),
  playerName: z.string().trim().optional().default(''),
  playerToken: z.string().trim().optional(),
});

export const PlayerLeaveSchema = z.object({
  roomId: z.string().trim().min(1),
  playerToken: z.string().trim().optional(),
});

export const PlayerSubmitAnswerSchema = z.object({
  roomId: z.string().trim().min(1, 'Código da sala é obrigatório.'),
  playerToken: z.string().trim().min(1, 'Token de jogador é obrigatório.'),
  optionIndex: z.number().int().min(0).max(5),
  questionIndex: z.number().int().min(0).optional(),
});

export type ValidatedQuestion = z.infer<typeof QuestionSchema>;
export type ValidatedCreateRoom = z.infer<typeof CreateRoomSchema>;
