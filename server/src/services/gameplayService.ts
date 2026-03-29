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

export type BroadcastFn = (gameId: string, type: string, data: unknown) => void;

export class GameplayService {
  constructor(private db: GameDatabase, private broadcastFunction: BroadcastFn | null = null) {}

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

    if (game.questionTimer) {
      clearTimeout(game.questionTimer);
    }

    game.questionTimer = setTimeout(() => {
      this.endQuestion(gameId);
    }, question.timeLimitSec * 1000);
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

  broadcastQuestionResult(gameId: string): QuestionResultData | null {
    const game = this.db.getGameById(gameId);
    if (!game) return null;

    const question = game.questions[game.currentQuestion];
    const playerResults = this.calculatePlayerResults(gameId);

    console.log(`Question result — game: ${gameId}, question: ${game.currentQuestion}`);

    if (this.broadcastFunction) {
      this.broadcastFunction(gameId, 'question_result', {
        questionIndex: game.currentQuestion,
        correctIndex: question.correctIndex,
        playerResults,
      });
    }

    return {
      questionIndex: game.currentQuestion,
      correctIndex: question.correctIndex,
      playerResults,
    };
  }

  endQuestion(gameId: string): void {
    const game = this.db.getGameById(gameId);
    if (!game || game.status !== 'in_progress' || !this.broadcastFunction) return;

    if (game.questionTimer) {
      clearTimeout(game.questionTimer);
      game.questionTimer = undefined;
    }

    console.log(`Question ${game.currentQuestion} ended — game: ${gameId}`);

    this.broadcastQuestionResult(gameId);
    game.currentQuestion++;

    if (game.currentQuestion < game.questions.length) {
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
    }
  }
}
