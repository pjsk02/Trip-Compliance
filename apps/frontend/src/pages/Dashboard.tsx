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

function MemberRow({ member, isMe }: { member: Group['members'][0]; isMe: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* Avatar initial */}
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
      <StatusBadge status={member.preferenceStatus} />
    </div>
  );
}

export function Dashboard() {
  const { code } = useParams<{ code: string }>();
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const fetchGroup = useCallback(async () => {
    if (!code) return;
    try {
      const g = await api.getGroup(code);
      setGroup(g);
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
  }, [code, logout, navigate]);

  useEffect(() => {
    if (!session) { navigate('/'); return; }
    fetchGroup();
    // Poll every 10s so member list updates without a full refresh.
    const interval = setInterval(fetchGroup, 10_000);
    return () => clearInterval(interval);
  }, [session, fetchGroup, navigate]);

  async function handleAction(action: 'lock' | 'plan') {
    if (!code) return;
    setActionLoading(action);
    setActionError('');
    try {
      if (action === 'lock') await api.lockPreferences(code);
      else await api.triggerPlanning(code);
      await fetchGroup();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

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

  // Admin action button states
  const canLock = group.status === 'COLLECTING';
  const canPlan = group.status === 'BUDGET_NEGOTIATION';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
              <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 text-sm">TripSync AI</span>
          </div>
          <button
            onClick={() => { logout(); navigate('/'); }}
            className="text-xs text-gray-400 hover:text-gray-600 transition"
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
              <span className="shrink-0 rounded-lg bg-gray-100 px-2.5 py-1 font-mono text-xs font-medium text-gray-600 tracking-widest">
                {group.groupCode}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <GroupStatusBar status={group.status} />
        </div>

        {/* Admin actions */}
        {session?.isAdmin && (
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Organizer actions</p>

            {actionError && (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{actionError}</div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <Button
                  variant={canLock ? 'primary' : 'secondary'}
                  disabled={!canLock}
                  loading={actionLoading === 'lock'}
                  className="w-full"
                  onClick={() => handleAction('lock')}
                >
                  Lock preferences
                </Button>
                {!canLock && group.status === 'COLLECTING' && (
                  <p className="mt-1 text-center text-xs text-gray-400">
                    {allComplete
                      ? 'All preferences in — ready to lock!'
                      : `${completedCount}/${totalCount} members done`}
                  </p>
                )}
                {group.status !== 'COLLECTING' && (
                  <p className="mt-1 text-center text-xs text-gray-400">Already locked</p>
                )}
              </div>

              <div className="flex-1">
                <Button
                  variant={canPlan ? 'primary' : 'secondary'}
                  disabled={!canPlan}
                  loading={actionLoading === 'plan'}
                  className="w-full"
                  onClick={() => handleAction('plan')}
                >
                  Start planning
                </Button>
                {group.status === 'COLLECTING' && (
                  <p className="mt-1 text-center text-xs text-gray-400">Lock preferences first</p>
                )}
                {group.status === 'PLANNING' && (
                  <p className="mt-1 text-center text-xs text-gray-400">Planning in progress…</p>
                )}
              </div>
            </div>
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
              />
            ))}
          </div>
          <div className="px-5 pb-4" />
        </div>

        {/* Non-admin hint */}
        {!session?.isAdmin && group.status === 'COLLECTING' && (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4">
            <p className="text-sm font-medium text-amber-800">Your preferences are needed!</p>
            <p className="mt-0.5 text-xs text-amber-700">
              The organizer will unlock planning once everyone has submitted their preferences.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
