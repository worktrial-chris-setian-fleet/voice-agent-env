import chalk from 'chalk';
import type { AgentAction } from '../agent/types.js';
import type { ProgressPhase, StepResult, EpisodeResult, Task, TaskType } from '../env/types.js';

export class Logger {
  private lastLoggedTurn: number | null = null;

  episodeStart(index: number, task: Task): void {
    this.lastLoggedTurn = null;
    console.log('');
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log(chalk.bold.white(`  EPISODE ${index + 1} — ${task.type}`));
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log(chalk.bold.white('Task:'), task.description);
    console.log(chalk.bold.white('Field:'), task.targetField);
    console.log(chalk.bold.white('─'.repeat(60)));
  }

  agentAction(action: AgentAction, turn: number): void {
    if (this.lastLoggedTurn !== null && turn !== this.lastLoggedTurn) {
      console.log(chalk.dim('  ' + '·'.repeat(56)));
    }
    this.lastLoggedTurn = turn;

    const argsStr = Object.entries(action.arguments)
      .map(([k, v]) => `${k}="${v}"`)
      .join(', ');
    console.log(chalk.cyan(`[Turn ${turn}] CALLER → ${action.toolName}(${argsStr})`));
  }

  stepResult(result: StepResult): void {
    // Print voice agent response
    console.log(chalk.yellow(`  VOICE AGENT: ${result.state.lastResponse}`));

    if (
      result.progressUpdate.newlyConfirmedClues.length > 0 ||
      result.progressUpdate.targetFieldObservedThisTurn ||
      result.progressUpdate.phaseChangedTo !== null
    ) {
      const parts: string[] = [];
      if (result.progressUpdate.newlyConfirmedClues.length > 0) {
        parts.push(`resolved clue: ${result.progressUpdate.newlyConfirmedClues.join(', ')}`);
      }
      if (result.progressUpdate.resolvedCompanyNameThisTurn) {
        parts.push(`resolved account: ${result.progressUpdate.resolvedCompanyNameThisTurn}`);
      }
      if (result.progressUpdate.phaseChangedTo === 'AWAITING_FOLLOW_UP') {
        parts.push('awaiting caller follow-up');
      }
      if (result.progressUpdate.targetFieldObservedThisTurn) {
        parts.push('target field observed');
      }
      console.log(chalk.magenta(`  Progress: ${parts.join(' | ')}`));
    }

    if (result.reward !== 0 || result.rewardEvents.length > 0) {
      const rewardSign = result.reward >= 0 ? '+' : '';
      const rewardColor = result.reward >= 0 ? chalk.green : chalk.red;
      console.log(rewardColor(`  Reward: ${rewardSign}${result.reward} [${result.rewardEvents.join(', ')}]`));
    }
  }

  episodeSummary(result: EpisodeResult): void {
    const success = result.success;
    const outcomeColor = success ? chalk.green : chalk.red;
    const outcomeLabel = success ? 'SUCCESS' : 'FAILURE';

    console.log('');
    console.log(chalk.bold.white('┌' + '─'.repeat(58) + '┐'));
    console.log(chalk.bold.white('│') + chalk.bold.white(` Episode ${result.episodeIndex + 1} Summary`.padEnd(58)) + chalk.bold.white('│'));
    console.log(chalk.bold.white('├' + '─'.repeat(58) + '┤'));
    console.log(chalk.bold.white('│') + ` Task Type:    ${result.task.type}`.padEnd(58) + chalk.bold.white('│'));
    console.log(chalk.bold.white('│') + ` Field:        ${result.task.targetField}`.padEnd(58) + chalk.bold.white('│'));
    console.log(chalk.bold.white('│') + ` Turns:        ${result.turnCount}`.padEnd(58) + chalk.bold.white('│'));
    const submitted = result.submittedAnswer === null
      ? '(none)'
      : `${result.submittedField ?? '(unknown field)'} = ${result.submittedAnswer}`;
    console.log(chalk.bold.white('│') + ` Answer:       ${submitted}`.padEnd(58) + chalk.bold.white('│'));
    console.log(chalk.bold.white('│') + ` Target:       ${result.task.targetValue}`.padEnd(58) + chalk.bold.white('│'));
    if (result.progress.totalResolutionClues > 0) {
      console.log(
        chalk.bold.white('│') +
        ` Resolution:   ${result.progress.resolutionCluesMatched}/${result.progress.totalResolutionClues} clues`.padEnd(58) +
        chalk.bold.white('│')
      );
      console.log(
        chalk.bold.white('│') +
        ` Phase:        ${formatPhase(result.progress.phase)}`.padEnd(58) +
        chalk.bold.white('│')
      );
      if (result.progress.resolvedCompanyName) {
        console.log(
          chalk.bold.white('│') +
          ` Resolved:     ${result.progress.resolvedCompanyName}`.padEnd(58) +
          chalk.bold.white('│')
        );
      }
      console.log(
        chalk.bold.white('│') +
        ` Field Seen:   ${result.progress.targetFieldObserved ? 'yes' : 'no'}`.padEnd(58) +
        chalk.bold.white('│')
      );
    }
    console.log(chalk.bold.white('│') + ` Outcome:      ${outcomeColor(outcomeLabel)}`.padEnd(58 + (outcomeColor(outcomeLabel).length - outcomeLabel.length)) + chalk.bold.white('│'));
    if (!result.success && result.failureReason) {
      const reason = result.failureReason.replace(/_/g, ' ').toLowerCase();
      console.log(chalk.bold.white('│') + chalk.red(` Reason:       ${reason}`).padEnd(58 + (chalk.red('').length)) + chalk.bold.white('│'));
    }
    console.log(chalk.bold.white('│') + ` Total Reward: ${result.totalReward}`.padEnd(58) + chalk.bold.white('│'));
    console.log(chalk.bold.white('└' + '─'.repeat(58) + '┘'));
  }

