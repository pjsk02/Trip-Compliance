import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { api, setUserToken } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function Landing() {
  const navigate  = useNavigate();
  const { loginUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGoogleSuccess(response: CredentialResponse) {
    if (!response.credential) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.googleVerify(response.credential);
      setUserToken(data.token);
      loginUser({ userToken: data.token, user: data.user });
      navigate('/home');
    } catch {
      setError('Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col items-center justify-center px-4">
      {/* Logo / hero */}
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg">
          <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
          </svg>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">
          TripSync<span className="text-indigo-600"> AI</span>
        </h1>
        <p className="mt-2 text-base text-gray-500 max-w-xs mx-auto">
          Group travel, planned together — where everyone's preferences actually matter.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm text-center">
          <p className="mb-4 text-sm text-gray-600">Sign in to create or join a trip group</p>

          {loading ? (
            <div className="flex justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            </div>
          ) : (
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google sign-in was cancelled or failed.')}
                theme="outline"
                shape="rectangular"
                size="large"
                text="signin_with"
              />
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </div>

        <p className="text-center text-xs text-gray-400">
          Your name and avatar come from your Google account.
        </p>
      </div>
    </div>
  );
}
