import * as store from '../policy/store.js';
import { buildStoredTrajectory, deriveRunSummary } from '../policy/metrics.js';
import type { RunManifest, RunSummary, StoredEpisodeTrajectory } from '../policy/types.js';
import type { EpisodeResult } from '../env/types.js';

export interface PersistedRunArtifacts {
  manifest: RunManifest;
  summary: RunSummary;
  trajectories: StoredEpisodeTrajectory[];
  manifestPath: string;
  summaryPath: string;
  trajectoriesPath: string;
}

export async function persistRunArtifacts(input: {
  manifest: RunManifest;
  results: EpisodeResult[];
}): Promise<PersistedRunArtifacts> {
  const { manifest, results } = input;
  const trajectories = results.map((result) => buildStoredTrajectory({ manifest, result }));
  const summary = deriveRunSummary(manifest, trajectories);

  await store.writeRunManifest(manifest);
  for (const trajectory of trajectories) {
    await store.appendTrajectory(manifest.experimentId, manifest.runId, trajectory);
  }
  await store.writeRunSummary(summary);

  return {
    manifest,
    summary,
    trajectories,
    manifestPath: store.getRunManifestFile(manifest.experimentId, manifest.runId),
    summaryPath: store.getRunSummaryFile(manifest.experimentId, manifest.runId),
    trajectoriesPath: store.getRunTrajectoriesFile(manifest.experimentId, manifest.runId),
  };
}
