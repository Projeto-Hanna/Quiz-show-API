import { randomUUID } from 'node:crypto';
import type {
  Question,
  Player,
  RoomStatus,
  LobbySummary,
  LobbyCounts,
  LobbyPlayer,
  PublicQuestion,
  HostQuestion,
  SubmitAnswerResult,
  RoundResult,
  ScoreboardItem,
  RemoveUserResult,
  StartGameResult,
  RoomSyncState,
} from './types/game.js';

/**
 * Extra time after a question's limit during which answers are still accepted,
 * absorbing network latency and event-loop delay on a CPU-limited host.
 * The round auto-ends after the same grace period.
 */
export const ANSWER_GRACE_MS = 2000;

/** Number of top entries every player receives in the scoreboard. */
export const PLAYER_SCOREBOARD_TOP_N = 10;

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
  public lastActivityAt: number;
  public answeredCount: number;
  public lastRoundResult: RoundResult | null;
  public readonly players: Map<string, Player>;
  /** Tokens of players kicked by the Host; they can't reconnect with them. */
  private readonly kickedTokens: Set<string>;

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
    this.maxPlayers = Math.max(1, Math.min(150, maxPlayers));
    this.status = 'LOBBY';
    this.currentQuestionIndex = 0;
    this.questionStartedAt = 0;
    this.finishedAt = 0;
    this.createdAt = Date.now();
    this.lastActivityAt = this.createdAt;
    this.answeredCount = 0;
    this.lastRoundResult = null;
    this.players = new Map<string, Player>();
    this.kickedTokens = new Set<string>();
  }

  public touch(): void {
    this.lastActivityAt = Date.now();
  }

  public kickPlayer(socketId: string): Player | undefined {
    const player = this.players.get(socketId);
    if (!player) return undefined;
    if (player.playerToken) {
      this.kickedTokens.add(player.playerToken);
    }
    this.removeUser(socketId);
    return player;
  }

  public isTokenKicked(playerToken: string): boolean {
    return this.kickedTokens.has(playerToken);
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
      connected: true,
      playerToken: randomUUID(),
      answered: false,
      lastAnswerCorrect: false,
      lastAnswerOptionIndex: null,
      lastAnswerPoints: 0,
      answerTimeMs: 0,
    };

    this.players.set(socketId, player);
    this.touch();
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

    found.player.connected = true;
    if (found.socketId !== newSocketId) {
      this.players.delete(found.socketId);
      this.players.set(newSocketId, found.player);
    }
    this.recalculateAnsweredCount();
    this.touch();
    return found.player;
  }

  public reconnectHost(newSocketId: string, hostToken: string): boolean {
    if (this.hostToken === hostToken) {
      this.hostSocketId = newSocketId;
      this.touch();
      return true;
    }
    return false;
  }

  public getConnectedPlayerCount(): number {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.connected !== false) count++;
    }
    return count > 0 ? count : this.players.size;
  }

  public recalculateAnsweredCount(): number {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.answered && p.connected !== false) count++;
    }
    this.answeredCount = count;
    return count;
  }

  public markPlayerDisconnected(socketId: string): Player | undefined {
    const player = this.players.get(socketId);
    if (player) {
      player.connected = false;
      this.recalculateAnsweredCount();
    }
    return player;
  }

  public areAllActivePlayersAnswered(): boolean {
    if (this.players.size === 0) return false;
    let hasAtLeastOneAnswer = false;
    for (const p of this.players.values()) {
      if (p.answered) {
        hasAtLeastOneAnswer = true;
      } else if (p.connected !== false) {
        return false;
      }
    }
    return hasAtLeastOneAnswer;
  }

  public removeUser(socketId: string): RemoveUserResult {
    if (socketId === this.hostSocketId) {
      return { isHost: true };
    }

    const removedPlayer = this.players.get(socketId);
    if (removedPlayer) {
      this.players.delete(socketId);
      this.recalculateAnsweredCount();
      this.touch();
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
    if (this.status !== 'LOBBY') {
      throw new Error('A partida já está em andamento.');
    }
    if (this.questions.length === 0) {
      throw new Error('Não há perguntas configuradas para esta sala.');
    }
    const hasConnectedPlayer = Array.from(this.players.values()).some(
      (p) => p.connected !== false,
    );
    if (this.players.size === 0 || !hasConnectedPlayer) {
      throw new Error(
        'É necessário ao menos 1 participante conectado para iniciar a partida.',
      );
    }

    this.status = 'COUNTDOWN';
    this.currentQuestionIndex = 0;
    this.touch();
    return {
      status: this.status,
      totalQuestions: this.questions.length,
      timePerQuestion: this.timePerQuestion,
    };
  }

  public startQuestion(index: number): PublicQuestion | null {
    if (index >= this.questions.length) {
      this.status = 'FINISHED';
      this.touch();
      return null;
    }

    this.currentQuestionIndex = index;
    this.status = 'QUESTION';
    this.questionStartedAt = Date.now();
    this.answeredCount = 0;
    this.lastRoundResult = null;
    this.touch();

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
    questionIndex?: number,
  ): SubmitAnswerResult {
    if (this.status !== 'QUESTION') {
      return { success: false, reason: 'Pergunta não está ativa.' };
    }

    if (
      questionIndex !== undefined &&
      questionIndex !== this.currentQuestionIndex
    ) {
      return { success: false, reason: 'Esta pergunta já foi encerrada.' };
    }

    const player = this.players.get(socketId);
    if (!player) {
      return { success: false, reason: 'Jogador não encontrado na sala.' };
    }

    if (player.answered) {
      return { success: false, reason: 'Resposta já enviada.' };
    }

    const currentQuestion = this.questions[this.currentQuestionIndex];
    if (
      !currentQuestion ||
      optionIndex < 0 ||
      optionIndex >= currentQuestion.options.length
    ) {
      return { success: false, reason: 'Opção inválida.' };
    }

    const elapsedMs = Date.now() - this.questionStartedAt;
    const maxTimeMs = this.timePerQuestion * 1000;
    if (elapsedMs > maxTimeMs + ANSWER_GRACE_MS) {
      return { success: false, reason: 'Tempo esgotado!' };
    }

    player.answered = true;
    player.answerTimeMs = elapsedMs;
    player.lastAnswerOptionIndex = optionIndex;

    const isCorrect = optionIndex === currentQuestion.answer;

    if (isCorrect) {
      // 1000 base points + up to 500 speed bonus
      const clampedElapsed = Math.min(elapsedMs, maxTimeMs);
      const remainingRatio = Math.max(0, (maxTimeMs - clampedElapsed) / maxTimeMs);
      const speedBonus = Math.round(500 * remainingRatio);
      const points = 1000 + speedBonus;

      player.lastAnswerCorrect = true;
      player.lastAnswerPoints = points;
      player.score += points;
    } else {
      player.lastAnswerCorrect = false;
      player.lastAnswerPoints = 0;
    }

    this.recalculateAnsweredCount();
    this.touch();
    const allAnswered = this.areAllActivePlayersAnswered();

    return {
      success: true,
      player,
      allAnswered,
      totalAnswered: this.answeredCount,
      totalPlayers: this.getConnectedPlayerCount(),
    };
  }

  public endRound(): RoundResult {
    this.status = 'ROUND_RESULT';
    this.touch();
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

    const result: RoundResult = {
      questionIndex: this.currentQuestionIndex,
      correctAnswerIndex: currentQ ? currentQ.answer : null,
      playerResults,
      hasMoreQuestions: this.currentQuestionIndex + 1 < this.questions.length,
    };

    this.lastRoundResult = result;
    return result;
  }

  public showScoreboard(): ScoreboardItem[] {
    this.status = 'SCOREBOARD';
    this.touch();
    return this.getScoreboard();
  }

  public finishGame(): ScoreboardItem[] {
    this.status = 'FINISHED';
    this.finishedAt = Date.now();
    this.touch();
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

  /**
   * Scoreboard sent to a single player: the top N plus the player's own row
   * (with its real rank) when they are outside the top N.
   */
  public getPlayerScoreboard(
    fullScoreboard: ScoreboardItem[],
    playerId: string,
    topN: number = PLAYER_SCOREBOARD_TOP_N,
  ): ScoreboardItem[] {
    const top = fullScoreboard.slice(0, topN);
    if (top.some((item) => item.id === playerId)) return top;
    const own = fullScoreboard.find((item) => item.id === playerId);
    return own ? [...top, own] : top;
  }

  public toLobbyPlayer(player: Player): LobbyPlayer {
    return {
      id: player.id,
      name: player.name,
      score: player.score,
      connected: player.connected ?? true,
    };
  }

  /** Lobby summary without the player list (for incremental roster events). */
  public getLobbyCounts(): LobbyCounts {
    return {
      roomId: this.id,
      status: this.status,
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
      totalQuestions: this.questions.length,
      timePerQuestion: this.timePerQuestion,
    };
  }

  public getLobbySummary(): LobbySummary {
    return {
      ...this.getLobbyCounts(),
      players: Array.from(this.players.values()).map((p) =>
        this.toLobbyPlayer(p),
      ),
    };
  }

  public resetToLobby(): LobbySummary {
    this.status = 'LOBBY';
    this.currentQuestionIndex = 0;
    this.questionStartedAt = 0;
    this.finishedAt = 0;
    this.answeredCount = 0;
    this.lastRoundResult = null;
    this.touch();

    for (const [socketId, player] of this.players.entries()) {
      if (player.connected === false) {
        this.players.delete(socketId);
        continue;
      }
      player.score = 0;
      player.answered = false;
      player.lastAnswerCorrect = false;
      player.lastAnswerOptionIndex = null;
      player.lastAnswerPoints = 0;
      player.answerTimeMs = 0;
    }

    return this.getLobbySummary();
  }

  /** Remaining time of the active question, measured with the server clock only. */
  public getRemainingMs(): number {
    if (this.status !== 'QUESTION' || this.questionStartedAt <= 0) return 0;
    const elapsedMs = Date.now() - this.questionStartedAt;
    return Math.max(0, this.timePerQuestion * 1000 - elapsedMs);
  }

  public getSyncState(isHost: boolean, socketId?: string): RoomSyncState {
    const sync: RoomSyncState = {
      status: this.status,
      currentIndex: this.currentQuestionIndex,
      totalQuestions: this.questions.length,
      hasMoreQuestions: this.currentQuestionIndex + 1 < this.questions.length,
    };

    if (this.status === 'QUESTION') {
      sync.currentQuestion = isHost
        ? this.getCurrentQuestionHost()
        : this.getCurrentQuestionPublic();
      sync.answeredCount = this.answeredCount;
      sync.remainingMs = this.getRemainingMs();

      if (!isHost && socketId) {
        const player = this.players.get(socketId);
        sync.playerAnswered = player?.answered ?? false;
        sync.playerSelectedOption = player?.lastAnswerOptionIndex ?? null;
      }
    } else if (this.status === 'ROUND_RESULT') {
      sync.currentQuestion = isHost
        ? this.getCurrentQuestionHost()
        : this.getCurrentQuestionPublic();
      const roundResult = this.lastRoundResult ?? this.endRound();

      if (!isHost && socketId) {
        const player = this.players.get(socketId);
        sync.playerAnswered = player?.answered ?? false;
        sync.playerSelectedOption = player?.lastAnswerOptionIndex ?? null;
        sync.roundResult = {
          ...roundResult,
          playerResults: player
            ? roundResult.playerResults.filter((pr) => pr.id === player.id)
            : [],
        };
      } else {
        sync.roundResult = roundResult;
      }
    } else if (this.status === 'SCOREBOARD' || this.status === 'FINISHED') {
      const fullScoreboard = this.getScoreboard();
      const player = !isHost && socketId ? this.players.get(socketId) : null;
      sync.scoreboard = player
        ? this.getPlayerScoreboard(fullScoreboard, player.id)
        : fullScoreboard;
    }

    return sync;
  }
}
