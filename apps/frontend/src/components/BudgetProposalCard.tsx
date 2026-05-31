import { useState } from 'react';
import type { BudgetRound, BudgetVoteRecord, VoteChoice } from '../types';

interface Props {
  round:        BudgetRound;
  totalMembers: number;
  myMemberId:   string;
  isAdmin:      boolean;
  onVote:       (choice: VoteChoice, comment?: string) => Promise<void>;
  onRepropose:  () => Promise<void>;
  onLock:       () => Promise<void>;
  votingLoading: boolean;
  repropopeLoading: boolean;
  lockLoading:  boolean;
  allVoted:     boolean;
  consensus:    boolean;
}

function fmt(n: number) {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const STRATEGY_LABEL: Record<string, string> = {
  consensus:       '✅ Consensus proposal',
  tiered:          '🔀 Tiered-contribution proposal',
  scope_reduction: '✂️ Scope-adjusted proposal',
};

// ---------------------------------------------------------------------------
// Vote tally bar
// ---------------------------------------------------------------------------

function VoteTally({
  votes,
  totalMembers,
  myMemberId,
}: {
  votes:        BudgetVoteRecord[];
  totalMembers: number;
  myMemberId:   string;
}) {
  const approveCount = votes.filter(v => v.choice === 'APPROVE').length;
  const rejectCount  = votes.filter(v => v.choice === 'REJECT').length;
  const pendingCount = totalMembers - votes.length;
  const myVote       = votes.find(v => v.memberId === myMemberId);

  return (
    <div className="space-y-2">
      {/* Stacked bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="bg-emerald-500 transition-all"
          style={{ width: `${(approveCount / totalMembers) * 100}%` }}
        />
        <div
          className="bg-red-400 transition-all"
          style={{ width: `${(rejectCount / totalMembers) * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="text-emerald-600 font-medium">{approveCount} approve</span>
        <span className="text-gray-400">{pendingCount} waiting</span>
        <span className="text-red-500 font-medium">{rejectCount} reject</span>
      </div>

      {/* Voter chips */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {votes.map(v => (
          <span
            key={v.id}
            title={v.comment ?? undefined}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1
              ${v.choice === 'APPROVE'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-red-50 text-red-700 ring-red-200'
              }`}
          >
            {v.choice === 'APPROVE' ? '✓' : '✕'} {v.name}
            {v.memberId === myMemberId && ' (you)'}
          </span>
        ))}
        {Array.from({ length: pendingCount }).map((_, i) => (
          <span
            key={`pending-${i}`}
            className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-400 ring-1 ring-gray-200"
          >
            ···
          </span>
        ))}
      </div>

      {myVote && (
        <p className="text-[10px] text-gray-400">
          Your vote: <span className={myVote.choice === 'APPROVE' ? 'text-emerald-600' : 'text-red-500'}>{myVote.choice}</span>
          {' '}— you can change it until the round closes.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reject comment modal
// ---------------------------------------------------------------------------

function RejectModal({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: (comment: string) => void;
  onCancel:  () => void;
  loading:   boolean;
}) {
  const [comment, setComment] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">What's your concern?</h3>
        <p className="text-xs text-gray-500">
          Your comment is anonymous to other members — only the Budget Bot reads it to improve its next proposal.
        </p>
        <textarea
          rows={3}
          autoFocus
          className="w-full resize-none rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
          placeholder="e.g. This is too high for me, can we cut the hotel budget?"
          value={comment}
          onChange={e => setComment(e.target.value)}
          maxLength={500}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-xl border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(comment)}
            disabled={loading}
            className="flex-1 rounded-xl bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-600 transition disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export function BudgetProposalCard({
  round,
  totalMembers,
  myMemberId,
  isAdmin,
  onVote,
  onRepropose,
  onLock,
  votingLoading,
  repropopeLoading,
  lockLoading,
  allVoted,
  consensus,
}: Props) {
  const [showRejectModal, setShowRejectModal] = useState(false);

  const myVote       = round.votes.find(v => v.memberId === myMemberId);
  const approveCount = round.votes.filter(v => v.choice === 'APPROVE').length;

  async function handleReject(comment: string) {
    await onVote('REJECT', comment || undefined);
    setShowRejectModal(false);
  }

  return (
    <>
      {showRejectModal && (
        <RejectModal
          onConfirm={handleReject}
          onCancel={() => setShowRejectModal(false)}
          loading={votingLoading}
        />
      )}

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {/* Bot message header */}
        <div className="flex items-start gap-3 bg-indigo-50 border-b border-indigo-100 px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
            💰
          </div>
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-indigo-900">Budget Bot · Round {round.roundNum}</p>
            <p className="text-sm text-indigo-800 leading-relaxed">{round.summary}</p>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Proposed amount */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Proposed group total</p>
              <p className="mt-0.5 text-3xl font-bold text-gray-900 tabular-nums">{fmt(round.proposed)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {fmt(round.perPerson)} per person
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold
              ${round.strategy === 'consensus'       ? 'bg-emerald-100 text-emerald-700' :
                round.strategy === 'tiered'          ? 'bg-blue-100 text-blue-700'       :
                                                       'bg-amber-100 text-amber-700'}`}
            >
              {STRATEGY_LABEL[round.strategy]}
            </span>
          </div>

          {/* Stats (aggregate only) */}
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-3">
            <div className="text-center">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Range low</p>
              <p className="text-sm font-semibold text-gray-700 tabular-nums">{fmt(round.stats.range[0])}</p>
            </div>
            <div className="text-center border-x border-gray-200">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Median</p>
              <p className="text-sm font-semibold text-gray-700 tabular-nums">{fmt(round.stats.median)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Range high</p>
              <p className="text-sm font-semibold text-gray-700 tabular-nums">{fmt(round.stats.range[1])}</p>
            </div>
          </div>

          {/* Rationale */}
          <p className="text-sm text-gray-600 leading-relaxed">{round.rationale}</p>

          {/* Tiered split (if applicable) */}
          {round.tierSplit && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-blue-800">Tiered contribution split</p>
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg bg-white border border-blue-100 p-2.5 text-center">
                  <p className="text-[10px] text-blue-600">{round.tierSplit.highTier.label}</p>
                  <p className="text-base font-bold text-blue-900">{fmt(round.tierSplit.highTier.amount)}</p>
                </div>
                <div className="flex-1 rounded-lg bg-white border border-blue-100 p-2.5 text-center">
                  <p className="text-[10px] text-blue-600">{round.tierSplit.lowTier.label}</p>
                  <p className="text-base font-bold text-blue-900">{fmt(round.tierSplit.lowTier.amount)}</p>
                </div>
              </div>
              <p className="text-[11px] text-blue-700">{round.tierSplit.rationale}</p>
            </div>
          )}

          {/* Vote tally */}
          <VoteTally votes={round.votes} totalMembers={totalMembers} myMemberId={myMemberId} />

          {/* Vote actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onVote('APPROVE')}
              disabled={votingLoading || myVote?.choice === 'APPROVE'}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition
                ${myVote?.choice === 'APPROVE'
                  ? 'bg-emerald-500 text-white cursor-default'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ring-1 ring-emerald-200 disabled:opacity-50'
                }`}
            >
              {myVote?.choice === 'APPROVE' ? '✓ Approved' : '👍 Approve'}
            </button>
            <button
              type="button"
              onClick={() => setShowRejectModal(true)}
              disabled={votingLoading || myVote?.choice === 'REJECT'}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition
                ${myVote?.choice === 'REJECT'
                  ? 'bg-red-500 text-white cursor-default'
                  : 'bg-red-50 text-red-700 hover:bg-red-100 ring-1 ring-red-200 disabled:opacity-50'
                }`}
            >
              {myVote?.choice === 'REJECT' ? '✕ Rejected' : '👎 Push back'}
            </button>
          </div>

          {/* Admin controls — shown after all have voted */}
          {isAdmin && allVoted && (
            <div className="border-t border-gray-100 pt-4 space-y-2">
              {consensus ? (
                <div className="space-y-2">
                  <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm text-emerald-800 font-medium text-center">
                    🎉 Consensus reached! Everyone approved.
                  </div>
                  <button
                    type="button"
                    onClick={onLock}
                    disabled={lockLoading}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50"
                  >
                    {lockLoading ? 'Locking budget…' : `Lock ${fmt(round.proposed)} & start planning →`}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">
                    {approveCount}/{totalMembers} approved. You can lock anyway or let the Budget Bot try again.
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onRepropose}
                      disabled={repropopeLoading}
                      className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition disabled:opacity-50"
                    >
                      {repropopeLoading ? 'Re-thinking…' : '🔄 Let Bot try again'}
                    </button>
                    <button
                      type="button"
                      onClick={onLock}
                      disabled={lockLoading || approveCount === 0}
                      className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50"
                    >
                      {lockLoading ? 'Locking…' : 'Lock anyway'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
