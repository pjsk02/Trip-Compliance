/**
 * NegotiationView — live SSE transcript of the orchestration pipeline.
 * Opens an EventSource to /groups/:code/stream-generate and renders each
 * event as a chat bubble. On 'done' shows a "View itinerary" button.
 * Wrapped in the existing ItineraryErrorBoundary pattern.
 */
import { useEffect, useRef, useState, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getToken, BASE_URL } from '../api/client';
import { Spinner } from '../components/Spinner';

// ---------------------------------------------------------------------------
// Event types (mirror backend streamEvents.ts)
// ---------------------------------------------------------------------------

type AgentName = 'activity' | 'food' | 'accommodation' | 'transportation' | 'budget' | 'orchestrator';

type StreamEvent =
  | { type: 'agent_started';       agent: AgentName }
  | { type: 'agent_proposal';      agent: AgentName; statement: string; keyNumbers: Record<string, number | string> }
  | { type: 'pushback';            fromAgent: AgentName; againstAgent: AgentName; statement: string }
  | { type: 'resolution_proposed'; statement: string }
  | { type: 'round_completed';     roundNumber: number; conflictsResolved: number; remaining: number }
  | { type: 'orchestrator_decision'; statement: string; dimensionScores: DimensionScores; consensusStatus: string }
  | { type: 'done';                itineraryId: string; version: number }
  | { type: 'agent_error';         agent: AgentName; message: string };

interface DimensionScores {
  satisfaction: number;
  fairness:     number;
  budget:       number;
  feasibility:  number;
  diversity:    number;
}

// ---------------------------------------------------------------------------
// Transcript entry union (what we render)
// ---------------------------------------------------------------------------

type Entry =
  | { id: string; kind: 'wave_divider';   label: string }
  | { id: string; kind: 'round_divider';  roundNumber: number; resolved: number; remaining: number }
  | { id: string; kind: 'thinking';       agents: AgentName[] }
  | { id: string; kind: 'bubble';         agent: AgentName; bubbleType: 'proposal' | 'pushback' | 'resolution' | 'decision' | 'error'; statement: string; keyNumbers?: Record<string, number | string> }
  | { id: string; kind: 'scores';         scores: DimensionScores; consensusStatus: string };

// ---------------------------------------------------------------------------
// Agent config
// ---------------------------------------------------------------------------

