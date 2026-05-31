import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ChatBubble, TypingBubble } from '../components/ChatBubble';
import { StepProgress } from '../components/StepProgress';
import { SliderPanel, DEFAULT_SLIDERS, DEFAULT_CONSTRAINTS } from '../components/SliderPanel';
import { PreferenceReview } from '../components/PreferenceReview';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import type {
  ChatMessageData, StepCoverage,
  SliderValues, ConstraintFields, PreferenceProfileData,
} from '../types';

type Screen = 'loading' | 'hybrid' | 'review' | 'done';

const EMPTY_COVERAGE: StepCoverage = {
  slidersSet: false, constraintsFilled: false, chatDone: false,
};

export function PreferenceChat() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  const [screen, setScreen] = useState<Screen>('loading');

  // Slider state
  const [sliders, setSliders]         = useState<SliderValues>(DEFAULT_SLIDERS);
  const [constraints, setConstraints] = useState<ConstraintFields>(DEFAULT_CONSTRAINTS);
  const [savingSliders, setSavingSliders] = useState(false);
  const [slidersSaved, setSlidersSaved]   = useState(false);

  // Chat state
  const [messages, setMessages]   = useState<ChatMessageData[]>([]);
  const [input, setInput]         = useState('');
  const [sending, setSending]     = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [chatComplete, setChatComplete] = useState(false);

  // Step coverage
  const [coverage, setCoverage] = useState<StepCoverage>(EMPTY_COVERAGE);

  // Review / finalize
  const [extracting, setExtracting]   = useState(false);
  const [extractError, setExtractError] = useState('');
  const [profile, setProfile]         = useState<PreferenceProfileData | null>(null);
  const [finalizing, setFinalizing]   = useState(false);
  const [finalizeError, setFinalizeError] = useState('');

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentTyping]);

  // ── Init ──────────────────────────────────────────────────────────────────

  const initPage = useCallback(async () => {
    if (!session) { navigate('/'); return; }
    try {
      const history = await api.getChatHistory(session.memberId);
      if (history.preferenceStatus === 'COMPLETE') { setScreen('done'); return; }

      // Restore slider state if they've been saved before
      if (history.sliderValues)    setSliders(history.sliderValues);
      if (history.constraintFields) setConstraints(history.constraintFields);

      const restoredSlidersSaved = !!history.sliderValues;
      const restoredConstraintsFilled =
        !!history.constraintFields &&
        (history.constraintFields.dietaryRestrictions.length > 0 ||
         !!history.constraintFields.hardBudgetCap ||
         !!history.constraintFields.totalBudget ||
         !!history.constraintFields.mobilityLimitations ||
         !!history.constraintFields.scheduleRestrictions ||
         !!history.constraintFields.visaRestrictions ||
         !!history.constraintFields.mustAvoidActivities);

      setSlidersSaved(restoredSlidersSaved);
      setCoverage({
        slidersSet:        restoredSlidersSaved,
        constraintsFilled: restoredConstraintsFilled,
        chatDone:          false,
      });

      if (history.messages.length === 0 && restoredSlidersSaved) {
        // Sliders saved, no chat yet — trigger AI greeting
        setAgentTyping(true);
        try {
          const res = await api.sendChat(session.memberId, '__init__');
          setMessages([{ id: 'init', role: 'ASSISTANT', content: res.reply, createdAt: new Date().toISOString() }]);
        } finally {
          setAgentTyping(false);
        }
      } else {
        setMessages(history.messages);
        const lastMsg = history.messages[history.messages.length - 1];
        if (lastMsg?.role === 'ASSISTANT' && lastMsg.content.includes('PREFERENCES_COMPLETE')) {
          setChatComplete(true);
          setCoverage(prev => ({ ...prev, chatDone: true }));
        }
      }

      setScreen('hybrid');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); navigate('/'); }
    }
  }, [session, navigate, logout]);

  useEffect(() => { initPage(); }, [initPage]);

  // ── Slider save ───────────────────────────────────────────────────────────

  async function handleSaveSliders() {
    if (!session || savingSliders) return;
    setSavingSliders(true);
    try {
      await api.saveSliders(session.memberId, sliders, constraints);
      setSlidersSaved(true);
      const constraintsFilled =
        constraints.dietaryRestrictions.length > 0 ||
        !!constraints.hardBudgetCap ||
        !!constraints.totalBudget ||
        !!constraints.mobilityLimitations ||
        !!constraints.scheduleRestrictions ||
        !!constraints.visaRestrictions ||
        !!constraints.mustAvoidActivities;
      setCoverage(prev => ({ ...prev, slidersSet: true, constraintsFilled }));

      // If chat hasn't started, trigger the AI greeting now
      if (messages.length === 0) {
        setAgentTyping(true);
        try {
          const res = await api.sendChat(session.memberId, '__init__');
          setMessages([{ id: 'init', role: 'ASSISTANT', content: res.reply, createdAt: new Date().toISOString() }]);
        } finally {
          setAgentTyping(false);
        }
      }
    } catch {
      // leave slider state as-is; user can retry
    } finally {
      setSavingSliders(false);
    }
  }

  // ── Chat send ─────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!input.trim() || sending || !session || !slidersSaved) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    const userMsg: ChatMessageData = {
      id: `tmp-${Date.now()}`, role: 'USER', content: text, createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setAgentTyping(true);

    try {
      const res = await api.sendChat(session.memberId, text);
      const agentMsg: ChatMessageData = {
        id: `tmp-agent-${Date.now()}`, role: 'ASSISTANT', content: res.reply, createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, agentMsg]);
      if (res.complete) {
        setChatComplete(true);
        setCoverage(prev => ({ ...prev, chatDone: true }));
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
      setInput(text);
    } finally {
      setSending(false);
      setAgentTyping(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  // ── Extract / finalize ────────────────────────────────────────────────────

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

  // ── Screens ───────────────────────────────────────────────────────────────

  if (screen === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

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

  if (screen === 'review' && profile) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-4">
          {finalizeError && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{finalizeError}</div>
          )}
          <PreferenceReview
            profile={profile}
            onConfirm={handleConfirm}
            onEdit={() => setScreen('hybrid')}
            loading={finalizing}
          />
        </div>
      </div>
    );
  }

  // ── Hybrid screen: sliders left, chat right ───────────────────────────────

  const canChat = slidersSaved;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate(`/group/${session?.groupCode}`)}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">Set Your Preferences</p>
            <p className="text-xs text-gray-400">Rate activities, add constraints, then let the AI ask follow-ups</p>
          </div>
        </div>

        {/* Step progress bar */}
        <div className="border-t border-gray-100 bg-white px-4 pb-3 pt-2">
          <div className="mx-auto max-w-6xl">
            <StepProgress coverage={coverage} />
          </div>
        </div>
      </header>

      {/* Two-column layout */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="flex flex-col gap-6 lg:flex-row">

          {/* Left column — sliders */}
          <div className="w-full lg:w-[480px] lg:shrink-0">
            <div className="lg:sticky lg:top-[120px] overflow-y-auto lg:max-h-[calc(100vh-140px)] space-y-1 pb-6">
              <p className="mb-4 text-xs text-gray-500">
                Drag each slider from <strong>1</strong> (don't care) to <strong>10</strong> (love it / top priority).
              </p>
              <SliderPanel
                sliders={sliders}
                constraints={constraints}
                onSliderChange={setSliders}
                onConstraintChange={setConstraints}
                onSave={handleSaveSliders}
                saving={savingSliders}
                saved={slidersSaved}
              />
            </div>
          </div>

          {/* Right column — AI clarifying chat */}
          <div className="flex-1 flex flex-col min-h-[500px]">
            <div className="rounded-2xl border border-gray-100 bg-white flex flex-col h-full overflow-hidden">
              {/* Chat header */}
              <div className="border-b border-gray-100 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">
                    AI
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Clarifying Questions</p>
                    <p className="text-xs text-gray-400">
                      {canChat
                        ? 'Asking follow-ups based on your sliders'
                        : 'Save your sliders first to unlock the chat'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto space-y-4 px-5 py-4 min-h-[300px]">
                {!canChat && (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center space-y-2">
                      <span className="text-3xl">🎚️</span>
                      <p className="text-sm text-gray-500 max-w-[220px]">
                        Set your sliders and save to unlock the AI chat
                      </p>
                    </div>
                  </div>
                )}

                {canChat && messages.map(msg => (
                  <ChatBubble
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    memberName={session?.memberName ?? '?'}
                  />
                ))}
                {canChat && agentTyping && <TypingBubble />}

                {/* Chat complete CTA */}
                {chatComplete && !agentTyping && (
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 space-y-3">
                    <p className="text-sm font-medium text-indigo-900">
                      All done! Ready to review what was captured?
                    </p>
                    {extractError && <p className="text-xs text-red-600">{extractError}</p>}
                    <Button onClick={handleExtract} loading={extracting} className="w-full">
                      Review my preferences →
                    </Button>
                  </div>
                )}

                {/* Allow reviewing even before chat done once sliders are saved */}
                {!chatComplete && slidersSaved && messages.length > 0 && (
                  <div className="border-t border-gray-50 pt-3">
                    <button
                      type="button"
                      onClick={handleExtract}
                      disabled={extracting}
                      className="text-xs text-gray-400 hover:text-indigo-600 transition underline"
                    >
                      {extracting ? 'Reviewing…' : 'Skip chat & review now'}
                    </button>
                    {extractError && <p className="mt-1 text-xs text-red-500">{extractError}</p>}
                  </div>
                )}

                <div ref={chatBottomRef} />
              </div>

              {/* Chat input */}
              {canChat && !chatComplete && (
                <div className="border-t border-gray-100 px-4 py-3">
                  <div className="flex gap-2">
                    <textarea
                      rows={1}
                      className="flex-1 resize-none rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-32 disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder="Reply to the AI…"
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
          </div>
        </div>
      </main>
    </div>
  );
}
