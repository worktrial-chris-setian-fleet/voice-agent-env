import chalk from 'chalk';
import type { AgentAction } from '../agent/types.js';
import type { CallerBehaviorLabel, ProgressPhase, StepResult, EpisodeResult, ScenarioSpec, TaskType } from '../env/types.js';

export class Logger {
  private lastLoggedTurn: number | null = null;

  episodeStart(index: number, spec: ScenarioSpec): void {
    this.lastLoggedTurn = null;
    console.log('');
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log(chalk.bold.white(`  EPISODE ${index + 1} — ${spec.brief.type}`));
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log(chalk.bold.white('Task:'), spec.brief.instructions);
    console.log(chalk.bold.white('Field:'), spec.brief.targetField);
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
    console.log(chalk.yellow(`  VOICE AGENT: ${result.observation.lastResponse}`));

    if (result.callerBehaviorEvaluation?.applicable && result.callerBehaviorEvaluation.label) {
      const detail = result.callerBehaviorEvaluation.reason
        ? `: ${result.callerBehaviorEvaluation.reason}`
        : '';
      console.log(chalk.blue(`  Caller Eval: ${formatCallerBehaviorLabel(result.callerBehaviorEvaluation.label)}${detail}`));
    }

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

    if (result.invalidActionReason) {
      const reason = result.invalidActionReason.replace(/_/g, ' ').toLowerCase();
      console.log(chalk.red(`  Invalid: ${reason}`));
    }

    if (result.reward !== 0 || result.rewardEvents.length > 0) {
      const rewardSign = result.reward >= 0 ? '+' : '';
      const rewardColor = result.reward > 0
        ? chalk.green
        : result.reward < 0
          ? chalk.red
          : chalk.yellow;
      const componentMath = result.stepRewardBreakdown
        .map(({ amount }) => `${amount >= 0 ? '+' : ''}${amount}`)
        .join(' ');
      const rewardDetails = result.stepRewardBreakdown
        .map(({ event, amount }) => `${event}:${amount >= 0 ? '+' : ''}${amount}`)
        .join(', ');
      const mathPart = componentMath.length > 0 ? ` (${componentMath} => ${rewardSign}${result.reward})` : '';
      console.log(rewardColor(`  Reward: ${rewardSign}${result.reward}${mathPart} [${rewardDetails}]`));
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
    console.log(chalk.bold.white('│') + ` Task Type:    ${result.spec.brief.type}`.padEnd(58) + chalk.bold.white('│'));
    console.log(chalk.bold.white('│') + ` Field:        ${result.spec.brief.targetField}`.padEnd(58) + chalk.bold.white('│'));
    console.log(chalk.bold.white('│') + ` Turns:        ${result.turnCount}`.padEnd(58) + chalk.bold.white('│'));
    const submitted = result.submittedAnswer === null
      ? '(none)'
      : `${result.submittedField ?? '(unknown field)'} = ${result.submittedAnswer}`;
    console.log(chalk.bold.white('│') + ` Answer:       ${submitted}`.padEnd(58) + chalk.bold.white('│'));
    console.log(chalk.bold.white('│') + ` Target:       ${result.spec.targetValue}`.padEnd(58) + chalk.bold.white('│'));
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
    if (result.callerBehaviorMetrics.ambiguousTurns > 0) {
      console.log(
        chalk.bold.white('│') +
        ` Good Qs:      ${result.callerBehaviorMetrics.goodDisambiguationQuestions}/${result.callerBehaviorMetrics.ambiguousTurns}`.padEnd(58) +
        chalk.bold.white('│')
      );
      console.log(
        chalk.bold.white('│') +
        ` Premature:    ${result.callerBehaviorMetrics.prematureTargetRequests}`.padEnd(58) +
        chalk.bold.white('│')
      );
      console.log(
        chalk.bold.white('│') +
        ` Redundant:    ${result.callerBehaviorMetrics.redundantClarifications}`.padEnd(58) +
        chalk.bold.white('│')
      );
      if (result.callerBehaviorMetrics.turnsToResolution !== null) {
        console.log(
          chalk.bold.white('│') +
          ` Resolved In:  ${result.callerBehaviorMetrics.turnsToResolution} turns`.padEnd(58) +
          chalk.bold.white('│')
        );
      }
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
      const existing = grouped.get(result.spec.brief.type) ?? [];
      existing.push(result);
      grouped.set(result.spec.brief.type, existing);
    }

    const multistep = results.filter(r => r.spec.brief.type === 'RESOLVE_THEN_RETRIEVE');
    const ambiguous = results.filter(r =>
      r.spec.brief.type === 'DISAMBIGUATION' || r.spec.brief.type === 'RESOLVE_THEN_RETRIEVE'
    );
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
    const ambiguousTurns = ambiguous.reduce((sum, result) => sum + result.callerBehaviorMetrics.ambiguousTurns, 0);
    const goodQuestionRate = ambiguousTurns > 0
      ? (ambiguous.reduce((sum, result) => sum + result.callerBehaviorMetrics.goodDisambiguationQuestions, 0) / ambiguousTurns * 100).toFixed(1)
      : null;
    const prematureRate = ambiguousTurns > 0
      ? (ambiguous.reduce((sum, result) => sum + result.callerBehaviorMetrics.prematureTargetRequests, 0) / ambiguousTurns * 100).toFixed(1)
      : null;
    const avgTurnsToResolution = ambiguous.length > 0
      ? (() => {
          const resolved = ambiguous.filter((result) => result.callerBehaviorMetrics.turnsToResolution !== null);
          if (resolved.length === 0) return null;
          return (
            resolved.reduce((sum, result) => sum + (result.callerBehaviorMetrics.turnsToResolution ?? 0), 0) / resolved.length
          ).toFixed(2);
        })()
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
    if (goodQuestionRate !== null && prematureRate !== null) {
      console.log(chalk.bold.white('╠' + '═'.repeat(58) + '╣'));
      console.log(chalk.bold.white('║') + chalk.bold.white(' CALLER BEHAVIOR'.padEnd(58)) + chalk.bold.white('║'));
      console.log(chalk.bold.white('╠' + '═'.repeat(58) + '╣'));
      console.log(chalk.bold.white('║') + ` Good disambiguation rate: ${goodQuestionRate}%`.padEnd(58) + chalk.bold.white('║'));
      console.log(chalk.bold.white('║') + ` Premature target rate: ${prematureRate}%`.padEnd(58) + chalk.bold.white('║'));
      if (avgTurnsToResolution !== null) {
        console.log(chalk.bold.white('║') + ` Avg turns to resolution: ${avgTurnsToResolution}`.padEnd(58) + chalk.bold.white('║'));
      }
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

function formatCallerBehaviorLabel(label: CallerBehaviorLabel): string {
  switch (label) {
    case 'GOOD_DISAMBIGUATION_QUESTION':
      return 'good disambiguation question';
    case 'PREMATURE_TARGET_REQUEST':
      return 'premature target request';
    case 'REDUNDANT_DISAMBIGUATION':
      return 'redundant clarification';
    default:
      return label.toLowerCase();
  }
}
