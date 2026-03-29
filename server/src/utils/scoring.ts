const BASE_POINTS = 1000;

export function calculateScore(answeredCorrectly: boolean, timestamp: number, timeLimitSec: number): number {
  if (!answeredCorrectly) return 0;

  const timeRemaining = Math.max(0, timeLimitSec * 1000 - timestamp);
  const score = Math.floor(BASE_POINTS * (timeRemaining / (timeLimitSec * 1000)));
  return Math.min(score, BASE_POINTS);
}
