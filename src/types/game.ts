export interface Question {
  question: string;
  options: string[];
  answer: number;
}

export interface Player {
  id: string; // UUID público
  name: string;
  score: number;
  connected?: boolean;
  playerToken?: string;
  answered: boolean;
  lastAnswerCorrect: boolean;
  lastAnswerOptionIndex: number | null;
  lastAnswerPoints: number;
  answerTimeMs: number;
}

export type RoomStatus =
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'QUESTION'
  | 'ROUND_RESULT'
  | 'SCOREBOARD'
  | 'FINISHED';

export interface LobbyPlayer {
  id: string;
  name: string;
  score: number;
  connected?: boolean;
}

export interface LobbySummary {
  roomId: string;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
  totalQuestions: number;
  timePerQuestion: number;
  players: LobbyPlayer[];
}

/** Lobby summary without the player list — sent with incremental roster events. */
export type LobbyCounts = Omit<LobbySummary, 'players'>;

export interface PublicQuestion {
  index: number;
  total: number;
  question: string;
  options: string[];
  timeLimit: number;
  startedAt: number;
}

export interface HostQuestion extends PublicQuestion {
  answer: number;
}

export interface SubmitAnswerSuccess {
  success: true;
  player: Player;
  allAnswered: boolean;
  totalAnswered: number;
  totalPlayers: number;
}

export interface SubmitAnswerFailure {
  success: false;
  reason: string;
}

export type SubmitAnswerResult = SubmitAnswerSuccess | SubmitAnswerFailure;

export interface PlayerRoundResult {
  id: string;
  name: string;
  answered: boolean;
  isCorrect: boolean;
  optionIndex: number | null;
  pointsEarned: number;
  totalScore: number;
}

export interface RoundResult {
  questionIndex: number;
  correctAnswerIndex: number | null;
  playerResults: PlayerRoundResult[];
  hasMoreQuestions: boolean;
}

export interface ScoreboardItem {
  rank: number;
  id: string;
  name: string;
  score: number;
  answered: boolean;
  lastAnswerCorrect: boolean;
  lastAnswerPoints: number;
}

export interface RemoveUserResult {
  isHost: boolean;
  removedPlayer?: Player;
}

export interface StartGameResult {
  status: RoomStatus;
  totalQuestions: number;
  timePerQuestion: number;
}

export interface CreateRoomData {
  questions: Question[];
  timePerQuestion?: number;
  maxPlayers?: number;
}

export interface RoomSyncState {
  status: RoomStatus;
  currentQuestion?: PublicQuestion | HostQuestion | null;
  answeredCount?: number;
  /** Server-computed remaining time for the active question (immune to client clock skew). */
  remainingMs?: number;
  playerAnswered?: boolean;
  playerSelectedOption?: number | null;
  roundResult?: RoundResult | null;
  scoreboard?: ScoreboardItem[];
  currentIndex: number;
  totalQuestions: number;
  hasMoreQuestions: boolean;
}

// Socket.io Events contracts
export interface ServerToClientEvents {
  // Roster events carry only the changed player plus counts; clients merge them
  // into the full list they received when joining (or rejoining) the room.
  'room:player_joined': (data: {
    player: LobbyPlayer;
    summary: LobbyCounts;
  }) => void;
  'room:player_left': (data: {
    player: LobbyPlayer;
    summary: LobbyCounts;
  }) => void;
  'room:player_connection': (data: {
    playerId: string;
    connected: boolean;
    summary: LobbyCounts;
  }) => void;
  'room:kicked': (data: { reason: string }) => void;
  'room:closed': (data: { reason: string }) => void;
  'game:countdown': (data: { countdownSeconds: number; seconds: number }) => void;
  'game:question_started': (data: {
    question: PublicQuestion | HostQuestion | null;
    isHost: boolean;
  }) => void;
  'game:answer_progress': (data: {
    totalAnswered: number;
    totalPlayers: number;
    allAnswered: boolean;
  }) => void;
  'game:round_result': (data: RoundResult) => void;
  'game:scoreboard': (data: {
    scoreboard: ScoreboardItem[];
    currentIndex: number;
    totalQuestions: number;
    hasMoreQuestions: boolean;
  }) => void;
  'game:finished': (data: { scoreboard: ScoreboardItem[] }) => void;
  'game:reset_to_lobby': (data: { summary: LobbySummary }) => void;
}

export interface ClientToServerEvents {
  'host:create_room': (
    data: CreateRoomData,
    callback?: (res: {
      success: boolean;
      roomId?: string;
      hostToken?: string;
      summary?: LobbySummary;
      error?: string;
    }) => void,
  ) => void;
  'host:rejoin_room': (
    data: { roomId: string; hostToken: string },
    callback?: (res: {
      success: boolean;
      summary?: LobbySummary;
      sync?: RoomSyncState;
      error?: string;
    }) => void,
  ) => void;
  'host:kick_player': (
    data: { roomId: string; hostToken: string; playerId: string },
    callback?: (res: {
      success: boolean;
      summary?: LobbySummary;
      error?: string;
    }) => void,
  ) => void;
  'player:join_room': (
    data: { roomId: string; playerName: string; playerToken?: string },
    callback?: (res: {
      success: boolean;
      player?: Player; // Pode incluir o playerToken
      summary?: LobbySummary;
      sync?: RoomSyncState;
      error?: string;
      /** Machine-readable failure reason, so clients don't parse `error`. */
      code?: 'KICKED';
    }) => void,
  ) => void;
  'player:leave_room': (
    data: { roomId: string; playerToken?: string },
    callback?: (res: { success: boolean }) => void,
  ) => void;
  'host:start_game': (
    data: { roomId: string; hostToken: string },
    callback?: (res: { success: boolean; error?: string }) => void,
  ) => void;
  'player:submit_answer': (
    data: {
      roomId: string;
      playerToken: string;
      optionIndex: number;
      /** Index of the question the player is answering; stale answers are rejected. */
      questionIndex?: number;
    },
    callback?: (res: {
      success: boolean;
      pointsEarned?: number;
      isCorrect?: boolean;
      error?: string;
    }) => void,
  ) => void;
  'host:end_round': (
    data: { roomId: string; hostToken: string },
    callback?: (res: {
      success: boolean;
      roundData?: RoundResult;
      error?: string;
    }) => void,
  ) => void;
  'host:show_scoreboard': (
    data: { roomId: string; hostToken: string },
    callback?: (res: {
      success: boolean;
      scoreboard?: ScoreboardItem[];
      error?: string;
    }) => void,
  ) => void;
  'host:next_question': (
    data: { roomId: string; hostToken: string },
    callback?: (res: {
      success: boolean;
      finished?: boolean;
      error?: string;
    }) => void,
  ) => void;
  'host:end_game': (
    data: { roomId: string; hostToken: string },
    callback?: (res: { success: boolean; error?: string }) => void,
  ) => void;
  'host:restart_game': (
    data: { roomId: string; hostToken: string },
    callback?: (res: {
      success: boolean;
      summary?: LobbySummary;
      error?: string;
    }) => void,
  ) => void;
  'host:cancel_room': (
    data: { roomId: string; hostToken: string },
    callback?: (res: { success: boolean; error?: string }) => void,
  ) => void;
}
