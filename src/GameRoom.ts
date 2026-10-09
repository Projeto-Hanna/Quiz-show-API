import { randomUUID } from 'node:crypto';
import type {
  Question,
  Player,
  RoomStatus,
  LobbySummary,
  PublicQuestion,
  HostQuestion,
  SubmitAnswerResult,
  RoundResult,
  ScoreboardItem,
  RemoveUserResult,
  StartGameResult,
} from './types/game.js';

export class GameRoom {
  public readonly id: string;
  public hostSocketId: string;
  public hostToken: string;
  public questions: Question[];
  public timePerQuestion: number;
  public readonly maxPlayers: number;
  public status: RoomStatus;
  public currentQuestionIndex: number;
  public questionStartedAt: number;
  public finishedAt: number;
  public createdAt: number;
  public readonly players: Map<string, Player>;

  constructor(
    id: string,
    hostSocketId: string,
    questions: Question[] = [],
    timePerQuestion: number = 15,
    maxPlayers: number = 10,
  ) {
    this.id = id;
    this.hostSocketId = hostSocketId;
    this.hostToken = randomUUID();
    this.questions = questions;
    this.timePerQuestion = Math.max(5, Math.min(300, timePerQuestion));
    this.maxPlayers = Math.max(1, Math.min(30, maxPlayers));
    this.status = 'LOBBY';
    this.currentQuestionIndex = 0;
    this.questionStartedAt = 0;
    this.finishedAt = 0;
    this.createdAt = Date.now();
    this.players = new Map<string, Player>();
  }

  public addPlayer(socketId: string, name: string): Player {
    if (this.status !== 'LOBBY') {
      throw new Error('A partida já começou nesta sala.');
    }

    if (this.players.size >= this.maxPlayers) {
      throw new Error(
        `A sala atingiu o limite máximo de ${this.maxPlayers} participantes.`,
      );
    }

    const trimmedName = (name || '').trim().slice(0, 20);
    if (!trimmedName) {
      throw new Error('Nome do jogador é obrigatório.');
    }

    let finalName = trimmedName;
    let counter = 1;
    const existingNames = Array.from(this.players.values()).map((p) =>
      p.name.toLowerCase(),
    );
    while (existingNames.includes(finalName.toLowerCase())) {
      counter++;
      finalName = `${trimmedName} (${counter})`;
    }

    const player: Player = {
      id: randomUUID(),
      name: finalName,
      score: 0,
      playerToken: randomUUID(),
      answered: false,
      lastAnswerCorrect: false,
      lastAnswerOptionIndex: null,
      lastAnswerPoints: 0,
      answerTimeMs: 0,
    };

    this.players.set(socketId, player);
    return player;
  }

  public getPlayerByUuid(
    playerId: string,
  ): { player: Player; socketId: string } | null {
    for (const [socketId, player] of this.players.entries()) {
      if (player.id === playerId) {
        return { player, socketId };
      }
    }
    return null;
  }

  public getPlayerByToken(
    playerToken: string,
  ): { player: Player; socketId: string } | null {
    for (const [socketId, player] of this.players.entries()) {
      if (player.playerToken === playerToken) {
        return { player, socketId };
      }
    }
    return null;
  }

  public getSocketIdByPlayerId(playerId: string): string | null {
    const found = this.getPlayerByUuid(playerId);
    return found ? found.socketId : null;
  }

  public reconnectPlayer(
    newSocketId: string,
    playerToken: string,
  ): Player | null {
    const found = this.getPlayerByToken(playerToken);
    if (!found) return null;

    if (found.socketId !== newSocketId) {
      this.players.delete(found.socketId);
      // Rotate the token for security
      found.player.playerToken = randomUUID();
      this.players.set(newSocketId, found.player);
    }
    return found.player;
  }

  public reconnectHost(newSocketId: string, hostToken: string): boolean {
    if (this.hostToken === hostToken) {
      this.hostSocketId = newSocketId;
      return true;
    }
    return false;
  }

  public removeUser(socketId: string): RemoveUserResult {
    if (socketId === this.hostSocketId) {
      return { isHost: true };
    }

    const removedPlayer = this.players.get(socketId);
    if (removedPlayer) {
      this.players.delete(socketId);
      return { isHost: false, removedPlayer };
    }

    return { isHost: false };
  }

  public setQuestions(questions: Question[], timePerQuestion?: number): void {
    if (this.status !== 'LOBBY') {
      throw new Error(
        'Não é possível alterar perguntas após o início da partida.',
      );
    }
    this.questions = questions;
    if (timePerQuestion !== undefined) {
      this.timePerQuestion = Math.max(5, Math.min(300, timePerQuestion));
    }
  }

  public startGame(): StartGameResult {
    if (this.questions.length === 0) {
      throw new Error('Não há perguntas configuradas para esta sala.');
    }
    if (this.players.size === 0) {
      throw new Error(
        'É necessário ao menos 1 participante para iniciar a partida.',
      );
    }

    this.status = 'COUNTDOWN';
    this.currentQuestionIndex = 0;
    return {
      status: this.status,
      totalQuestions: this.questions.length,
      timePerQuestion: this.timePerQuestion,
    };
  }

