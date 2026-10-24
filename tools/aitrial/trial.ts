// AI trial: a weaker AI model gets the app's own prompt ("Copy prompt") and a design request, as a
// user would paste it into a chat. Its code goes through what the app does with pasted code:
// OpenSCAD in the app's WASM build, the problem list (diagnose, lint, the checks of the rendered
// model), and while there are problems the "Copy for AI" text goes back into the same chat (a few
// rounds). An independent printability check (a `scadcheck` command, when installed) judges every
// rendered round, to show what the app misses, and the last code goes through "Convert to sketches".
// Everything lands in OUT, with results.json; tools/browser/aitrial-sheet.mjs makes contact sheets.

import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { aiPrompt, codeFromChat, looksLikeScad } from '../../src/aiprompt';
import { scadToDoc, type ConvertEngine } from '../../src/convert/scad2doc';
import { diagnose, meshProblems, problemsForAi, type Problem } from '../../src/diagnose';
import { setLang } from '../../src/i18n';
import { parseBinaryStl } from '../../src/stl';

setLang('en');
const ROOT = process.env.ROOT!, OUT = process.env.OUT!, WORKER = process.env.WORKER!;
const MODEL = process.env.MODEL ?? 'haiku';
const ROUNDS = Number(process.env.ROUNDS ?? 3); // answers to problems after the first
const PARALLEL = Number(process.env.PARALLEL ?? 4);
const VERSION = 'OpenSCAD 2026.10.15';
const requests: string[] = JSON.parse(readFileSync(`${ROOT}/tools/aitrial/requests.json`, 'utf8'));
const pick = process.argv.slice(2).map(Number); // 1-based numbers of the requests to run (all without)

interface RenderOut { rc: number; log: string[]; data: Uint8Array | null; timeout?: boolean }
function render(src: string, out: string, args: string[] = [], ms = 90_000): Promise<RenderOut> {
  return new Promise(resolve => {
    const w = new Worker(WORKER, { workerData: { root: ROOT, src, out, args } });
    const timer = setTimeout(() => { void w.terminate(); resolve({ rc: -1, log: ['TIMEOUT'], data: null, timeout: true }); }, ms);
    w.once('message', (m: RenderOut) => { clearTimeout(timer); void w.terminate(); resolve(m); });
    w.once('error', e => { clearTimeout(timer); resolve({ rc: -1, log: [String(e)], data: null }); });
  });
}

// A plain chat: no tools, none of the server's own instructions (safe mode), an empty folder.
const SYSTEM = 'You are a helpful assistant in a chat app. Answer the user directly in text. You cannot run code, use tools or see files.';
const NO_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'NotebookEdit', 'TodoWrite', 'Skill'];
const CHAT_DIR = `${OUT}/chat`;
function ask(session: string, text: string, first: boolean): Promise<{ reply: string; cost: number; error?: string }> {
  return new Promise(resolve => {
    const args = ['-p', '--model', MODEL, '--safe-mode', '--system-prompt', SYSTEM, '--output-format', 'json',
      ...(first ? ['--session-id', session] : ['--resume', session]), '--disallowedTools', ...NO_TOOLS];
    const p = spawn('claude', args, { cwd: CHAT_DIR });
    let out = '', err = '';
    const timer = setTimeout(() => p.kill(), 300_000);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        resolve({ reply: String(j.result ?? ''), cost: Number(j.total_cost_usd ?? 0), error: j.is_error ? String(j.result) : undefined });
      } catch {
        resolve({ reply: '', cost: 0, error: (err || out).slice(0, 500) || 'no answer' });
      }
    });
    p.stdin.end(text);
  });
}

