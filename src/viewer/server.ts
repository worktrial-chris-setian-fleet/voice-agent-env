import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../policy/store.js';
import type { Experiment, RunManifest, RunSummary, StoredEpisodeTrajectory } from '../policy/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const DEFAULT_PORT = 4173;
const REFRESH_MS = 3000;

interface RunListEntry {
  experimentId: string;
  runId: string;
  createdAt: string;
  runType: string;
  scenarioSet: string;
  episodeCount: number;
  policyId: string;
  summary: RunSummary | null;
}

function json(response: import('node:http').ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload)}\n`);
}

function text(response: import('node:http').ServerResponse, statusCode: number, payload: string): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(payload);
}

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return [];
    throw error;
  }
}

async function listRuns(experimentId?: string): Promise<RunListEntry[]> {
  await store.ensureArtifactsLayout();
  const experimentIds = experimentId ? [experimentId] : await store.listExperimentIds();
  const runs: RunListEntry[] = [];

  for (const expId of experimentIds) {
    const runDir = store.getRunsDir(expId);
    let entries: Array<{ name: string }> = [];
    try {
      const dirEntries = await readdir(runDir, { withFileTypes: true });
      entries = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name }));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      const manifest = await safeReadJson<RunManifest>(store.getRunManifestFile(expId, entry.name));
      if (!manifest) continue;
      const summary = await safeReadJson<RunSummary>(store.getRunSummaryFile(expId, entry.name));
      runs.push({
        experimentId: expId,
        runId: manifest.runId,
        createdAt: manifest.createdAt,
        runType: manifest.runType,
        scenarioSet: manifest.scenarioSet,
        episodeCount: manifest.episodeCount,
        policyId: manifest.policyId,
        summary,
      });
    }
  }

  runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return runs;
}

async function listExperiments(): Promise<Array<Experiment & { runCount: number }>> {
  await store.ensureArtifactsLayout();
  const experimentIds = await store.listExperimentIds();
  const result: Array<Experiment & { runCount: number }> = [];

  for (const experimentId of experimentIds) {
    const experiment = await store.readExperiment(experimentId);
    if (!experiment) continue;

    let runCount = 0;
    try {
      const entries = await readdir(store.getRunsDir(experimentId), { withFileTypes: true });
      runCount = entries.filter((entry) => entry.isDirectory()).length;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw error;
    }

    result.push({ ...experiment, runCount });
  }

  result.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return result;
}

async function getRunDetail(experimentId: string, runId: string): Promise<{
  manifest: RunManifest | null;
  summary: RunSummary | null;
  trajectories: StoredEpisodeTrajectory[];
}> {
  const manifest = await safeReadJson<RunManifest>(store.getRunManifestFile(experimentId, runId));
  const summary = await safeReadJson<RunSummary>(store.getRunSummaryFile(experimentId, runId));
  const trajectories = await readJsonl<StoredEpisodeTrajectory>(store.getRunTrajectoriesFile(experimentId, runId));

  trajectories.sort((left, right) => left.episodeIndex - right.episodeIndex);

  return { manifest, summary, trajectories };
}

async function serveStatic(response: import('node:http').ServerResponse, fileName: string): Promise<void> {
  const resolved = path.normalize(path.join(publicDir, fileName));
  if (!resolved.startsWith(publicDir)) {
    text(response, 403, 'Forbidden');
    return;
  }

  let contentType = 'text/plain; charset=utf-8';
  if (resolved.endsWith('.html')) contentType = 'text/html; charset=utf-8';
  if (resolved.endsWith('.css')) contentType = 'text/css; charset=utf-8';
  if (resolved.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';

  try {
    const file = await readFile(resolved);
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.end(file);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      text(response, 404, 'Not found');
      return;
    }
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      text(response, 400, 'Missing URL');
      return;
    }

    const url = new URL(request.url, 'http://localhost');

    if (url.pathname === '/api/meta') {
      json(response, 200, {
        refreshMs: REFRESH_MS,
        artifactsDir: store.getArtifactsDir(),
      });
      return;
    }

    if (url.pathname === '/api/experiments') {
      const experiments = await listExperiments();
      json(response, 200, { experiments });
      return;
    }

    if (url.pathname === '/api/runs') {
      const experimentId = url.searchParams.get('experimentId') ?? undefined;
      const limitParam = Number(url.searchParams.get('limit') ?? 50);
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
      const runs = await listRuns(experimentId);
      json(response, 200, { runs: runs.slice(0, limit) });
      return;
    }

    if (url.pathname === '/api/run') {
      const experimentId = url.searchParams.get('experimentId');
      const runId = url.searchParams.get('runId');
      if (!experimentId || !runId) {
        json(response, 400, { error: 'Missing experimentId or runId query param' });
        return;
      }
      const detail = await getRunDetail(experimentId, runId);
      if (!detail.manifest) {
        json(response, 404, { error: 'Run not found' });
        return;
      }
      json(response, 200, detail);
      return;
    }

    if (url.pathname === '/') {
      await serveStatic(response, 'index.html');
      return;
    }

    if (url.pathname === '/styles.css') {
      await serveStatic(response, 'styles.css');
      return;
    }

    if (url.pathname === '/app.js') {
      await serveStatic(response, 'app.js');
      return;
    }

    text(response, 404, 'Not found');
  } catch (error) {
    console.error(error);
    json(response, 500, { error: 'Internal server error' });
  }
});

const portFromEnv = Number(process.env.VIEWER_PORT ?? process.env.PORT ?? DEFAULT_PORT);
const port = Number.isFinite(portFromEnv) ? portFromEnv : DEFAULT_PORT;

server.listen(port, () => {
  console.log(`Viewer running on http://localhost:${port}`);
});
