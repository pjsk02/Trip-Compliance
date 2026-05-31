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

const PREF_LABEL: Record<string, string> = {
  PENDING:     'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETE:    'Done',
};

const PREF_COLOR: Record<string, string> = {
  PENDING:     'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  COMPLETE:    'bg-green-100 text-green-700',
};

export function Home() {
  const { userSession, logout } = useAuth();
  const navigate = useNavigate();

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    api.getMe()
      .then((data) => setMemberships(data.memberships))
      .catch(() => setError('Could not load your groups.'))
      .finally(() => setLoading(false));
  }, []);

  function enterGroup(m: Membership) {
    // Entering a group requires a member-scoped token — we re-join (idempotent) via joinGroup.
    // Instead we navigate to the group page and let Dashboard fetch the group.
    // To do so we need to set the member token. We store memberId in the membership so we can
    // issue a lightweight token-exchange call. For now we navigate and let Dashboard request
    // the user to re-authenticate into the group if needed.
    navigate(`/group/${m.group.groupCode}`);
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
          <h2 className="text-xl font-bold text-gray-900">Your trip groups</h2>
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
          <p className="text-center text-sm text-red-600 py-10">{error}</p>
        )}

        {!loading && !error && memberships.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-500 text-sm">You haven't joined any trip groups yet.</p>
            <p className="mt-1 text-gray-400 text-xs">Create one or ask someone to share their group code.</p>
          </div>
        )}

        {!loading && memberships.length > 0 && (
          <ul className="space-y-3">
            {memberships.map((m) => (
              <li key={m.memberId}>
                <button
                  onClick={() => enterGroup(m)}
                  className="group w-full rounded-2xl border border-gray-100 bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{m.group.name}</p>
                      {m.group.destination && (
                        <p className="text-sm text-gray-500 mt-0.5">{m.group.destination}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          {STATUS_LABEL[m.group.status] ?? m.group.status}
                        </span>
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${PREF_COLOR[m.preferenceStatus]}`}>
                          Prefs: {PREF_LABEL[m.preferenceStatus] ?? m.preferenceStatus}
                        </span>
                        {m.isAdmin && (
                          <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                            Admin
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
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