/** An independent printability check of model.stl in `dir`, if one is installed as `scadcheck` (optional). */
const scadcheck = (dir: string) => new Promise<string>(resolve =>
  execFile('scadcheck', [], { cwd: dir, timeout: 120_000 }, (e, stdout, stderr) =>
    resolve((e as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? '' : String(stdout) + String(stderr))));
/** A PNG of the code (native OpenSCAD, for looking at the result). */
const picture = (dir: string, file: string) => new Promise<void>(resolve =>
  execFile('openscad', ['--render', '--backend=manifold', '--autocenter', '--viewall', '--imgsize=900,700', '--colorscheme=Tomorrow', '-o', `${dir}/${file}.png`, `${dir}/${file}.scad`],
    { timeout: 120_000 }, () => resolve()));

const engine: ConvertEngine = {
  csg: async src => { const r = await render(src, '/out.csg'); if (!r.data) throw new Error(r.log.slice(-3).join(' ')); return new TextDecoder().decode(r.data); },
  svg: async src => { const r = await render(src, '/out.svg'); if (!r.data) throw new Error(r.log.slice(-3).join(' ')); return new TextDecoder().decode(r.data); },
};

const brief = (p: Problem) => ({ severity: p.severity, line: p.line, check: !!p.check, mesh: !!p.mesh, count: p.count, message: p.message.slice(0, 200), hint: p.hint?.slice(0, 300) ?? null });
/** scadcheck's "To fix:" line and the headings of what it found. */
function judge(text: string) {
  const fix = /^To fix: (.*)$/m.exec(text)?.[1] ?? '';
  // Headings with a finding (not "…: none." or "… (fine up to …)").
  const found = text.split('\n').filter(l => /^(Starts in mid-air|Flat ceilings|Overhangs|Small overhangs|Thin parts|Size |Mesh|On the plate)/.test(l) && !/: none|fine up to|fits the|closed solid|rests on the plate/.test(l)).map(l => l.slice(0, 70));
  return { fix, found };
}

async function trial(n: number) {
  const request = requests[n - 1];
  const slug = request.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const dir = `${OUT}/${String(n).padStart(2, '0')}-${slug}`;
  mkdirSync(dir, { recursive: true });
  const session = randomUUID();
  let text = aiPrompt({ version: VERSION, bed: { w: 180, d: 180, h: 180 }, printer: 'Bambu Lab A1 mini' }) + request;
  const rounds: object[] = [];
  let cost = 0, last: string | null = null, clean = false;
  for (let r = 0; r <= ROUNDS; r++) {
    writeFileSync(`${dir}/r${r}-ask.txt`, text);
    const a = await ask(session, text, r === 0);
    cost += a.cost;
    writeFileSync(`${dir}/r${r}-reply.md`, a.reply || `ERROR: ${a.error}`);
    if (a.error || !a.reply) { rounds.push({ round: r, error: a.error ?? 'empty reply' }); break; }
    const code = codeFromChat(a.reply);
    if (!looksLikeScad(code)) {
      rounds.push({ round: r, noCode: true });
      text = 'Please answer with the complete .scad file in a single code block.';
      continue;
    }
    writeFileSync(`${dir}/r${r}.scad`, code);
    last = `r${r}`;
    const t0 = performance.now();
    const res = await render(code, '/out.stl', ['--export-format=binstl', '--backend=manifold']);
    const renderMs = Math.round(performance.now() - t0);
    writeFileSync(`${dir}/r${r}.log`, res.log.join('\n'));
    const mesh = res.data && res.data.length > 84 ? parseBinaryStl(res.data.slice().buffer) : null;
    const problems = [...diagnose(res.log, code), ...(mesh ? meshProblems(mesh.positions) : [])];
    const counted = problems.filter(p => !p.followUp && p.severity !== 'note');
    let checked = null;
    if (mesh) {
      const rd = `${dir}/r${r}-check`;
      mkdirSync(rd, { recursive: true });
      writeFileSync(`${rd}/model.stl`, res.data!);
      const out = await scadcheck(rd);
      writeFileSync(`${rd}/scadcheck.txt`, out);
      checked = judge(out);
    }
    rounds.push({ round: r, rendered: !!mesh, timeout: !!res.timeout, renderMs, triangles: mesh?.triangles ?? 0, problems: problems.map(brief), counted: counted.length, scadcheck: checked });
    if (mesh && !counted.length) { clean = true; break; }
    if (r === ROUNDS) break;
    text = problemsForAi(problems, code, VERSION);
  }
  // The last code: a picture, and Convert to sketches.
  let convert: object | null = null;
  if (last) {
    await picture(dir, last);
    const src = readFileSync(`${dir}/${last}.scad`, 'utf8');
    try {
      const r = await Promise.race([scadToDoc(src, engine), new Promise<never>((_, no) => setTimeout(() => no(new Error('convert timeout')), 240_000))]);
      convert = { sketches: r.sketches, extrudes: r.extrudes, revolves: r.revolves, codeBlocks: r.codeBlocks, params: r.params, linked: r.linked };
    } catch (e) {
      convert = { error: String(e).slice(0, 300) };
    }
  }
  const result = { n, request, session, clean, rounds: rounds.length, cost: Math.round(cost * 10000) / 10000, last, convert, detail: rounds };
  writeFileSync(`${dir}/result.json`, JSON.stringify(result, null, 2));
  console.log(`${String(n).padStart(2)} ${clean ? 'clean' : 'NOT clean'} after ${rounds.length} round(s), $${result.cost}: ${request}`);
  return result;
}

mkdirSync(CHAT_DIR, { recursive: true });
const todo = pick.length ? pick : requests.map((_, i) => i + 1);
const results: object[] = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, async () => {
  while (next < todo.length) {
    const n = todo[next++];
    try { results.push(await trial(n)); } catch (e) { console.log(`${n} FAILED: ${String(e).slice(0, 300)}`); }
  }
}));
writeFileSync(`${OUT}/results.json`, JSON.stringify(results.sort((a, b) => (a as { n: number }).n - (b as { n: number }).n), null, 2));
console.log(`done: ${results.length} designs, $${results.reduce((s, r) => s + (r as { cost: number }).cost, 0).toFixed(2)}`);
