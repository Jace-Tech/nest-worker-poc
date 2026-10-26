'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DURATION_SECONDS_MAX,
  DURATION_SECONDS_MIN,
  JITTER_PERCENT_MAX,
  JITTER_PERCENT_MIN,
  JOB_COUNT_MAX,
  JOB_COUNT_MIN,
  type CreateJobsResponse,
  type StatsResponse,
} from '@queue-lab/shared';

const POLL_MS = 2000;

type Status = 'STANDBY' | 'ENGAGING' | 'RUNNING' | 'COMPLETE' | 'FAULT';

export default function Console() {
  const [count, setCount] = useState('5000');
  const [durationSeconds, setDurationSeconds] = useState('2');
  const [jitterPercent, setJitterPercent] = useState('0');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<CreateJobsResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);

  const [clock, setClock] = useState('--:--:--');
  const [rate, setRate] = useState(0);
  const lastSampleRef = useRef<{ done: number; t: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // live mission clock
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchStats = useCallback(async (batchId?: string) => {
    try {
      const url = batchId
        ? `/api/stats?batchId=${encodeURIComponent(batchId)}`
        : '/api/stats';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      setStats((await res.json()) as StatsResponse);
    } catch {
      /* transient; next tick retries */
    }
  }, []);

  // Always poll. Queue depth streams even while idle; add batch progress once engaged.
  useEffect(() => {
    const poll = () => void fetchStats(batch?.batchId);
    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return stopPolling;
  }, [batch, fetchStats, stopPolling]);

  // derive throughput (jobs/s) from successive samples, lightly smoothed
  useEffect(() => {
    const b = stats?.batch;
    if (!b) {
      lastSampleRef.current = null;
      setRate(0);
      return;
    }
    const now = Date.now();
    const done = b.done;
    const last = lastSampleRef.current;
    if (last && now > last.t && done >= last.done) {
      const inst = (done - last.done) / ((now - last.t) / 1000);
      setRate((prev) => (prev === 0 ? inst : prev * 0.55 + inst * 0.45));
    }
    lastSampleRef.current = { done, t: now };
  }, [stats]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStats(null);
    setBatch(null);
    setRate(0);
    stopPolling();
    setSubmitting(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          count: Number(count),
          durationSeconds: Number(durationSeconds),
          jitterPercent: Number(jitterPercent),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Request rejected');
        return;
      }
      setBatch(data as CreateJobsResponse);
    } catch {
      setError('No link to control server.');
    } finally {
      setSubmitting(false);
    }
  }

  const pct = stats?.batch?.percentComplete ?? 0;
  const duplicates = stats?.batch?.duplicates ?? 0;
  const done = stats?.batch?.done ?? 0;
  const total = stats?.batch?.total ?? batch?.count ?? null;
  const remaining = total !== null ? Math.max(0, total - done) : null;
  const complete = batch !== null && pct >= 100;

  const status: Status = useMemo(() => {
    if (error) return 'FAULT';
    if (submitting) return 'ENGAGING';
    if (complete) return 'COMPLETE';
    if (batch) return 'RUNNING';
    return 'STANDBY';
  }, [error, submitting, complete, batch]);

  const eta =
    remaining !== null && rate > 0.01 && !complete ? remaining / rate : null;

  return (
    <div className="min-h-screen">
      <TopBar clock={clock} status={status} duplicates={batch ? duplicates : null} />

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:px-6">
        {/* ---- CONTROL ---- */}
        <section className="bezel brackets animate-boot p-5" style={{ animationDelay: '60ms' }}>
          <PanelHeader index="01" title="Launch Parameters" accent="amber" />
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <InputModule
              label="Job Count"
              unit="jobs"
              value={count}
              onChange={setCount}
              min={JOB_COUNT_MIN}
              max={JOB_COUNT_MAX}
              step={1}
            />
            <InputModule
              label="Duration / Job"
              unit="sec"
              value={durationSeconds}
              onChange={setDurationSeconds}
              min={DURATION_SECONDS_MIN}
              max={DURATION_SECONDS_MAX}
              step={0.1}
            />
            <InputModule
              label="Jitter"
              unit="%"
              value={jitterPercent}
              onChange={setJitterPercent}
              min={JITTER_PERCENT_MIN}
              max={JITTER_PERCENT_MAX}
              step={1}
            />

            <button
              type="submit"
              disabled={submitting}
              className="group relative mt-2 w-full overflow-hidden rounded-sm border border-amber/60 bg-amber/10 px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.25em] text-amber transition hover:bg-amber hover:text-console hover:shadow-glow-amber disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="relative z-10">
                {submitting ? '◆ Engaging…' : '▶ Engage Queue'}
              </span>
            </button>

            {error && (
              <div className="brackets relative flex items-start gap-2 rounded-sm border border-alert/50 bg-alert/10 px-3 py-2">
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-alert text-alert animate-led" />
                <p className="font-mono text-xs leading-relaxed text-alert">{error}</p>
              </div>
            )}
          </form>

          <div className="mt-6 border-t border-line pt-4">
            <div className="label mb-2">Runtime Config</div>
            <dl className="space-y-1.5 font-mono text-[11px]">
              <ConfigRow k="QUEUE" v="bull:load-test" />
              <ConfigRow k="ATTEMPTS" v="3 · exp backoff 2s" />
              <ConfigRow k="JOB_ID" v="batchId_index" />
              <ConfigRow k="POLL" v={`${POLL_MS / 1000}s`} />
            </dl>
          </div>
        </section>

        {/* ---- TELEMETRY ---- */}
        <section className="bezel brackets animate-boot relative overflow-hidden p-5" style={{ animationDelay: '140ms' }}>
          <div className="sweep-line" />
          <div className="flex items-center justify-between">
            <PanelHeader index="02" title="Telemetry" accent="phosphor" />
            {batch ? (
              <code className="truncate rounded-sm border border-line bg-panel-inset px-2 py-1 font-mono text-[10px] text-grid-500">
                BATCH {batch.batchId.slice(0, 8)}
              </code>
            ) : (
              <span className="label text-grid-500">No Active Batch</span>
            )}
          </div>

          <div className="mt-5 grid items-center gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
            <Gauge pct={pct} complete={complete} idle={!batch} />

            <div className="space-y-3">
              <ProgressBar pct={pct} done={done} total={total} complete={complete} />
              <div className="grid grid-cols-3 gap-2.5">
                <Readout label="Done" value={fmt(done)} accent="phosphor" />
                <Readout label="Remaining" value={remaining === null ? '—' : fmt(remaining)} />
                <Readout
                  label="Throughput"
                  value={batch && rate > 0.01 ? rate.toFixed(1) : '—'}
                  suffix={batch && rate > 0.01 ? '/s' : undefined}
                  accent="info"
                />
                <Readout label="ETA" value={fmtEta(eta, complete)} />
                <Readout
                  label="Target"
                  value={batch ? `${batch.durationMs / 1000}s` : '—'}
                />
                <Readout
                  label="Jitter"
                  value={batch ? `${batch.jitterPercent}%` : '—'}
                />
              </div>
            </div>
          </div>

          {/* queue state strip */}
          <div className="mt-6">
            <div className="label mb-2">Queue States · live</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <StateTile label="Waiting" value={stats?.queue.waiting} accent="amber" />
              <StateTile label="Active" value={stats?.queue.active} accent="info" live={!!stats?.queue.active} />
              <StateTile label="Delayed" value={stats?.queue.delayed} />
              <StateTile label="Completed" value={stats?.queue.completed} accent="phosphor" />
              <StateTile label="Failed" value={stats?.queue.failed} accent="alert" alarm={!!stats?.queue.failed} />
            </div>
          </div>

          {/* duplicate monitor */}
          <DuplicateMonitor duplicates={batch ? duplicates : null} />
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-2 lg:px-6">
        <p className="font-mono text-[10px] tracking-wide text-grid-500">
          QUEUE//LAB · BullMQ is at-least-once — a rare duplicate after a hard pod kill is
          expected; the DUP monitor exists to measure it.
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TopBar({
  clock,
  status,
  duplicates,
}: {
  clock: string;
  status: Status;
  duplicates: number | null;
}) {
  const map: Record<Status, { color: string; glow: string; text: string }> = {
    STANDBY: { color: 'text-amber', glow: 'text-glow-amber', text: 'STANDBY' },
    ENGAGING: { color: 'text-amber', glow: 'text-glow-amber', text: 'ENGAGING' },
    RUNNING: { color: 'text-phosphor', glow: 'text-glow-phosphor', text: 'RUNNING' },
    COMPLETE: { color: 'text-phosphor', glow: 'text-glow-phosphor', text: 'COMPLETE' },
    FAULT: { color: 'text-alert', glow: 'text-glow-alert', text: 'FAULT' },
  };
  const s = map[status];
  const pulsing = status === 'RUNNING' || status === 'ENGAGING';

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-console/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="leading-none">
            <div className="animate-flicker font-display text-base font-bold tracking-[0.18em] text-grid-100">
              QUEUE<span className="text-amber">{'//'}</span>LAB
            </div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.3em] text-grid-500">
              LOAD-TEST CONTROL
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {duplicates !== null && (
            <Pill
              label="DUP"
              value={String(duplicates)}
              tone={duplicates > 0 ? 'alert' : 'phosphor'}
            />
          )}
          <div className="hidden items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 sm:flex">
            <span className="label text-grid-500">UPLINK</span>
            <span className="h-1.5 w-1.5 rounded-full bg-phosphor text-phosphor animate-led" />
          </div>
          <div className={`flex items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 ${s.color}`}>
            <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulsing ? 'animate-led' : ''}`} />
            <span className={`font-display text-[11px] font-semibold tracking-[0.2em] ${s.glow}`}>
              {s.text}
            </span>
          </div>
          <code className="hidden rounded-sm border border-line bg-panel-inset px-2.5 py-1.5 font-mono text-xs tabular-nums text-grid-300 md:block">
            {clock}
          </code>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden className="shrink-0">
      <path d="M16 2 28 9v14L16 30 4 23V9z" stroke="#ffb000" strokeWidth="1.2" opacity="0.8" />
      <path d="M16 9 22 12.5v7L16 23l-6-3.5v-7z" stroke="#44d492" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="2" fill="#ffb000" />
      <path d="M16 2v7M16 23v7M4 9l6 3.5M22 19.5 28 23M28 9l-6 3.5M10 19.5 4 23" stroke="#1a2430" strokeWidth="1" />
    </svg>
  );
}

function PanelHeader({
  index,
  title,
  accent,
}: {
  index: string;
  title: string;
  accent: 'amber' | 'phosphor';
}) {
  const dot = accent === 'amber' ? 'bg-amber text-amber' : 'bg-phosphor text-phosphor';
  return (
    <div className="flex items-center gap-2.5">
      <span className={`h-2 w-2 rounded-full ${dot} animate-led`} />
      <span className="font-mono text-[11px] text-grid-500">{index}</span>
      <h2 className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-grid-100">
        {title}
      </h2>
      <span className="ml-1 h-px flex-1 bg-gradient-to-r from-line to-transparent" />
    </div>
  );
}

function InputModule({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-[10px] text-grid-500">
          {min}–{max.toLocaleString()}
        </span>
      </div>
      <div className="group relative flex items-center rounded-sm border border-line bg-panel-inset focus-within:border-amber/60 focus-within:shadow-glow-amber">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="readout w-full bg-transparent px-3 py-2.5 text-lg text-grid-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="shrink-0 border-l border-line px-3 font-mono text-[11px] uppercase tracking-wider text-grid-500">
          {unit}
        </span>
      </div>
    </label>
  );
}

function ConfigRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-grid-500">{k}</dt>
      <dd className="truncate text-grid-300">{v}</dd>
    </div>
  );
}

function Gauge({ pct, complete, idle }: { pct: number; complete: boolean; idle: boolean }) {
  const r = 84;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = c * (1 - clamped / 100);
  const stroke = idle ? '#2b3a4a' : complete ? '#44d492' : '#ffb000';
  const ticks = Array.from({ length: 48 });

  return (
    <div className="relative mx-auto h-[200px] w-[200px]">
      <svg viewBox="0 0 220 220" className="h-full w-full -rotate-90">
        <circle cx="110" cy="110" r={r} fill="none" stroke="#141c26" strokeWidth="10" />
        <circle
          cx="110"
          cy="110"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.2,0.7,0.2,1), stroke 0.3s',
            filter: idle ? 'none' : `drop-shadow(0 0 6px ${stroke}aa)`,
          }}
        />
      </svg>
      {/* tick ring (upright) */}
      <svg viewBox="0 0 220 220" className="absolute inset-0 h-full w-full">
        {ticks.map((_, i) => {
          const major = i % 4 === 0;
          return (
            <line
              key={i}
              x1="110"
              y1="10"
              x2="110"
              y2={major ? 22 : 17}
              transform={`rotate(${i * (360 / ticks.length)} 110 110)`}
              stroke={major ? '#2b3a4a' : '#182230'}
              strokeWidth={major ? 1.4 : 1}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className={`readout text-4xl font-bold ${
            idle ? 'text-grid-500' : complete ? 'text-phosphor text-glow-phosphor' : 'text-amber text-glow-amber'
          }`}
        >
          {idle ? '--' : Math.round(clamped)}
          <span className="text-xl">{idle ? '' : '%'}</span>
        </div>
        <div className="label mt-1">{idle ? 'Standby' : complete ? 'Complete' : 'Draining'}</div>
      </div>
    </div>
  );
}

function ProgressBar({
  pct,
  done,
  total,
  complete,
}: {
  pct: number;
  done: number;
  total: number | null;
  complete: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between font-mono text-[11px]">
        <span className="text-grid-300">
          {fmt(done)}
          {total !== null ? <span className="text-grid-500"> / {fmt(total)}</span> : ''}
        </span>
        <span className={complete ? 'text-phosphor' : 'text-amber'}>{Math.round(pct)}%</span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-sm border border-line bg-panel-inset">
        <div
          className="h-full rounded-sm transition-[width] duration-500"
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: complete
              ? 'linear-gradient(90deg,#2a9e6b,#44d492)'
              : 'linear-gradient(90deg,#b67e00,#ffb000)',
            boxShadow: `0 0 12px -2px ${complete ? '#44d492' : '#ffb000'}`,
          }}
        />
      </div>
    </div>
  );
}

function Readout({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  accent?: 'phosphor' | 'info' | 'amber';
}) {
  const color =
    accent === 'phosphor'
      ? 'text-phosphor'
      : accent === 'info'
        ? 'text-info'
        : accent === 'amber'
          ? 'text-amber'
          : 'text-grid-100';
  return (
    <div className="rounded-sm border border-line bg-panel-inset px-2.5 py-2">
      <div className="label mb-1 text-[9px]">{label}</div>
      <div className={`readout text-base ${color}`}>
        {value}
        {suffix && <span className="ml-0.5 text-[11px] text-grid-500">{suffix}</span>}
      </div>
    </div>
  );
}

function StateTile({
  label,
  value,
  accent,
  live,
  alarm,
}: {
  label: string;
  value?: number;
  accent?: 'amber' | 'phosphor' | 'info' | 'alert';
  live?: boolean;
  alarm?: boolean;
}) {
  const color =
    accent === 'amber'
      ? 'text-amber'
      : accent === 'phosphor'
        ? 'text-phosphor'
        : accent === 'info'
          ? 'text-info'
          : accent === 'alert'
            ? 'text-alert'
            : 'text-grid-300';
  return (
    <div
      className={`relative rounded-sm border bg-panel-inset px-3 py-2.5 ${
        alarm ? 'border-alert/50' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full bg-current ${color} ${live || alarm ? 'animate-led' : 'opacity-40'}`}
        />
        <span className="label text-[9px]">{label}</span>
      </div>
      <div className={`readout mt-1.5 text-xl ${value ? color : 'text-grid-500'}`}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function DuplicateMonitor({ duplicates }: { duplicates: number | null }) {
  const anomaly = (duplicates ?? 0) > 0;
  const idle = duplicates === null;
  return (
    <div
      className={`brackets relative mt-6 flex items-center justify-between overflow-hidden rounded-sm border px-4 py-3.5 ${
        anomaly ? 'border-alert/60 bg-alert/10' : 'border-line bg-panel-inset'
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`h-3 w-3 rounded-full ${
            anomaly ? 'bg-alert text-alert animate-blink' : idle ? 'bg-grid-500' : 'bg-phosphor text-phosphor animate-led'
          }`}
        />
        <div>
          <div className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-grid-100">
            Duplicate Monitor
          </div>
          <div className="font-mono text-[10px] text-grid-500">
            jobs processed more than once
          </div>
        </div>
      </div>
      <div className="text-right">
        <div
          className={`readout text-3xl font-bold ${
            anomaly ? 'text-alert text-glow-alert' : idle ? 'text-grid-500' : 'text-phosphor'
          }`}
        >
          {idle ? '—' : duplicates}
        </div>
        <div className={`label text-[9px] ${anomaly ? 'text-alert' : ''}`}>
          {idle ? 'Awaiting' : anomaly ? 'Anomaly' : 'Nominal'}
        </div>
      </div>
    </div>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'alert' | 'phosphor';
}) {
  const c = tone === 'alert' ? 'text-alert border-alert/50' : 'text-phosphor border-line';
  return (
    <div className={`flex items-center gap-1.5 rounded-sm border bg-panel px-2 py-1.5 ${c}`}>
      <span className="label text-[9px] text-grid-500">{label}</span>
      <span className="readout text-xs">{value}</span>
    </div>
  );
}

/* ------- format helpers ------- */
function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
function fmtEta(sec: number | null, complete: boolean): string {
  if (complete) return '00:00';
  if (sec === null || !Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
