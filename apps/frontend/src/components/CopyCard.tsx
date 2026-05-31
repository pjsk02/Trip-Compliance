import { useState } from 'react';
import { Button } from './Button';

interface Props {
  groupCode: string;
  password: string;
  groupName: string;
}

export function CopyCard({ groupCode, password, groupName }: Props) {
  const [copied, setCopied] = useState(false);

  const shareText = `Join my trip "${groupName}" on TripSync AI!\nGroup code: ${groupCode}\nPassword: ${password}`;

  function handleCopy() {
    navigator.clipboard.writeText(shareText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
          <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="font-semibold text-indigo-900">Group created!</p>
      </div>

      <p className="text-sm text-indigo-700">
        Share this code and password with your travel crew. The password is shown only once.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Group code</p>
          <p className="mt-0.5 text-lg font-bold text-gray-900 tracking-widest">{groupCode}</p>
        </div>
        <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Password</p>
          <p className="mt-0.5 text-lg font-bold text-gray-900 font-mono">{password}</p>
        </div>
      </div>

      <Button variant="secondary" className="w-full" onClick={handleCopy}>
        {copied ? (
          <>
            <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy invite message
          </>
        )}
      </Button>
    </div>
  );
}
