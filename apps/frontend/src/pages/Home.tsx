import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { Membership } from '../types';

const STATUS_LABEL: Record<string, string> = {
  COLLECTING:         'Collecting preferences',
  BUDGET_NEGOTIATION: 'Budget negotiation',
  PLANNING:           'Planning',
  COMPLETE:           'Complete',
};

const STATUS_DOT: Record<string, string> = {
  COLLECTING:         'bg-gray-300',
  BUDGET_NEGOTIATION: 'bg-amber-400',
  PLANNING:           'bg-indigo-400',
  COMPLETE:           'bg-emerald-500',
};

export function Home() {
  const { userSession, loginGroup, logout } = useAuth();
  const navigate = useNavigate();

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api.getMe()
      .then((data) => setMemberships(data.memberships))
      .catch(() => setError("Couldn't reach the server."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function enterGroup(m: Membership) {
    try {
      const res = await api.enterGroup(m.group.groupCode);
      loginGroup({
        token:      res.token,
        memberId:   res.member.id,
        groupId:    res.group.id,
        isAdmin:    res.member.isAdmin,
        memberName: res.member.name,
        groupCode:  m.group.groupCode,
      });
      // Route finalized groups straight to the final view
      if (m.group.finalizedAt) {
        navigate(`/group/${m.group.groupCode}/final`);
      } else {
        navigate(`/group/${m.group.groupCode}`);
      }
    } catch {
      setError('Could not enter group. Please try again.');
    }
  }

  if (!userSession) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
            <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900">TripSync AI</span>
        </div>

        <div className="flex items-center gap-3">
          {userSession.user.avatarUrl && (
            <img
              src={userSession.user.avatarUrl}
              alt={userSession.user.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          )}
          <span className="text-sm text-gray-700 hidden sm:block">{userSession.user.name}</span>
          <button
            onClick={logout}
            className="text-sm text-gray-400 hover:text-gray-700 transition"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">My trips</h2>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/join')}
              className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 transition"
            >
              Join group
            </button>
            <button
              onClick={() => navigate('/create')}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition"
            >
              Create group
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm space-y-3">
            <p className="text-2xl">⚡</p>
            <p className="text-sm font-semibold text-gray-800">Couldn't reach the server</p>
            <p className="text-xs text-gray-500">
              Make sure the backend is running on port 3001, then try again.
            </p>
            <button
              onClick={load}
              className="mt-1 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && memberships.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-500 text-sm">You haven't joined any trip groups yet.</p>
            <p className="mt-1 text-gray-400 text-xs">Create one or ask someone to share their group code.</p>
          </div>
        )}

        {!loading && memberships.length > 0 && (
          <ul className="space-y-3">
            {memberships.map((m) => {
              const isFinalized = !!m.group.finalizedAt;
              return (
                <li key={m.memberId}>
                  <button
                    onClick={() => enterGroup(m)}
                    className="group w-full rounded-2xl border border-gray-100 bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 truncate">{m.group.name}</p>
                          {isFinalized && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              ✓ Finalized
                            </span>
                          )}
                        </div>
                        {m.group.destination && (
                          <p className="text-sm text-gray-500 mt-0.5">{m.group.destination}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {/* Status dot + label */}
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 border border-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[m.group.status] ?? 'bg-gray-300'}`} />
                            {STATUS_LABEL[m.group.status] ?? m.group.status}
                          </span>
                          {m.isAdmin && (
                            <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                              Organizer
                            </span>
                          )}
                          {isFinalized && (
                            <span className="text-[11px] text-emerald-600 font-medium">
                              View final trip →
                            </span>
                          )}
                        </div>
                      </div>
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 group-hover:text-indigo-500 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                    <p className="mt-3 text-xs text-gray-400 font-mono">{m.group.groupCode}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
