import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BudgetProposalCard } from '../components/BudgetProposalCard';
import { Spinner } from '../components/Spinner';
import type { BudgetStateResponse, BudgetRound, VoteChoice } from '../types';

// ---------------------------------------------------------------------------
// Past round summary (collapsed)
// ---------------------------------------------------------------------------

function PastRoundSummary({ round }: { round: BudgetRound }) {
  const approveCount = round.votes.filter(v => v.choice === 'APPROVE').length;
  const rejectCount  = round.votes.filter(v => v.choice === 'REJECT').length;
  const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-500">
            {round.roundNum}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Round {round.roundNum} — {fmt(round.proposed)}</p>
            <p className="text-xs text-gray-400">{approveCount} approved · {rejectCount} rejected</p>
          </div>
        </div>
        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[10px] font-medium text-red-600 ring-1 ring-red-200">
          No consensus
        </span>
      </div>
      {/* Rejection comments — anonymised */}
      {round.votes.filter(v => v.choice === 'REJECT' && v.comment).length > 0 && (
        <div className="mt-3 space-y-1 border-t border-gray-50 pt-3">
          {round.votes
            .filter(v => v.choice === 'REJECT' && v.comment)
            .map(v => (
              <p key={v.id} className="text-xs text-gray-500 italic">
                "{v.comment}"
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function BudgetNegotiation() {
  const { code } = useParams<{ code: string }>();
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  const [state, setState]         = useState<BudgetStateResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  const [allVoted, setAllVoted]   = useState(false);
  const [consensus, setConsensus] = useState(false);
  const [, setApproveCount] = useState(0);

  const [analyzeLoading,   setAnalyzeLoading]   = useState(false);
  const [votingLoading,    setVotingLoading]     = useState(false);
  const [repropopeLoading, setRepropopeLoading] = useState(false);
  const [lockLoading,      setLockLoading]       = useState(false);
  const [actionError,      setActionError]       = useState('');

  // Retroactive budget entry state
  const [myBudgetInput,   setMyBudgetInput]   = useState('');
  const [budgetSaving,    setBudgetSaving]     = useState(false);
  const [budgetSaved,     setBudgetSaved]      = useState(false);
  const [budgetError,     setBudgetError]      = useState('');

  const fetchState = useCallback(async () => {
    if (!code) return;
    try {
      const s = await api.getBudgetState(code);
      setState(s);
      // Derive vote state from the current round
      if (s.currentRound) {
        const votes        = s.currentRound.votes;
        const allV         = votes.length === s.totalMembers;
        const approve      = votes.filter(v => v.choice === 'APPROVE').length;
        setAllVoted(allV);
        setConsensus(allV && approve === s.totalMembers);
        setApproveCount(approve);
      }
      // If already locked, redirect back to dashboard
      if (s.lockedBudget !== null) {
        navigate(`/group/${code}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); navigate('/'); }
      else setError('Could not load budget state.');
    } finally {
      setLoading(false);
    }
  }, [code, logout, navigate]);

  useEffect(() => {
    if (!session) { navigate('/'); return; }
    fetchState();
    const interval = setInterval(fetchState, 8_000);
    return () => clearInterval(interval);
  }, [session, fetchState, navigate]);

  async function handleSubmitBudget() {
    if (!session || !myBudgetInput) return;
    const amount = Number(myBudgetInput);
    if (!amount || amount <= 0) { setBudgetError('Enter a valid positive amount.'); return; }
    setBudgetSaving(true);
    setBudgetError('');
    try {
      await api.submitMemberBudget(session.memberId, amount);
      setBudgetSaved(true);
      setMyBudgetInput('');
      await fetchState(); // refresh membersWithoutBudget
    } catch (err) {
      setBudgetError(err instanceof ApiError ? err.message : 'Could not save budget.');
    } finally {
      setBudgetSaving(false);
    }
  }

  async function handleAnalyze() {
    if (!code) return;
    setAnalyzeLoading(true);
    setActionError('');
    try {
      const { round } = await api.analyzeBudget(code);
      setState(prev => prev ? {
        ...prev,
        rounds:       [...prev.rounds, round],
        currentRound: round,
      } : null);
      setAllVoted(false);
      setConsensus(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Analysis failed');
    } finally {
      setAnalyzeLoading(false);
    }
  }

  async function handleVote(choice: VoteChoice, comment?: string) {
    if (!code) return;
    setVotingLoading(true);
    setActionError('');
    try {
      const res = await api.voteBudget(code, choice, comment);
      setState(prev => prev ? {
        ...prev,
        currentRound: res.round,
        rounds: prev.rounds.map(r => r.id === res.round.id ? res.round : r),
      } : null);
      setAllVoted(res.allVoted);
      setConsensus(res.consensus);
      setApproveCount(res.approveCount);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Vote failed');
    } finally {
      setVotingLoading(false);
    }
  }

  async function handleRepropose() {
    if (!code) return;
    setRepropopeLoading(true);
    setActionError('');
    try {
      const { round } = await api.reproposeBudget(code);
      setState(prev => prev ? {
        ...prev,
        rounds:       [...prev.rounds, round],
        currentRound: round,
      } : null);
      setAllVoted(false);
      setConsensus(false);
      setApproveCount(0);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Re-proposal failed');
    } finally {
      setRepropopeLoading(false);
    }
  }

  async function handleLock() {
    if (!code) return;
    setLockLoading(true);
    setActionError('');
    try {
      await api.lockBudget(code);
      navigate(`/group/${code}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Lock failed');
    } finally {
      setLockLoading(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <p className="text-sm text-red-600">{error || 'Could not load budget state.'}</p>
        <button
          onClick={() => navigate(`/group/${code}`)}
          className="text-sm text-indigo-600 underline"
        >
          Back to group
        </button>
      </div>
    );
  }

  const pastRounds             = state.rounds.slice(0, -1); // all except the last
  const currentRound           = state.currentRound;
  const isAdmin                = session?.isAdmin ?? false;
  const myMemberId             = session?.memberId ?? '';
  const membersWithoutBudget   = state.membersWithoutBudget ?? [];
  const allBudgetsIn           = membersWithoutBudget.length === 0;
  const iNeedBudget            = membersWithoutBudget.some(m => m.id === myMemberId) && !budgetSaved;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate(`/group/${code}`)}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">Budget Negotiation</p>
            <p className="text-xs text-gray-400">Round {state.rounds.length} of negotiation</p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
            {state.totalMembers} members
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 space-y-4">
        {/* Action error */}
        {actionError && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{actionError}</div>
        )}

        {/* Retroactive budget entry — shown to any member who is missing their budget */}
        {iNeedBudget && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-xl leading-none mt-0.5">💰</span>
              <div>
                <p className="text-sm font-semibold text-amber-900">Your trip budget is needed</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  Budget negotiation can't start until every member has submitted a private budget.
                  Enter yours below — it's never shown to other members.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  min={1}
                  placeholder="Your total trip budget (USD)"
                  value={myBudgetInput}
                  onChange={e => { setMyBudgetInput(e.target.value); setBudgetError(''); }}
                  className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <button
                type="button"
                onClick={handleSubmitBudget}
                disabled={budgetSaving || !myBudgetInput}
                className="shrink-0 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition disabled:opacity-50"
              >
                {budgetSaving ? '…' : 'Submit'}
              </button>
            </div>
            {budgetError && <p className="text-xs text-red-600">{budgetError}</p>}
            {budgetSaved && <p className="text-xs text-emerald-700 font-medium">Budget saved!</p>}
          </div>
        )}

        {/* Members still missing budgets — names only, shown while any are pending */}
        {!currentRound && !allBudgetsIn && membersWithoutBudget.some(m => m.id !== myMemberId) && (
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-600">Waiting for budgets from:</p>
            <div className="flex flex-wrap gap-1.5">
              {membersWithoutBudget.filter(m => m.id !== myMemberId).map(m => (
                <span key={m.id} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                  {m.name}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-gray-400">Budget amounts are private — only the planner can see them.</p>
          </div>
        )}

        {/* No proposal yet — admin sees the trigger button */}
        {!currentRound && (
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 px-5 py-6 space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-2xl">
              💰
            </div>
            <div>
              <h2 className="text-base font-bold text-indigo-900">Budget Bot is ready</h2>
              <p className="mt-1 text-sm text-indigo-700">
                The Budget Bot will analyse the group's budgets and propose a fair group total —
                without revealing anyone's private number.
              </p>
            </div>
            {isAdmin ? (
              <>
                {!allBudgetsIn && (
                  <p className="text-xs text-amber-700 font-medium">
                    Waiting on {membersWithoutBudget.length} member{membersWithoutBudget.length !== 1 ? 's' : ''} to submit their budget before analysis can run.
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzeLoading || !allBudgetsIn}
                  className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {analyzeLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Analysing budgets…
                    </span>
                  ) : allBudgetsIn ? 'Run budget analysis →' : 'Waiting for all budgets…'}
                </button>
              </>
            ) : (
              <p className="text-sm text-indigo-600">
                {allBudgetsIn
                  ? 'Waiting for the organizer to start the analysis…'
                  : 'Waiting for all members to submit their budget…'}
              </p>
            )}
          </div>
        )}

        {/* Past rounds (collapsed) */}
        {pastRounds.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-1">
              Previous rounds
            </p>
            {pastRounds.map(r => <PastRoundSummary key={r.id} round={r} />)}
          </div>
        )}

        {/* Current round proposal card */}
        {currentRound && (
          <BudgetProposalCard
            round={currentRound}
            totalMembers={state.totalMembers}
            myMemberId={myMemberId}
            isAdmin={isAdmin}
            onVote={handleVote}
            onRepropose={handleRepropose}
            onLock={handleLock}
            votingLoading={votingLoading}
            repropopeLoading={repropopeLoading}
            lockLoading={lockLoading}
            allVoted={allVoted}
            consensus={consensus}
          />
        )}

        {/* Privacy notice */}
        <div className="rounded-xl bg-gray-100 px-4 py-3 text-xs text-gray-500 space-y-0.5">
          <p className="font-medium text-gray-700">🔒 Privacy protected</p>
          <p>
            Individual budgets are never shared with other members. The Budget Bot only shows
            aggregate statistics (median, range) and its proposal.
          </p>
        </div>
      </main>
    </div>
  );
}
