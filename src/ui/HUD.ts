import { sfx } from '../audio/SoundEffects';
import type { BallEntity } from '../render/BallMesh';
import type { ActiveSelectorVisual, FootballPlayer } from '../render/PlayerMesh';

export interface MatchState {
  scoreBlue: number;
  scoreRed: number;
  timeRemaining: number;
  isGoalPause: boolean;
  isGameOver: boolean;
  shotsBlue: number;
  shotsRed: number;
  stealsCount: number;
  savesCount: number;
}

export class HUDController {
  private staminaBarEl = document.getElementById('stamina-bar') as HTMLElement;
  private staminaTextEl = document.getElementById('stamina-text') as HTMLElement;
  private powerBarEl = document.getElementById('power-bar') as HTMLElement;
  private powerTextEl = document.getElementById('power-text') as HTMLElement;
  private timerEl = document.getElementById('match-timer') as HTMLElement;
  private possessionBadgeEl = document.getElementById('possession-badge') as HTMLElement;
  private goalOverlay = document.getElementById('goal-overlay') as HTMLElement;
  private goalCard = document.getElementById('goal-card') as HTMLElement;
  private goalTeamText = document.getElementById('goal-team-text') as HTMLElement;
  private gameoverOverlay = document.getElementById('gameover-overlay') as HTMLElement;
  private winnerTitle = document.getElementById('winner-title') as HTMLElement;
  private scoreBlueEl = document.getElementById('score-blue') as HTMLElement;
  private scoreRedEl = document.getElementById('score-red') as HTMLElement;

  constructor(onRestart: () => void) {
    document.getElementById('btn-restart')?.addEventListener('click', onRestart);

    document.getElementById('btn-sound')?.addEventListener('click', () => {
      sfx.enabled = !sfx.enabled;
      document.getElementById('icon-sound-on')?.classList.toggle('hidden', !sfx.enabled);
      document.getElementById('icon-sound-off')?.classList.toggle('hidden', sfx.enabled);
    });
  }

  public updatePowerBarUI(val: number): void {
    const pct = Math.round(val);
    this.powerBarEl.style.width = `${pct}%`;
    this.powerTextEl.textContent = `${pct}%`;
  }

  public updateTimerUI(timeRemaining: number): void {
    const totalSeconds = Math.ceil(Math.max(0, timeRemaining));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    this.timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (totalSeconds <= 30) {
      this.timerEl.className = 'arcade-font text-2xl sm:text-3xl font-bold tracking-wider text-rose-400 animate-pulse';
    } else {
      this.timerEl.className = 'arcade-font text-2xl sm:text-3xl font-bold tracking-wider text-amber-300';
    }
  }

  public updateScoreUI(scoreBlue: number, scoreRed: number): void {
    this.scoreBlueEl.textContent = String(scoreBlue);
    this.scoreRedEl.textContent = String(scoreRed);
  }

  public showGoalBanner(scoringTeam: 'blue' | 'red', scoreBlue: number, scoreRed: number): void {
    this.updateScoreUI(scoreBlue, scoreRed);
    if (scoringTeam === 'blue') {
      this.goalTeamText.textContent = '¡ANOTA AZUL FC!';
      this.goalTeamText.className = 'arcade-font text-xl sm:text-2xl font-bold mt-2 text-blue-400';
    } else {
      this.goalTeamText.textContent = '¡GOL DE ROJO IA!';
      this.goalTeamText.className = 'arcade-font text-xl sm:text-2xl font-bold mt-2 text-rose-400';
    }

    this.goalOverlay.classList.remove('hidden');
    this.goalCard.classList.remove('goal-banner-active');
    void this.goalCard.offsetWidth; // Forzar reflow para reiniciar animación CSS
    this.goalCard.classList.add('goal-banner-active');
  }

  public hideGoalBanner(): void {
    this.goalOverlay.classList.add('hidden');
  }

  public showMatchOver(matchState: MatchState): void {
    (document.getElementById('final-score-blue') as HTMLElement).textContent = String(matchState.scoreBlue);
    (document.getElementById('final-score-red') as HTMLElement).textContent = String(matchState.scoreRed);
    (document.getElementById('stat-shots') as HTMLElement).textContent = `${matchState.shotsBlue} / ${matchState.shotsRed}`;
    (document.getElementById('stat-steals') as HTMLElement).textContent = String(matchState.stealsCount);
    (document.getElementById('stat-saves') as HTMLElement).textContent = String(matchState.savesCount);

    if (matchState.scoreBlue > matchState.scoreRed) {
      this.winnerTitle.textContent = '🏆 ¡VICTORIA DE AZUL FC!';
      this.winnerTitle.className = 'arcade-font text-3xl sm:text-4xl font-extrabold text-blue-400 mb-6';
    } else if (matchState.scoreRed > matchState.scoreBlue) {
      this.winnerTitle.textContent = '🤖 ¡VICTORIA DE ROJO IA!';
      this.winnerTitle.className = 'arcade-font text-3xl sm:text-4xl font-extrabold text-rose-400 mb-6';
    } else {
      this.winnerTitle.textContent = '🤝 ¡EMPATE VIBRANTE!';
      this.winnerTitle.className = 'arcade-font text-3xl sm:text-4xl font-extrabold text-amber-300 mb-6';
    }

    this.gameoverOverlay.classList.remove('hidden');
  }

  public hideMatchOver(): void {
    this.gameoverOverlay.classList.add('hidden');
  }

  public updateHUDAndVisualIndicators(
    dt: number,
    elapsedTime: number,
    activePlayer: FootballPlayer | null,
    selector: ActiveSelectorVisual,
    ball: BallEntity
  ): void {
    if (activePlayer) {
      selector.group.position.set(activePlayer.pos.x, 0, activePlayer.pos.z);
      const pulse = 1 + Math.sin(elapsedTime * 7) * 0.08;
      selector.ringMesh.scale.set(pulse, pulse, 1);
      selector.coneMesh.position.y = 3.45 + Math.sin(elapsedTime * 6) * 0.18;
      selector.coneMesh.rotation.y += dt * 3;

      const stam = Math.round(activePlayer.stamina);
      this.staminaBarEl.style.width = `${stam}%`;
      this.staminaTextEl.textContent = `${stam}%`;
    }

    if (ball.owner) {
      if (ball.owner.team === 'blue') {
        this.possessionBadgeEl.textContent = 'POSESIÓN: AZUL FC';
        this.possessionBadgeEl.className =
          'text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/25 text-blue-300 border border-blue-500/40 mt-0.5';
      } else {
        this.possessionBadgeEl.textContent = 'POSESIÓN: ROJO IA';
        this.possessionBadgeEl.className =
          'text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/25 text-rose-300 border border-rose-500/40 mt-0.5';
      }
    } else {
      this.possessionBadgeEl.textContent = 'BALÓN DIVIDIDO';
      this.possessionBadgeEl.className =
        'text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 mt-0.5';
    }
  }
}
