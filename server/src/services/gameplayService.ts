import type { AnswerData } from '../types/types.js';
import { GameDatabase } from '../db/db.js';
import { calculateScore } from '../utils/scoring.js';

export interface PlayerResult {
  name: string;
  answered: boolean;
  correct: boolean;
  pointsEarned: number;
  totalScore: number;
}

export interface QuestionResultData {
  questionIndex: number;
  correctIndex: number;
  playerResults: PlayerResult[];
}

export interface GameResponse {
  type: 'broadcast';
  gameId: string;
  messageType: string;
  data: unknown;
}

export type BroadcastFn = (gameId: string, type: string, data: unknown) => void;

export class GameplayService {
  private questionTimers: Map<string, NodeJS.Timeout> = new Map();
  private broadcastFunction: BroadcastFn | null = null;

  constructor(private db: GameDatabase) {}

  setBroadcastFunction(fn: BroadcastFn): void {
    this.broadcastFunction = fn;
  }

  validateAnswer(data: AnswerData, gameId: string): { valid: boolean; error?: string } {
    const game = this.db.getGameById(gameId);
    if (!game) return { valid: false, error: 'Game not found.' };

    const { questionIndex, answerIndex } = data;

    if (questionIndex !== game.currentQuestion) {
      return { valid: false, error: 'Invalid question index.' };
    }

    const question = game.questions[questionIndex];
    if (!question) {
      return { valid: false, error: 'Question not found.' };
    }

    if (typeof answerIndex !== 'number' || answerIndex < 0 || answerIndex > 3) {
      return { valid: false, error: 'Invalid answer index.' };
    }

    return { valid: true };
  }

  recordAnswer(userId: string, data: AnswerData, gameId: string): void {
    const game = this.db.getGameById(gameId);
    if (!game) return;

    const timestamp = Date.now() - (game.questionStartTime || Date.now());
    game.playerAnswers.set(userId, { answerIndex: data.answerIndex, timestamp });
  }

  allPlayersAnswered(gameId: string): boolean {
    const game = this.db.getGameById(gameId);
    if (!game) return false;
    return game.players.every((player) => game.playerAnswers.has(player.index));
  }

  startQuestionTimer(gameId: string): void {
    const game = this.db.getGameById(gameId);
    if (!game || game.status !== 'in_progress') return;

    const question = game.questions[game.currentQuestion];
    if (!question) return;

    const existingTimer = this.questionTimers.get(gameId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.endQuestionTimeout(gameId);
    }, question.timeLimitSec * 1000);

    this.questionTimers.set(gameId, timer);
  }

  private endQuestionTimeout(gameId: string): void {
    const game = this.db.getGameById(gameId);
    if (!game || game.status !== 'in_progress') return;

    if (game.questionTimer) {
      clearTimeout(game.questionTimer);
      game.questionTimer = undefined;
    }

    console.log(`Question ${game.currentQuestion} ended — game: ${gameId}`);
  }

  calculatePlayerResults(gameId: string): PlayerResult[] {
    const game = this.db.getGameById(gameId);
    if (!game) return [];

    const question = game.questions[game.currentQuestion];
    return game.players.map((player) => {
      const playerAnswer = game.playerAnswers.get(player.index);
      const answered = playerAnswer !== undefined;
      const correct = answered && playerAnswer.answerIndex === question.correctIndex;
      const pointsEarned = correct ? calculateScore(true, playerAnswer!.timestamp, question.timeLimitSec) : 0;

      if (correct) {
        player.score += pointsEarned;
      }

      return {
        name: player.name,
        answered,
        correct,
        pointsEarned,
        totalScore: player.score,
      };
    });
  }

  broadcastQuestionResult(gameId: string): GameResponse | null {
    const game = this.db.getGameById(gameId);
    if (!game) return null;

    const question = game.questions[game.currentQuestion];
    const playerResults = this.calculatePlayerResults(gameId);

    console.log(`Question result — game: ${gameId}, question: ${game.currentQuestion}`);

    return {
      type: 'broadcast',
      gameId,
      messageType: 'question_result',
      data: {
        questionIndex: game.currentQuestion,
        correctIndex: question.correctIndex,
        playerResults,
      },
    };
  }

  endQuestion(gameId: string): GameResponse[] {
    const game = this.db.getGameById(gameId);
    if (!game || game.status !== 'in_progress') return [];

    if (game.questionTimer) {
      clearTimeout(game.questionTimer);
      game.questionTimer = undefined;
    }

    this.endQuestionTimeout(gameId);

    const responses: GameResponse[] = [];

    const resultResponse = this.broadcastQuestionResult(gameId);
    if (resultResponse) {
      responses.push(resultResponse);
    }

    game.currentQuestion++;

    if (game.currentQuestion < game.questions.length && this.broadcastFunction) {
      setTimeout(() => {
        game.questionStartTime = Date.now();
        game.playerAnswers.clear();
        this.startQuestionTimer(gameId);

        const nextQuestion = game.questions[game.currentQuestion];
        if (this.broadcastFunction) {
          this.broadcastFunction(gameId, 'question', {
            questionNumber: game.currentQuestion + 1,
            totalQuestions: game.questions.length,
            text: nextQuestion.text,
            options: nextQuestion.options,
            timeLimitSec: nextQuestion.timeLimitSec,
          });
        }
      }, 2000);
    } else {
      game.status = 'finished';
      const finishedResponse = this.broadcastGameFinished(gameId);
      if (finishedResponse) {
        responses.push(finishedResponse);
      }
    }

    return responses;
  }

  private broadcastGameFinished(gameId: string): GameResponse | null {
    const game = this.db.getGameById(gameId);
    if (!game) return null;

    const sortedPlayers = [...game.players].sort((a, b) => b.score - a.score);
    const scoreboard = sortedPlayers.map((player, index) => ({
      name: player.name,
      score: player.score,
      rank: index + 1,
    }));

    console.log(`Game finished — id: ${gameId}, total players: ${game.players.length}`);

    return {
      type: 'broadcast',
      gameId,
      messageType: 'game_finished',
      data: { scoreboard },
    };
  }
}
