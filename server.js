import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 10000);
const root = path.dirname(fileURLToPath(import.meta.url));
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } })
  : null;

const jobs = new Map();
const stageBlueprint = [
  { id: 'script', label: 'Script', detail: 'Gemini creates three cinematic scenes' },
  { id: 'images', label: 'Images', detail: 'Flux generates vertical black & white frames' },
  { id: 'voice', label: 'Voice', detail: 'ElevenLabs renders narration per scene' },
  { id: 'clips', label: 'Motion', detail: 'FFmpeg adds a subtle camera move' },
  { id: 'assemble', label: 'Assemble', detail: 'Audio and video are joined per scene' },
  { id: 'caption', label: 'Captions', detail: 'Words are burned into the final cut' }
];

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public')));

function id() { return crypto.randomUUID(); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function makeScenes(idea) {
  return [
    { number: 1, title: 'Start before you feel ready', narration: 'Success is not born from inspiration. It is built in the quiet decision to show up.', imagePrompt: `A solitary person at the edge of a deserted running track before sunrise, wide cinematic frame, long shadows, determined posture, documentary texture, vertical composition, Black & White`, accent: '#d4f56a' },
    { number: 2, title: 'Let discipline carry you', narration: 'Motivation fades. The promise you keep to yourself is what keeps the work moving.', imagePrompt: `One person lifting a heavy barbell in a dim industrial gym, mid-shot, stark side light, honest sweat and effort, deep shadows, vertical composition, Black & White`, accent: '#f3a87c' },
    { number: 3, title: 'Keep the promise', narration: `You do not need a perfect day. You only need to take the next step, again and again.`, imagePrompt: `A lone runner crossing an empty park path at dawn, wide shot, mist between trees, restrained motion blur, raw cinematic realism, vertical composition, Black & White`, accent: '#a9d7ff' }
  ].map(scene => ({ ...scene, sourceIdea: idea, status: 'queued', imageUrl: null, audioUrl: null, videoUrl: null }));
}

function publicJob(job) {
  return { ...job, stages: job.stages.map(stage => ({ ...stage })) };
}

async function persistJob(job) {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS video_jobs (id text primary key, payload jsonb not null, created_at timestamptz default now())`);
  await pool.query(`INSERT INTO video_jobs (id, payload) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`, [job.id, job]);
}

async function runPipeline(job) {
  const demoMode = !process.env.N8N_WEBHOOK_URL;
  for (const stage of job.stages) {
    stage.status = 'running';
    job.currentStage = stage.id;
    await persistJob(job);
    await wait(demoMode ? 650 : 250);
    stage.status = 'complete';
    stage.completedAt = new Date().toISOString();
    if (stage.id === 'script') job.scenes = makeScenes(job.idea);
    if (stage.id === 'images') job.scenes.forEach(scene => { scene.imageUrl = `https://images.unsplash.com/photo-${['1517836357463-d25dfeac3438', '1534438327276-14e5300c3a48', '1552674605-db6ffd4facb5']}?auto=format&fit=crop&w=900&q=80`; });
    if (stage.id === 'voice') job.scenes.forEach(scene => { scene.audioUrl = `demo://voice/${job.id}/${scene.number}`; });
    if (stage.id === 'clips') job.scenes.forEach(scene => { scene.videoUrl = `demo://clip/${job.id}/${scene.number}`; });
    if (stage.id === 'caption') job.outputUrl = demoMode ? null : `${process.env.PUBLIC_URL || ''}/api/jobs/${job.id}/output`;
    await persistJob(job);
  }
  job.status = 'complete';
  job.currentStage = null;
  job.completedAt = new Date().toISOString();
  await persistJob(job);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, database: Boolean(pool), mode: process.env.N8N_WEBHOOK_URL ? 'n8n' : 'demo' }));
app.get('/api/jobs', (_req, res) => res.json([...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob)));
app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(publicJob(job));
});
app.post('/api/jobs', async (req, res) => {
  const idea = String(req.body?.idea || '').trim();
  if (!idea) return res.status(400).json({ error: 'An idea is required' });
  const job = { id: id(), idea, status: 'running', currentStage: 'script', createdAt: new Date().toISOString(), completedAt: null, outputUrl: null, scenes: [], stages: stageBlueprint.map(stage => ({ ...stage, status: 'queued', completedAt: null })) };
  jobs.set(job.id, job);
  await persistJob(job);
  runPipeline(job).catch(error => { job.status = 'failed'; job.error = error.message; persistJob(job); });
  return res.status(202).json(publicJob(job));
});

app.get('*', (_req, res) => res.sendFile(path.join(root, 'index.html')));
app.listen(port, () => console.log(`Frameforge listening on port ${port}`));