// Benchmark ("Benchmark" button): the examples are rendered three times each, then the frame rate.

import { t } from '../i18n';
import { isDevHost, remoteLog } from '../remote';
import { logProblems, type RenderResult } from '../scad';
import { parseBinaryStl, type Mesh } from '../stl';
import { $, fmtInt, fmtMs } from './dom';
import { EXAMPLES, engine, isRendering, requestRender, setStatus, view, viewer } from './render';

const TIMEOUT_MS = 120_000;

interface BenchRun { model: string; run: number; initMs: number; renderMs: number; parseMs: number; triangles: number }

export async function runBench() {
  if (engine.busy || isRendering()) return;
  const btn = $<HTMLButtonElement>('#btnBench'), btnRender = $<HTMLButtonElement>('#btnRender');
  btn.disabled = btnRender.disabled = true;
  const body = $('#benchBody'), summary = $('#benchSummary');
  body.replaceChildren();
  summary.textContent = '';
  $<HTMLDialogElement>('#benchDlg').showModal();
  const nav = navigator as Navigator & { deviceMemory?: number };
  const report = {
    when: new Date().toISOString(),
    ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    memGB: nav.deviceMemory ?? null,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}`,
    engineLoadMs: null as number | null,
    runs: [] as BenchRun[],
    fps: null as null | { fps: number; worstMs: number },
  };
  $('#benchInfo').textContent = t('bench.info', { cores: report.cores, mem: report.memGB ?? '?', screen: report.screen });
  const row = (cells: string[]) => {
    const tr = document.createElement('tr');
    for (const c of cells) tr.appendChild(Object.assign(document.createElement('td'), { textContent: c }));
    body.appendChild(tr);
    tr.scrollIntoView({ block: 'nearest' });
  };
  remoteLog('bench-start', { cores: report.cores, memGB: report.memGB, screen: report.screen });
  try {
    setStatus(t('bench.running'), 'busy');
    await engine.render('cube(1);', 'binstl', undefined, TIMEOUT_MS); // makes sure the engine is loaded
    report.engineLoadMs = engine.loadMs;
    row([t('bench.loadEngine'), '', fmtMs(engine.loadMs ?? 0), '']);
    let last: Mesh | null = null;
    for (const ex of EXAMPLES) {
      for (let i = 0; i < 3; i++) {
        remoteLog('bench-run', { model: ex.id, run: i });
        const r: RenderResult = await engine.render(ex.src, 'binstl', undefined, TIMEOUT_MS);
        const t0 = performance.now();
        last = r.data ? parseBinaryStl(r.data) : null;
        const run = { model: ex.id, run: i, initMs: r.initMs, renderMs: r.renderMs, parseMs: performance.now() - t0, triangles: last?.triangles ?? 0 };
        report.runs.push(run);
        remoteLog('bench-done', { ...run, ok: r.ok, problems: r.ok ? undefined : logProblems(r.log).slice(0, 5) });
        row([t(ex.name).replace(/^[^:]+: /, ''), String(i + 1), r.ok ? fmtMs(r.renderMs) : t('bench.fail'), fmtInt(run.triangles)]);
      }
      if (ex.id === 'heavy' && last) {
        viewer.setSketchLines([]);
        viewer.setMesh(last);
        viewer.setView('iso');
        summary.textContent = t('bench.measuringFps');
        report.fps = await viewer.measureFps(3000);
        remoteLog('bench-fps', report.fps);
        row([t('bench.fps'), '', `${Math.round(report.fps.fps)} fps`, t('bench.worst', { time: fmtMs(report.fps.worstMs) })]);
      }
    }
    if (__DEV_TOOLS__ && isDevHost) {
      summary.textContent = t('bench.sending');
      const res = await fetch('api/bench', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
      summary.textContent = res.ok ? t('bench.saved') : t('bench.serverSaid', { status: res.status });
    } else summary.textContent = '';
    setStatus(t('bench.done'));
  } catch (e) {
    remoteLog('bench-failed', { err: String(e), runs: report.runs.length });
    summary.textContent = `${t('bench.aborted')}: ${e}`;
    setStatus(t('bench.aborted'), 'error');
  } finally {
    btn.disabled = btnRender.disabled = false;
    view.fitNext = true;
    requestRender();
  }
}