  runSummary(results: EpisodeResult[]): void {
    const total = results.length;
    if (total === 0) return;

    const successes = results.filter(r => r.success).length;
    const successRate = ((successes / total) * 100).toFixed(1);
    const avgReward = (results.reduce((s, r) => s + r.totalReward, 0) / total).toFixed(2);
    const avgTurns = (results.reduce((s, r) => s + r.turnCount, 0) / total).toFixed(2);

    const grouped = new Map<TaskType, EpisodeResult[]>();
    for (const result of results) {
      const existing = grouped.get(result.task.type) ?? [];
      existing.push(result);
      grouped.set(result.task.type, existing);
    }

    const multistep = results.filter(r => r.task.type === 'RESOLVE_THEN_RETRIEVE');
    const avgResolutionRate = multistep.length > 0
      ? (
          multistep.reduce((sum, r) =>
            sum + (r.progress.totalResolutionClues === 0
              ? 0
              : r.progress.resolutionCluesMatched / r.progress.totalResolutionClues), 0) / multistep.length
        ).toFixed(2)
      : null;
    const targetObservedRate = multistep.length > 0
      ? (
          multistep.filter(r => r.progress.targetFieldObserved).length / multistep.length * 100
        ).toFixed(1)
      : null;
    const followUpPendingRate = multistep.length > 0
      ? (
          multistep.filter(r => r.progress.phase === 'AWAITING_FOLLOW_UP').length / multistep.length * 100
        ).toFixed(1)
      : null;

    console.log('');
    console.log(chalk.bold.white('╔' + '═'.repeat(58) + '╗'));
    console.log(chalk.bold.white('║') + chalk.bold.white(' RUN SUMMARY'.padEnd(58)) + chalk.bold.white('║'));
    console.log(chalk.bold.white('╠' + '═'.repeat(58) + '╣'));
    console.log(chalk.bold.white('║') + ` Episodes:     ${total}`.padEnd(58) + chalk.bold.white('║'));
    console.log(chalk.bold.white('║') + ` Success Rate: ${successRate}% (${successes}/${total})`.padEnd(58) + chalk.bold.white('║'));
    console.log(chalk.bold.white('║') + ` Avg Reward:   ${avgReward}`.padEnd(58) + chalk.bold.white('║'));
    console.log(chalk.bold.white('║') + ` Avg Turns:    ${avgTurns}`.padEnd(58) + chalk.bold.white('║'));
    console.log(chalk.bold.white('╠' + '═'.repeat(58) + '╣'));
    console.log(chalk.bold.white('║') + chalk.bold.white(' BY TASK TYPE'.padEnd(58)) + chalk.bold.white('║'));
    console.log(chalk.bold.white('╠' + '═'.repeat(58) + '╣'));
    for (const [taskType, taskResults] of grouped.entries()) {
      const successesForType = taskResults.filter(r => r.success).length;
      const rate = ((successesForType / taskResults.length) * 100).toFixed(1);
      const avgRewardForType = (taskResults.reduce((s, r) => s + r.totalReward, 0) / taskResults.length).toFixed(2);
      const label = `${taskType}: ${successesForType}/${taskResults.length} (${rate}%) avg reward: ${avgRewardForType}`;
      console.log(chalk.bold.white('║') + ` ${label}`.padEnd(58) + chalk.bold.white('║'));
    }
    if (avgResolutionRate !== null && targetObservedRate !== null && followUpPendingRate !== null) {
      console.log(chalk.bold.white('╠' + '═'.repeat(58) + '╣'));
      console.log(chalk.bold.white('║') + chalk.bold.white(' MULTISTEP'.padEnd(58)) + chalk.bold.white('║'));
      console.log(chalk.bold.white('╠' + '═'.repeat(58) + '╣'));
      console.log(chalk.bold.white('║') + ` Avg clue completion: ${avgResolutionRate}`.padEnd(58) + chalk.bold.white('║'));
      console.log(chalk.bold.white('║') + ` Ended awaiting follow-up: ${followUpPendingRate}%`.padEnd(58) + chalk.bold.white('║'));
      console.log(chalk.bold.white('║') + ` Target field observed: ${targetObservedRate}%`.padEnd(58) + chalk.bold.white('║'));
    }
    console.log(chalk.bold.white('╚' + '═'.repeat(58) + '╝'));
  }
}

function formatPhase(phase: ProgressPhase): string {
  switch (phase) {
    case 'DIRECT':
      return 'direct';
    case 'RESOLVING':
      return 'resolving';
    case 'AWAITING_FOLLOW_UP':
      return 'awaiting follow-up';
    case 'RETRIEVED':
      return 'retrieved';
  }
}
