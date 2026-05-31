import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

export function JoinGroup() {
  const { loginGroup, userSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [form, setForm] = useState({
    code:     searchParams.get('code') ?? '',
    password: '',
  });
  const [errors,   setErrors]   = useState<Partial<typeof form>>({});
  const [loading,  setLoading]  = useState(false);
  const [apiError, setApiError] = useState('');

  function validate() {
    const e: Partial<typeof form> = {};
    if (!form.code.trim()) e.code = 'Group code is required';
    if (!form.password)    e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError('');
    try {
      const code = form.code.trim().toUpperCase();
      const res  = await api.joinGroup(code, { password: form.password });
      loginGroup({
        token:      res.token,
        memberId:   res.member.id,
        groupId:    res.group.id,
        isAdmin:    res.member.isAdmin,
        memberName: res.member.name ?? userSession?.user.name ?? '',
        groupCode:  code,
      });
      navigate(`/group/${code}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401)      setApiError('Wrong password. Double-check and try again.');
        else if (err.status === 404) setApiError('Group not found. Check the code and try again.');
        else                         setApiError(err.message);
      } else {
        setApiError('Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
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
            <h1 className="text-xl font-bold text-gray-900">Join a group</h1>
            <p className="mt-1 text-sm text-gray-500">
              Use the code and password your organizer shared.
              {userSession?.user.name ? ` You'll join as ${userSession.user.name}.` : ''}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Group code"
              placeholder="e.g. BALI-4821"
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              error={errors.code}
              autoFocus={!form.code}
              className="font-mono tracking-widest uppercase"
            />
            <Input
              label="Password"
              type="password"
              placeholder="Password from your organizer"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              error={errors.password}
            />
            {apiError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{apiError}</div>
            )}
            <Button type="submit" loading={loading} className="w-full mt-1">
              Join group
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