  public startQuestion(index: number): PublicQuestion | null {
    if (index >= this.questions.length) {
      this.status = 'FINISHED';
      return null;
    }

    this.currentQuestionIndex = index;
    this.status = 'QUESTION';
    this.questionStartedAt = Date.now();

    // Reset answered flags
    for (const player of this.players.values()) {
      player.answered = false;
      player.lastAnswerCorrect = false;
      player.lastAnswerOptionIndex = null;
      player.lastAnswerPoints = 0;
      player.answerTimeMs = 0;
    }

    return this.getCurrentQuestionPublic();
  }

  public submitAnswer(
    socketId: string,
    optionIndex: number,
  ): SubmitAnswerResult {
    if (this.status !== 'QUESTION') {
      return { success: false, reason: 'Pergunta não está ativa.' };
    }

    const player = this.players.get(socketId);
    if (!player) {
      return { success: false, reason: 'Jogador não encontrado na sala.' };
    }

    if (player.answered) {
      return { success: false, reason: 'Resposta já enviada.' };
    }

    const elapsedMs = Date.now() - this.questionStartedAt;
    const maxTimeMs = this.timePerQuestion * 1000;
    player.answered = true;
    player.answerTimeMs = elapsedMs;
    player.lastAnswerOptionIndex = optionIndex;

    const currentQuestion = this.questions[this.currentQuestionIndex];
    const isCorrect = optionIndex === currentQuestion.answer;

    if (isCorrect) {
      // 1000 base points + up to 500 speed bonus
      const remainingRatio = Math.max(0, (maxTimeMs - elapsedMs) / maxTimeMs);
      const speedBonus = Math.round(500 * remainingRatio);
      const points = 1000 + speedBonus;

      player.lastAnswerCorrect = true;
      player.lastAnswerPoints = points;
      player.score += points;
    } else {
      player.lastAnswerCorrect = false;
      player.lastAnswerPoints = 0;
    }

    const totalAnswered = Array.from(this.players.values()).filter(
      (p) => p.answered,
    ).length;
    const allAnswered = totalAnswered === this.players.size;

    return {
      success: true,
      player,
      allAnswered,
      totalAnswered,
      totalPlayers: this.players.size,
    };
  }

  public endRound(): RoundResult {
    this.status = 'ROUND_RESULT';
    const currentQ = this.questions[this.currentQuestionIndex];

    const playerResults = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      answered: p.answered,
      isCorrect: p.lastAnswerCorrect,
      optionIndex: p.lastAnswerOptionIndex,
      pointsEarned: p.lastAnswerPoints,
      totalScore: p.score,
    }));

    return {
      questionIndex: this.currentQuestionIndex,
      correctAnswerIndex: currentQ ? currentQ.answer : null,
      playerResults,
      hasMoreQuestions: this.currentQuestionIndex + 1 < this.questions.length,
    };
  }

  public showScoreboard(): ScoreboardItem[] {
    this.status = 'SCOREBOARD';
    return this.getScoreboard();
  }

  public finishGame(): ScoreboardItem[] {
    this.status = 'FINISHED';
    this.finishedAt = Date.now();
    return this.getScoreboard();
  }

  public getCurrentQuestionPublic(): PublicQuestion | null {
    const q = this.questions[this.currentQuestionIndex];
    if (!q) return null;

    return {
      index: this.currentQuestionIndex,
      total: this.questions.length,
      question: q.question,
      options: q.options,
      timeLimit: this.timePerQuestion,
      startedAt: this.questionStartedAt,
    };
  }

  public getCurrentQuestionHost(): HostQuestion | null {
    const q = this.questions[this.currentQuestionIndex];
    if (!q) return null;

    return {
      index: this.currentQuestionIndex,
      total: this.questions.length,
      question: q.question,
      options: q.options,
      answer: q.answer,
      timeLimit: this.timePerQuestion,
      startedAt: this.questionStartedAt,
    };
  }

  public getScoreboard(): ScoreboardItem[] {
    const list = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      answered: p.answered,
      lastAnswerCorrect: p.lastAnswerCorrect,
      lastAnswerPoints: p.lastAnswerPoints,
    }));

    list.sort((a, b) => b.score - a.score);

    return list.map((item, index) => ({
      rank: index + 1,
      ...item,
    }));
  }

  public getLobbySummary(): LobbySummary {
    return {
      roomId: this.id,
      status: this.status,
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
      totalQuestions: this.questions.length,
      timePerQuestion: this.timePerQuestion,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
      })),
    };
  }

  public resetToLobby(): LobbySummary {
    this.status = 'LOBBY';
    this.currentQuestionIndex = 0;
    this.questionStartedAt = 0;
    this.finishedAt = 0;

    for (const player of this.players.values()) {
      player.score = 0;
      player.answered = false;
      player.lastAnswerCorrect = false;
      player.lastAnswerOptionIndex = null;
      player.lastAnswerPoints = 0;
      player.answerTimeMs = 0;
    }

    return this.getLobbySummary();
  }
}
