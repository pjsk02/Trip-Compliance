import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import type { Group, GroupStatus } from '../types';

const STATUS_STEPS: GroupStatus[] = ['COLLECTING', 'BUDGET_NEGOTIATION', 'PLANNING', 'COMPLETE'];
const STATUS_LABELS: Record<GroupStatus, string> = {
  COLLECTING: 'Collecting preferences',
  BUDGET_NEGOTIATION: 'Budget negotiation',
  PLANNING: 'Planning',
  COMPLETE: 'Complete',
};

function GroupStatusBar({ status }: { status: GroupStatus }) {
  const current = STATUS_STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1">
      {STATUS_STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={`h-1.5 w-full rounded-full transition-colors ${
              i <= current ? 'bg-indigo-500' : 'bg-gray-200'
            }`}
          />
          <span className={`hidden sm:block text-[10px] font-medium ${i === current ? 'text-indigo-600' : 'text-gray-400'}`}>
            {STATUS_LABELS[s]}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation dialog (inline modal)
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-4">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{body}</p>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button
            className={`flex-1 ${danger ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemberRow — shows name, status badge, and (admin only) remove button
// ---------------------------------------------------------------------------

interface MemberRowProps {
  member: Group['members'][0];
  isMe: boolean;
  isAdmin: boolean;       // is the viewer the admin?
  onRemove?: () => void;  // only provided if viewer is admin and target is not self
}

function MemberRow({ member, isMe, isAdmin, onRemove }: MemberRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
          {member.name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">
            {member.name}
            {isMe && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
            {member.isAdmin && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                Admin
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400">
            Joined {new Date(member.joinedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={member.preferenceStatus} />
        {isAdmin && !isMe && (
          <button
            onClick={onRemove}
            className="ml-1 rounded-lg bg-red-50 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100 transition"
            title={`Remove ${member.name}`}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function Dashboard() {
  const { code } = useParams<{ code: string }>();
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [nudgeMsg, setNudgeMsg] = useState('');
  const [deadline, setDeadline] = useState('');
  const [deadlineLoading, setDeadlineLoading] = useState(false);

  // Confirmation dialogs
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState<{ show: boolean; hasDownstream: boolean }>({ show: false, hasDownstream: false });
  const [confirmKick, setConfirmKick] = useState<{ memberId: string; name: string } | null>(null);

  const fetchGroup = useCallback(async () => {
    if (!code) return;
    try {
      const g = await api.getGroup(code);
      setGroup(g);
      if (g.submissionDeadline && !deadline) {
        setDeadline(new Date(g.submissionDeadline).toISOString().slice(0, 16));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/');
      } else {
        setError('Could not load group. Try refreshing.');
      }
    } finally {
      setLoading(false);
    }
  }, [code, logout, navigate, deadline]);

  useEffect(() => {
    if (!session) { navigate('/'); return; }
    fetchGroup();
    const interval = setInterval(fetchGroup, 10_000);
    return () => clearInterval(interval);
  }, [session, fetchGroup, navigate]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  async function handleAction(action: 'lock' | 'generate') {
    if (!code) return;
    setActionLoading(action);
    setActionError('');
    try {
      if (action === 'lock') {
        await api.lockPreferences(code);
      } else if (action === 'generate') {
        // Navigate to the live negotiation view — generation runs there via SSE.
        navigate(`/group/${code}/negotiate?tripDuration=3`);
        return;
      }
      await fetchGroup();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnlock(confirm: boolean) {
    if (!code) return;
    setConfirmUnlock({ show: false, hasDownstream: false });
    setActionLoading('unlock');
    setActionError('');
    try {
      const res = await api.unlockPreferences(code, confirm || undefined);
      if (res.requiresConfirmation) {
        // Backend says there's downstream data — show warning dialog
        setConfirmUnlock({ show: true, hasDownstream: true });
        setActionLoading(null);
        return;
      }
      await fetchGroup();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unlock failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleKick(memberId: string) {
    if (!code) return;
    setConfirmKick(null);
    setActionLoading(`kick-${memberId}`);
    setActionError('');
    try {
      await api.kickMember(code, memberId);
      await fetchGroup();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not remove member');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleLeave() {
    if (!code) return;
    setConfirmLeave(false);
    setActionLoading('leave');
    setActionError('');
    try {
      const res = await api.leaveGroup(code);
      if (res.groupDeleted) {
        logout();
        navigate('/');
      } else {
        logout();
        navigate('/home');
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not leave group');
      setActionLoading(null);
    }
  }

  async function handleNudge() {
    if (!code) return;
    setActionLoading('nudge');
    setNudgeMsg('');
    try {
      const res = await api.nudgeMembers(code);
      setNudgeMsg(res.message);
    } catch (err) {
      setNudgeMsg(err instanceof ApiError ? err.message : 'Nudge failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSetDeadline() {
    if (!code || !deadline) return;
    setDeadlineLoading(true);
    try {
      await api.setDeadline(code, new Date(deadline).toISOString());
      await fetchGroup();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not set deadline');
    } finally {
      setDeadlineLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <p className="text-sm text-red-600">{error || 'Group not found.'}</p>
        <Button variant="secondary" onClick={() => navigate('/')}>Go home</Button>
      </div>
    );
  }

  const completedCount = group.members.filter(m => m.preferenceStatus === 'COMPLETE').length;
  const totalCount = group.members.length;
  const allComplete = completedCount === totalCount && totalCount > 0;

  const isAdmin    = session?.isAdmin ?? false;
  const canLock    = group.status === 'COLLECTING';
  const canUnlock  = group.status === 'BUDGET_NEGOTIATION';
  const inBudget   = group.status === 'BUDGET_NEGOTIATION';
  const inPlanning = group.status === 'PLANNING';
  const isComplete = group.status === 'COMPLETE';
  const isLocked   = group.status !== 'COLLECTING';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Confirmation dialogs */}
      {confirmLeave && (
        <ConfirmDialog
          title="Leave this group?"
          body={
            isAdmin
              ? 'As the organizer, leaving will disband the group and delete all data. This cannot be undone.'
              : 'You will be removed from the group and your preferences will be deleted.'
          }
          confirmLabel="Leave group"
          danger
          onConfirm={handleLeave}
          onCancel={() => setConfirmLeave(false)}
        />
      )}

      {confirmUnlock.show && (
        <ConfirmDialog
          title="Discard budget data and unlock?"
          body="There are existing budget proposals or a locked budget. Unlocking preferences will delete all budget rounds, votes, and any generated itinerary so members can re-edit. This cannot be undone."
          confirmLabel="Yes, unlock and discard"
          danger
          onConfirm={() => handleUnlock(true)}
          onCancel={() => setConfirmUnlock({ show: false, hasDownstream: false })}
        />
      )}

      {confirmKick && (
        <ConfirmDialog
          title={`Remove ${confirmKick.name}?`}
          body="Their preferences and any budget votes for this group will be deleted. They can re-join if the group is still open."
          confirmLabel="Remove member"
          danger
          onConfirm={() => handleKick(confirmKick.memberId)}
          onCancel={() => setConfirmKick(null)}
        />
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Logo — always routes home */}
            <button
              onClick={() => navigate('/home')}
              className="flex items-center gap-1.5 group"
              title="My trips"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 group-hover:bg-indigo-700 transition-colors">
                <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                    d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064" />
                </svg>
              </div>
              <span className="font-semibold text-gray-900 text-sm group-hover:text-indigo-600 transition-colors">TripSync AI</span>
            </button>
            {/* My trips link */}
            <button
              onClick={() => navigate('/home')}
              className="hidden sm:flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition-colors"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              My trips
            </button>
          </div>
          <button
            onClick={() => setConfirmLeave(true)}
            className="text-xs text-gray-400 hover:text-red-500 transition"
          >
            Leave group
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 space-y-5">
        {/* Group header */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 space-y-4">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-lg font-bold text-gray-900">{group.name}</h1>
                {group.destination && (
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-gray-500">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    {group.destination}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="rounded-lg bg-gray-100 px-2.5 py-1 font-mono text-xs font-medium text-gray-600 tracking-widest">
                  {group.groupCode}
                </span>
                {isLocked && (
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    Closed to new members
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <GroupStatusBar status={group.status} />
        </div>

        {/* Admin actions */}
        {isAdmin && (
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Organizer actions</p>

            {actionError && (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{actionError}</div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              {/* Step 1 — Lock / Unlock preferences */}
              <div className="flex-1">
                {canLock && (
                  <>
                    <Button
                      variant="primary"
                      loading={actionLoading === 'lock'}
                      className="w-full"
                      onClick={() => handleAction('lock')}
                    >
                      Lock preferences
                    </Button>
                    <p className="mt-1 text-center text-xs text-gray-400">
                      {allComplete
                        ? 'All preferences in — ready to lock!'
                        : `${completedCount}/${totalCount} members done`}
                    </p>
                  </>
                )}
                {canUnlock && (
                  <>
                    <Button
                      variant="secondary"
                      loading={actionLoading === 'unlock'}
                      className="w-full"
                      onClick={() => handleUnlock(false)}
                    >
                      Unlock preferences
                    </Button>
                    <p className="mt-1 text-center text-xs text-gray-400">Re-opens preference editing</p>
                  </>
                )}
                {!canLock && !canUnlock && (
                  <>
                    <Button variant="secondary" disabled className="w-full">Lock preferences</Button>
                    <p className="mt-1 text-center text-xs text-gray-400">Preferences locked ✓</p>
                  </>
                )}
              </div>

              {/* Step 2 — Budget negotiation */}
              <div className="flex-1">
                <Button
                  variant={inBudget ? 'primary' : 'secondary'}
                  disabled={!inBudget && !inPlanning && !isComplete}
                  className="w-full"
                  onClick={() => navigate(`/group/${group.groupCode}/budget`)}
                >
                  {inBudget ? 'Budget negotiation →' : 'Budget'}
                </Button>
                {group.status === 'COLLECTING' && (
                  <p className="mt-1 text-center text-xs text-gray-400">Lock preferences first</p>
                )}
                {(inPlanning || isComplete) && (
                  <p className="mt-1 text-center text-xs text-gray-400">
                    Budget locked: ${Number(group.lockedBudget).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* Step 3 — Generate itinerary (PLANNING phase) */}
            {inPlanning && (
              <Button
                variant="primary"
                loading={actionLoading === 'generate'}
                className="w-full"
                onClick={() => handleAction('generate')}
              >
                ✨ Generate itinerary
              </Button>
            )}

            {/* Step 3 — View itinerary (COMPLETE) */}
            {isComplete && (
              <Button
                variant="primary"
                className="w-full"
                onClick={() => navigate(`/group/${group.groupCode}/itinerary`)}
              >
                View trip itinerary →
              </Button>
            )}

            {/* Nudge pending members */}
            {group.status === 'COLLECTING' && completedCount < totalCount && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500">
                  {totalCount - completedCount} member{totalCount - completedCount !== 1 ? 's' : ''} haven't finished preferences
                </p>
                <Button
                  variant="secondary"
                  loading={actionLoading === 'nudge'}
                  className="w-full text-xs"
                  onClick={handleNudge}
                >
                  Nudge pending members
                </Button>
                {nudgeMsg && (
                  <p className="text-xs text-emerald-700">{nudgeMsg}</p>
                )}
              </div>
            )}

            {/* Submission deadline */}
            {group.status === 'COLLECTING' && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500">Submission deadline</p>
                {group.submissionDeadline && (
                  <p className="text-xs text-amber-700">
                    Current: {new Date(group.submissionDeadline).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                    className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    disabled={!deadline || deadlineLoading}
                    onClick={handleSetDeadline}
                    className="shrink-0 rounded-xl bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40 transition"
                  >
                    {deadlineLoading ? '…' : 'Set'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Member roster */}
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <p className="text-sm font-semibold text-gray-700">Members</p>
            <span className="text-xs text-gray-400">
              {completedCount}/{totalCount} ready
            </span>
          </div>

          {/* Preference progress bar */}
          <div className="px-5 mb-3">
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : '0%' }}
              />
            </div>
          </div>

          <div className="divide-y divide-gray-100 px-5">
            {group.members.map(member => (
              <MemberRow
                key={member.id}
                member={member}
                isMe={member.id === session?.memberId}
                isAdmin={isAdmin}
                onRemove={
                  isAdmin && member.id !== session?.memberId
                    ? () => setConfirmKick({ memberId: member.id, name: member.name })
                    : undefined
                }
              />
            ))}
          </div>
          <div className="px-5 pb-4" />
        </div>

        {/* Budget negotiation CTA — shown for all members during BUDGET_NEGOTIATION */}
        {group.status === 'BUDGET_NEGOTIATION' && (
          <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 px-5 py-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">💰 Budget negotiation is live</p>
              <p className="mt-0.5 text-xs text-amber-700">
                The Budget Bot will propose a group total based on everyone's budgets.
                Vote to approve or push back — individual budgets stay private.
              </p>
            </div>
            <Button className="w-full" onClick={() => navigate(`/group/${group.groupCode}/budget`)}>
              Go to budget negotiation →
            </Button>
          </div>
        )}

        {/* Finalized trip CTA — shown to ALL members when admin has finalized */}
        {isComplete && group.finalizedAt && (
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 px-5 py-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <span className="text-xl shrink-0">✅</span>
              <div>
                <p className="text-sm font-semibold text-emerald-900">Trip finalized ✓</p>
                <p className="mt-0.5 text-xs text-emerald-700">
                  Your organizer has officially selected the final itinerary.
                  Finalized {new Date(group.finalizedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}.
                </p>
              </div>
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => navigate(`/group/${group.groupCode}/final`)}>
              View final trip →
            </Button>
          </div>
        )}

        {/* Itinerary CTA — shown to all members when plan is complete (no final yet, or admin) */}
        {isComplete && (!group.finalizedAt || isAdmin) && (
          <div className={`rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 px-5 py-4 space-y-3 ${group.finalizedAt ? 'opacity-80' : ''}`}>
            <div>
              <p className="text-sm font-semibold text-indigo-900">
                {group.finalizedAt ? '🔧 Organizer: all versions' : '🎉 Your trip is planned!'}
              </p>
              <p className="mt-0.5 text-xs text-indigo-700">
                {group.finalizedAt
                  ? 'View or change the finalized version from the full itinerary page.'
                  : 'The AI has generated a day-by-day itinerary with budget breakdown and satisfaction scores.'}
              </p>
            </div>
            <Button className="w-full" onClick={() => navigate(`/group/${group.groupCode}/itinerary`)}>
              {group.finalizedAt ? 'Manage versions →' : 'View trip itinerary →'}
            </Button>
          </div>
        )}

        {/* My preference CTA — shown when collecting and this member isn't done */}
        {group.status === 'COLLECTING' && (() => {
          const me = group.members.find(m => m.id === session?.memberId);
          if (!me || me.preferenceStatus === 'COMPLETE') return null;
          return (
            <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 px-5 py-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-indigo-900">
                  {me.preferenceStatus === 'PENDING'
                    ? '👋 Share your travel preferences'
                    : '⏳ Finish your preferences'}
                </p>
                <p className="mt-0.5 text-xs text-indigo-700">
                  {me.preferenceStatus === 'PENDING'
                    ? "Chat with the AI agent to tell us what kind of trip you'd love. Takes ~3 minutes."
                    : "You started but haven't finished yet. Pick up where you left off."}
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => navigate(`/group/${group.groupCode}/preferences`)}
              >
                {me.preferenceStatus === 'PENDING' ? 'Set my preferences →' : 'Continue chat →'}
              </Button>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
