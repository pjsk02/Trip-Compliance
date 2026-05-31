import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ChatBubble, TypingBubble } from '../components/ChatBubble';
import { CategoryProgress } from '../components/CategoryProgress';
import { PreferenceReview } from '../components/PreferenceReview';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import type { ChatMessageData, CategoryCoverage, PreferenceProfileData } from '../types';

type Screen = 'loading' | 'chat' | 'review' | 'done';

const EMPTY_COVERAGE: CategoryCoverage = {
  activities: false, food: false, logistics: false, constraints: false,
};

export function PreferenceChat() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  const [screen, setScreen] = useState<Screen>('loading');
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [coverage, setCoverage] = useState<CategoryCoverage>(EMPTY_COVERAGE);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [chatComplete, setChatComplete] = useState(false);

  // Extraction
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [profile, setProfile] = useState<PreferenceProfileData | null>(null);

  // Finalize
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentTyping]);

  // Load or start chat on mount
  const initChat = useCallback(async () => {
    if (!session) { navigate('/'); return; }
    try {
      const history = await api.getChatHistory(session.memberId);
      if (history.preferenceStatus === 'COMPLETE') {
        setScreen('done');
        return;
      }
      setCoverage(history.coverage);
      if (history.messages.length === 0) {
        // No messages yet — send synthetic init to get the greeting
        setAgentTyping(true);
        const res = await api.sendChat(session.memberId, '__init__');
        setMessages([{
          id: 'init',
          role: 'ASSISTANT',
          content: res.reply,
          createdAt: new Date().toISOString(),
        }]);
        setCoverage(res.coverage);
      } else {
        setMessages(history.messages);
        const lastMsg = history.messages[history.messages.length - 1];
        if (lastMsg?.role === 'ASSISTANT' && lastMsg.content.includes('PREFERENCES_COMPLETE')) {
          setChatComplete(true);
        }
      }
      setScreen('chat');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); navigate('/'); }
    } finally {
      setAgentTyping(false);
    }
  }, [session, navigate, logout]);

  useEffect(() => { initChat(); }, [initChat]);

  async function handleSend() {
    if (!input.trim() || sending || !session) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    // Optimistic user bubble
    const userMsg: ChatMessageData = {
      id: `tmp-${Date.now()}`,
      role: 'USER',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setAgentTyping(true);

    try {
      const res = await api.sendChat(session.memberId, text);
      const agentMsg: ChatMessageData = {
        id: `tmp-agent-${Date.now()}`,
        role: 'ASSISTANT',
        content: res.reply,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, agentMsg]);
      setCoverage(res.coverage);
      if (res.complete) setChatComplete(true);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
      setInput(text); // restore
    } finally {
      setSending(false);
      setAgentTyping(false);
    }
  }

  async function handleExtract() {
    if (!session) return;
    setExtracting(true);
    setExtractError('');
    try {
      const res = await api.finalizePreferences(session.memberId);
      setProfile(res.profile);
      setScreen('review');
    } catch (err) {
      setExtractError(err instanceof ApiError ? err.message : 'Extraction failed. Try again.');
    } finally {
      setExtracting(false);
    }
  }

  async function handleConfirm() {
    // finalize-preferences is idempotent — calling again just returns the saved profile
    if (!session) return;
    setFinalizing(true);
    setFinalizeError('');
    try {
      await api.finalizePreferences(session.memberId);
      setScreen('done');
    } catch (err) {
      setFinalizeError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setFinalizing(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // ─── Done ─────────────────────────────────────────────────────────────────
  if (screen === 'done') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-gray-50 px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <svg className="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900">You're all set!</h2>
          <p className="mt-1 text-sm text-gray-500">Your preferences are saved. Waiting for the group to be ready.</p>
        </div>
        <Button onClick={() => navigate(`/group/${session?.groupCode}`)}>Back to group</Button>
      </div>
    );
  }

  // ─── Review ───────────────────────────────────────────────────────────────
  if (screen === 'review' && profile) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-lg space-y-4">
          {finalizeError && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{finalizeError}</div>
          )}
          <PreferenceReview
            profile={profile}
            onConfirm={handleConfirm}
            onEdit={() => setScreen('chat')}
            loading={finalizing}
          />
        </div>
      </div>
    );
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────
  const allCovered = Object.values(coverage).every(Boolean);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate(`/group/${session?.groupCode}`)}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">Preference Agent</p>
            <p className="text-xs text-gray-400">Collecting your travel preferences</p>
          </div>
        </div>

        {/* Category progress bar */}
        <div className="border-t border-gray-100 bg-white px-4 pb-3 pt-2">
          <div className="mx-auto max-w-xl">
            <CategoryProgress coverage={coverage} />
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 py-5">
        {messages.map(msg => (
          <ChatBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            memberName={session?.memberName ?? '?'}
          />
        ))}
        {agentTyping && <TypingBubble />}

        {/* CTA after chat complete */}
        {chatComplete && !agentTyping && (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 space-y-3">
            <p className="text-sm font-medium text-indigo-900">
              Great conversation! Ready to review what was captured?
            </p>
            {extractError && <p className="text-xs text-red-600">{extractError}</p>}
            <Button
              onClick={handleExtract}
              loading={extracting}
              className="w-full"
            >
              Review my preferences →
            </Button>
          </div>
        )}

        {/* Soft nudge once all categories covered but agent hasn't wrapped up */}
        {allCovered && !chatComplete && messages.length > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5">
            <p className="text-xs text-amber-700">
              All categories covered — the agent will wrap up the conversation soon.
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Input bar */}
      {!chatComplete && (
        <div className="sticky bottom-0 border-t border-gray-200 bg-white/90 backdrop-blur-sm px-4 py-3">
          <div className="mx-auto flex max-w-xl gap-2">
            <textarea
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-32"
              placeholder="Type your reply…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
