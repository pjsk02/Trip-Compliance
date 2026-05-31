import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { CopyCard } from '../components/CopyCard';
import type { CreateGroupResponse } from '../types';

function randomPassword() {
  const words = ['ocean', 'summit', 'breeze', 'trail', 'lagoon', 'canyon', 'delta', 'fjord'];
  const nums = Math.floor(100 + Math.random() * 900);
  return `${words[Math.floor(Math.random() * words.length)]}${nums}`;
}

export function CreateGroup() {
  const { loginGroup, userSession } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    destination: '',
    password: randomPassword(),
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [created, setCreated] = useState<CreateGroupResponse | null>(null);

  function validate() {
    const e: Partial<typeof form> = {};
    if (!form.name.trim()) e.name = 'Trip name is required';
    if (form.password.length < 4) e.password = 'Password must be at least 4 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError('');
    try {
      const res = await api.createGroup({
        name: form.name.trim(),
        destination: form.destination.trim() || undefined,
        password: form.password,
      });
      setCreated(res);
      loginGroup({
        token:      res.token,
        memberId:   res.member.id,
        groupId:    '',          // populated when Dashboard fetches the group
        isAdmin:    true,
        memberName: res.member.name ?? userSession?.user.name ?? '',
        groupCode:  res.groupCode,
      });
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-5">
          <CopyCard groupCode={created.groupCode} password={created.password} groupName={form.name} />
          <Button className="w-full" onClick={() => navigate(`/group/${created.groupCode}`)}>
            Go to my group →
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Back */}
        <button
          onClick={() => navigate('/home')}
          className="mb-6 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Create a group</h1>
            <p className="mt-1 text-sm text-gray-500">
              You'll be the organizer.{userSession?.user.name ? ` Joining as ${userSession.user.name}.` : ''}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Trip name"
              placeholder="e.g. Summer Bali Trip"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              error={errors.name}
              autoFocus
            />
            <Input
              label="Destination (optional)"
              placeholder="e.g. Bali, Indonesia"
              value={form.destination}
              onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
            />
            {/* Password row with regenerate */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Group password</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm font-mono text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                />
                <button
                  type="button"
                  title="Regenerate"
                  onClick={() => setForm(f => ({ ...f, password: randomPassword() }))}
                  className="flex items-center justify-center rounded-xl border border-gray-300 px-3 py-2 text-gray-500 hover:bg-gray-50 transition"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
              <p className="text-xs text-gray-400">Members will use this to join. Share it along with the group code.</p>
            </div>

            {apiError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{apiError}</div>
            )}

            <Button type="submit" loading={loading} className="w-full mt-1">
              Create group
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