const AGENT_CONFIG: Record<AgentName, { label: string; color: string; bg: string; icon: string }> = {
  activity:       { label: 'Activity Agent',       color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100', icon: '🎯' },
  food:           { label: 'Food Agent',            color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-100',     icon: '🍽' },
  accommodation:  { label: 'Accommodation Agent',   color: 'text-violet-700',  bg: 'bg-violet-50 border-violet-100',   icon: '🏨' },
  transportation: { label: 'Transportation Agent',  color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-100',       icon: '✈️' },
  budget:         { label: 'Budget Agent',          color: 'text-rose-700',    bg: 'bg-rose-50 border-rose-100',       icon: '💰' },
  orchestrator:   { label: 'Orchestrator',          color: 'text-indigo-700',  bg: 'bg-indigo-50 border-indigo-100',   icon: '🔮' },
};

const DIMENSION_LABELS = ['satisfaction', 'fairness', 'budget', 'feasibility', 'diversity'] as const;
const DIMENSION_COLORS: Record<typeof DIMENSION_LABELS[number], string> = {
  satisfaction: 'bg-emerald-500',
  fairness:     'bg-blue-500',
  budget:       'bg-amber-500',
  feasibility:  'bg-violet-500',
  diversity:    'bg-pink-500',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgentAvatar({ agent, size = 'md' }: { agent: AgentName; size?: 'sm' | 'md' }) {
  const cfg = AGENT_CONFIG[agent];
  const dim = size === 'sm' ? 'h-7 w-7 text-sm' : 'h-9 w-9 text-base';
  return (
    <div className={`${dim} shrink-0 flex items-center justify-center rounded-full border ${cfg.bg} ${cfg.color} font-bold`}>
      {cfg.icon}
    </div>
  );
}

function ThinkingRow({ agents }: { agents: AgentName[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {agents.map(agent => {
        const cfg = AGENT_CONFIG[agent];
        return (
          <div key={agent} className="flex items-center gap-2">
            <AgentAvatar agent={agent} size="sm" />
            <div className="flex items-center gap-1">
              <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
              <span className="flex gap-0.5">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.color.replace('text-', 'bg-')} animate-bounce`}
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Bubble({ entry }: { entry: Extract<Entry, { kind: 'bubble' }> }) {
  const cfg = AGENT_CONFIG[entry.agent];
  const isPushback   = entry.bubbleType === 'pushback';
  const isResolution = entry.bubbleType === 'resolution';
  const isDecision   = entry.bubbleType === 'decision';
  const isError      = entry.bubbleType === 'error';

  let borderClass = `border ${cfg.bg}`;
  if (isPushback)   borderClass = 'border border-red-200 bg-red-50';
  if (isResolution) borderClass = 'border border-emerald-200 bg-emerald-50';
  if (isError)      borderClass = 'border border-amber-200 bg-amber-50';

  const tag = isPushback   ? { label: 'PUSHBACK',   cls: 'bg-red-100 text-red-700' }
            : isResolution ? { label: 'RESOLUTION',  cls: 'bg-emerald-100 text-emerald-700' }
            : isDecision   ? { label: 'DECISION',    cls: 'bg-indigo-100 text-indigo-700' }
            : isError      ? { label: 'FALLBACK',    cls: 'bg-amber-100 text-amber-700' }
            : null;

  return (
    <div className="flex gap-3">
      <AgentAvatar agent={entry.agent} />
      <div className={`flex-1 rounded-2xl px-4 py-3 ${borderClass}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-xs font-semibold ${isError ? 'text-amber-700' : cfg.color}`}>
            {cfg.label}
          </span>
          {tag && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tag.cls}`}>
              {tag.label}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">{entry.statement}</p>
        {entry.keyNumbers && Object.keys(entry.keyNumbers).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(entry.keyNumbers).map(([k, v]) => (
              <span key={k} className="rounded-lg bg-white/80 border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                {k.replace(/([A-Z])/g, ' $1').toLowerCase()}: <span className="font-bold text-gray-900">{v}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RoundDivider({ entry }: { entry: Extract<Entry, { kind: 'round_divider' }> }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-gray-200" />
      <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Round {entry.roundNumber}</span>
        {entry.remaining === 0 && (
          <span className="text-[10px] text-emerald-600 font-semibold">✓ resolved</span>
        )}
        {entry.remaining > 0 && (
          <span className="text-[10px] text-amber-600 font-semibold">{entry.remaining} remaining</span>
        )}
      </div>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

function WaveDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-indigo-100" />
      <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-px bg-indigo-100" />
    </div>
  );
}

function ScoreBar({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-baseline">
        <span className="text-xs font-medium text-gray-600 capitalize">{label}</span>
        <span className="text-xs font-bold text-gray-900">{value}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${colorClass}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ScoresCard({ scores, consensusStatus }: { scores: DimensionScores; consensusStatus: string }) {
  const isOK = consensusStatus === 'OK';
  return (
    <div className="rounded-2xl border border-indigo-100 bg-white shadow-sm px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Dimension Scores</p>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          isOK ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {isOK ? 'Consensus ✓' : 'Admin review needed'}
        </span>
      </div>
      {DIMENSION_LABELS.map(dim => (
        <ScoreBar key={dim} label={dim} value={scores[dim]} colorClass={DIMENSION_COLORS[dim]} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error boundary (same pattern as ItineraryView)
// ---------------------------------------------------------------------------

class NegotiationErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[NegotiationView] Render error:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
          <div className="rounded-2xl border border-red-100 bg-white shadow-sm px-6 py-6 max-w-sm w-full space-y-3">
            <p className="text-base font-semibold text-red-600">Something went wrong</p>
            <p className="text-xs text-gray-500 font-mono break-all">{this.state.error.message}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Main negotiation view
// ---------------------------------------------------------------------------

function NegotiationViewInner() {
  const { code }               = useParams<{ code: string }>();
  const [searchParams]         = useSearchParams();
  const { session }            = useAuth();
  const navigate               = useNavigate();

  const tripDuration = parseInt(searchParams.get('tripDuration') ?? '3', 10);

  const [entries,      setEntries]      = useState<Entry[]>([]);
  const [thinking,     setThinking]     = useState<AgentName[]>([]);
  const [status,       setStatus]       = useState<'connecting' | 'running' | 'done' | 'error'>('connecting');
  const [errorMsg,     setErrorMsg]     = useState('');
  const [doneVersion,  setDoneVersion]  = useState<number | null>(null);
  const [connectionOk, setConnectionOk] = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const eventRef   = useRef<EventSource | null>(null);
  const entryIdRef = useRef(0);
  const statusRef  = useRef<'connecting' | 'running' | 'done' | 'error'>('connecting');

  function nextId() { return String(++entryIdRef.current); }

  // Keep statusRef in sync so SSE error handler can read latest value without closure staleness
  useEffect(() => { statusRef.current = status; }, [status]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, thinking]);

  // Open SSE connection on mount
  useEffect(() => {
    if (!code || !session) return;

    const token = getToken();
    if (!token) {
      setStatus('error');
      setErrorMsg('Not authenticated — please go back and rejoin the group.');
      return;
    }

    const url = new URL(`${BASE_URL}/groups/${code}/stream-generate`);
    url.searchParams.set('tripDuration',         String(tripDuration));
    url.searchParams.set('maxNegotiationRounds', '3');
    url.searchParams.set('token',                token);

    const es = new EventSource(url.toString());
    eventRef.current = es;
    setStatus('running');
    setConnectionOk(true);

    // Add opening divider
    setEntries([{ id: nextId(), kind: 'wave_divider', label: 'Wave 1 · Agent proposals' }]);

    es.onmessage = (e: MessageEvent) => {
      let event: StreamEvent;
      try { event = JSON.parse(e.data) as StreamEvent; }
      catch { return; }

      setEntries(prev => {
        const next = [...prev];

        switch (event.type) {
          case 'agent_started':
            setThinking(t => [...t, event.agent]);
            break;

          case 'agent_proposal':
            setThinking(t => t.filter(a => a !== event.agent));
            next.push({
              id: nextId(), kind: 'bubble', agent: event.agent,
              bubbleType: 'proposal', statement: event.statement, keyNumbers: event.keyNumbers,
            });
            // Add negotiation divider after budget proposal
            if (event.agent === 'budget') {
              next.push({ id: nextId(), kind: 'wave_divider', label: 'Wave 3 · Negotiation' });
            }
            break;

          case 'pushback':
            next.push({
              id: nextId(), kind: 'bubble', agent: event.fromAgent,
              bubbleType: 'pushback', statement: event.statement,
            });
            break;

          case 'resolution_proposed':
            next.push({
              id: nextId(), kind: 'bubble', agent: 'orchestrator',
              bubbleType: 'resolution', statement: event.statement,
            });
            break;

          case 'round_completed':
            next.push({
              id: nextId(), kind: 'round_divider',
              roundNumber: event.roundNumber, resolved: event.conflictsResolved, remaining: event.remaining,
            });
            break;

          case 'orchestrator_decision':
            next.push({ id: nextId(), kind: 'wave_divider', label: 'Orchestrator · Decision' });
            next.push({
              id: nextId(), kind: 'bubble', agent: 'orchestrator',
              bubbleType: 'decision', statement: event.statement,
            });
            next.push({
              id: nextId(), kind: 'scores',
              scores: event.dimensionScores, consensusStatus: event.consensusStatus,
            });
            break;

          case 'agent_error':
            next.push({
              id: nextId(), kind: 'bubble', agent: event.agent,
              bubbleType: 'error', statement: `⚠ ${event.message}`,
            });
            break;

          case 'done':
            setStatus('done');
            setDoneVersion(event.version);
            setThinking([]);
            break;
        }

        return next;
      });
    };

    // Track whether we've already tried a reconnect so we don't loop.
    let reconnectAttempted = false;

    es.onerror = () => {
      // If we're done, the server closed the connection cleanly — not an error.
      if (statusRef.current === 'done') { es.close(); return; }

      // EventSource automatically retries on transient errors. We give it one
      // retry window (3s) before surfacing a UI error, in case the connection
      // momentarily drops but recovers.
      if (!reconnectAttempted) {
        reconnectAttempted = true;
        setTimeout(() => {
          if (statusRef.current === 'done' || statusRef.current === 'running') return; // recovered
          setErrorMsg('Connection lost — generation may still complete in the background. Check the itinerary page.');
          setStatus('error');
        }, 3000);
      } else {
        // Repeated failure — give up.
        es.close();
        if (statusRef.current !== 'done') {
          setErrorMsg('Connection lost — generation may still complete in the background. Check the itinerary page.');
          setStatus('error');
        }
      }
    };

    return () => { es.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // run once on mount — intentional

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur-sm shrink-0">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <button
            onClick={() => navigate(`/group/${code}`)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600">
              <span className="text-white text-xs">🔮</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">AI Negotiation</span>
          </div>
          <div className="flex items-center gap-1.5">
            {status === 'running' && (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-medium text-emerald-600">Live</span>
              </>
            )}
            {status === 'done' && (
              <span className="text-xs font-medium text-indigo-600">Done</span>
            )}
            {status === 'error' && (
              <span className="text-xs font-medium text-red-500">Disconnected</span>
            )}
            {status === 'connecting' && (
              <span className="text-xs font-medium text-gray-400">Connecting…</span>
            )}
          </div>
        </div>
      </header>

      {/* Intro card */}
      {connectionOk && (
        <div className="mx-auto w-full max-w-2xl px-4 pt-5">
          <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 text-white">
            <p className="text-sm font-bold">Planning your trip ✨</p>
            <p className="text-xs text-indigo-100 mt-0.5">
              {tripDuration} nights · Agents are negotiating the best plan for your group.
              This takes 30–90 seconds.
            </p>
          </div>
        </div>
      )}

      {/* Transcript */}
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-5 space-y-4 overflow-y-auto">
        {status === 'connecting' && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Spinner className="h-8 w-8" />
            <p className="text-sm text-gray-400">Connecting to planning pipeline…</p>
          </div>
        )}

        {entries.map(entry => {
          if (entry.kind === 'wave_divider')  return <WaveDivider  key={entry.id} label={entry.label} />;
          if (entry.kind === 'round_divider') return <RoundDivider key={entry.id} entry={entry} />;
          if (entry.kind === 'bubble')        return <Bubble       key={entry.id} entry={entry} />;
          if (entry.kind === 'scores')        return <ScoresCard   key={entry.id} scores={entry.scores} consensusStatus={entry.consensusStatus} />;
          return null;
        })}

        {/* Live thinking indicators */}
        {thinking.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 py-4">
            <ThinkingRow agents={thinking} />
          </div>
        )}

        {/* Error banner (inline, doesn't hide transcript) */}
        {status === 'error' && (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <span className="text-lg shrink-0">⚡</span>
            <div>
              <p className="text-xs font-semibold text-amber-800">Connection ended</p>
              <p className="text-xs text-amber-700 mt-0.5">{errorMsg || 'Stream ended unexpectedly.'}</p>
              <button
                onClick={() => navigate(`/group/${code}/itinerary`)}
                className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                Check itinerary page →
              </button>
            </div>
          </div>
        )}

        {/* Done CTA */}
        {status === 'done' && doneVersion !== null && (
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 px-5 py-5 text-center space-y-3">
            <p className="text-base font-bold text-indigo-900">🎉 Plan ready!</p>
            <p className="text-xs text-indigo-700">Version {doneVersion} saved — tap below to explore your trip.</p>
            <button
              onClick={() => navigate(`/group/${code}/itinerary`)}
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 transition-colors"
            >
              View itinerary →
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}

export function NegotiationView() {
  return (
    <NegotiationErrorBoundary>
      <NegotiationViewInner />
    </NegotiationErrorBoundary>
  );
}
