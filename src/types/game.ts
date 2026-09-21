export interface Question {
  question: string;
  options: string[];
  answer: number;
}

export interface Player {
  id: string; // UUID público
  name: string;
  score: number;
  playerToken?: string;
  answered: boolean;
  lastAnswerCorrect: boolean;
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
}

// Socket.io Events contracts
export interface ServerToClientEvents {
  'room:player_joined': (data: {
    player: Player;
    summary: LobbySummary;
  }) => void;
  'room:player_left': (data: { player: Player; summary: LobbySummary }) => void;
  'room:closed': (data: { reason: string }) => void;
  'game:countdown': (data: { countdownSeconds: number }) => void;
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
      error?: string;
    }) => void,
  ) => void;
  'player:join_room': (
    data: { roomId: string; playerName: string; playerToken?: string },
    callback?: (res: {
      success: boolean;
      player?: Player; // Pode incluir o playerToken
      summary?: LobbySummary;
      error?: string;
    }) => void,
  ) => void;
  'host:start_game': (
    data: { roomId: string; hostToken: string },
    callback?: (res: { success: boolean; error?: string }) => void,
  ) => void;
  'player:submit_answer': (
    data: { roomId: string; playerToken: string; optionIndex: number },
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
  'host:cancel_room': (
    data: { roomId: string; hostToken: string },
    callback?: (res: { success: boolean; error?: string }) => void,
  ) => void;
}
