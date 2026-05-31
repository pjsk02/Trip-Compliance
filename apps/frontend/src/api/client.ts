/// <reference types="vite/client" />
import type {
  CreateGroupResponse, JoinGroupResponse, Group,
  ChatResponse, ChatHistoryResponse, PreferenceProfileData,
  SliderValues, ConstraintFields, SaveSlidersResponse,
  GoogleVerifyResponse, MeResponse,
  BudgetStateResponse, BudgetRound, VoteResponse, LockBudgetResponse,
  Itinerary, SubmitFeedbackResponse, ItineraryListResponse,
  FinalizeResponse, FinalResponse,
} from '../types';

// ---------------------------------------------------------------------------
// Two token slots: user-level (long-lived, from Google auth) and
// member-level (group-scoped, issued after joining/creating a group).
// ---------------------------------------------------------------------------

let _userToken: string | null = (() => {
  try {
    const s = localStorage.getItem('ts_user_session');
    return s ? (JSON.parse(s) as { userToken: string }).userToken : null;
  } catch { return null; }
})();

let _memberToken: string | null = sessionStorage.getItem('ts_token');

export function setUserToken(t: string | null) {
  _userToken = t;
}

export function setToken(t: string | null) {
  _memberToken = t;
  if (t) sessionStorage.setItem('ts_token', t);
  else sessionStorage.removeItem('ts_token');
}

export function getToken() { return _memberToken; }

export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const BASE = BASE_URL;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  auth: 'none' | 'user' | 'member' = 'none',
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth === 'user' && _userToken)   headers['Authorization'] = `Bearer ${_userToken}`;
  if (auth === 'member' && _memberToken) headers['Authorization'] = `Bearer ${_memberToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Unknown error', data);
  return data as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Typed API methods
// ---------------------------------------------------------------------------

export const api = {
  // -- Auth -----------------------------------------------------------------

  googleVerify(credential: string) {
    return request<GoogleVerifyResponse>('POST', '/auth/google/verify', { credential });
  },

  getMe() {
    return request<MeResponse>('GET', '/auth/me', undefined, 'user');
  },

  // -- Groups (now require user token for create/join) ----------------------

  createGroup(payload: { name: string; destination?: string; password: string; startDate?: string; endDate?: string }) {
    return request<CreateGroupResponse>('POST', '/groups', payload, 'user');
  },

  setTripDates(code: string, startDate: string, endDate: string) {
    return request<{ startDate: string; endDate: string; tripDays: number; tripDuration: number }>(
      'PATCH', `/groups/${code}/set-dates`, { startDate, endDate }, 'member',
    );
  },

  joinGroup(code: string, payload: { password: string }) {
    return request<JoinGroupResponse>('POST', `/groups/${code}/join`, payload, 'user');
  },

  enterGroup(code: string) {
    return request<JoinGroupResponse>('POST', `/groups/${code}/enter`, {}, 'user');
  },

  getGroup(code: string) {
    return request<Group>('GET', `/groups/${code}`, undefined, 'member');
  },

  lockPreferences(code: string) {
    return request<{ status: string }>('POST', `/groups/${code}/lock-preferences`, {}, 'member');
  },

  unlockPreferences(code: string, confirm?: boolean) {
    return request<{ status?: string; downstreamCleared?: boolean; requiresConfirmation?: boolean; warning?: string }>(
      'POST', `/groups/${code}/unlock-preferences`, { confirm }, 'member',
    );
  },

  kickMember(code: string, memberId: string) {
    return request<{ removed: boolean; memberId: string }>(
      'DELETE', `/groups/${code}/members/${memberId}`, undefined, 'member',
    );
  },

  leaveGroup(code: string) {
    return request<{ left: boolean; groupDeleted: boolean }>(
      'POST', `/groups/${code}/leave`, {}, 'member',
    );
  },

  triggerPlanning(code: string) {
    return request<{ status: string }>('POST', `/groups/${code}/trigger-planning`, {}, 'member');
  },

  // -- Member preference flow (member token) --------------------------------

  getChatHistory(memberId: string) {
    return request<ChatHistoryResponse>('GET', `/members/${memberId}/chat`, undefined, 'member');
  },

  saveSliders(memberId: string, sliderValues: SliderValues, constraintFields: ConstraintFields) {
    return request<SaveSlidersResponse>(
      'POST', `/members/${memberId}/save-sliders`,
      { sliderValues, constraintFields },
      'member',
    );
  },

  sendChat(memberId: string, message: string) {
    return request<ChatResponse>('POST', `/members/${memberId}/chat`, { message }, 'member');
  },

  finalizePreferences(memberId: string) {
    return request<{ profile: PreferenceProfileData }>(
      'POST', `/members/${memberId}/finalize-preferences`, {}, 'member',
    );
  },

  submitMemberBudget(memberId: string, totalBudget: number) {
    return request<{ ok: boolean }>('PATCH', `/members/${memberId}/budget`, { totalBudget }, 'member');
  },

  // -- Budget Negotiation (Layer 3) -----------------------------------------

  getBudgetState(code: string) {
    return request<BudgetStateResponse>('GET', `/groups/${code}/budget`, undefined, 'member');
  },

  analyzeBudget(code: string) {
    return request<{ round: BudgetRound }>('POST', `/groups/${code}/budget/analyze`, {}, 'member');
  },

  voteBudget(code: string, choice: 'APPROVE' | 'REJECT', comment?: string) {
    return request<VoteResponse>('POST', `/groups/${code}/budget/vote`, { choice, comment }, 'member');
  },

  reproposeBudget(code: string) {
    return request<{ round: BudgetRound }>('POST', `/groups/${code}/budget/repropose`, {}, 'member');
  },

  lockBudget(code: string) {
    return request<LockBudgetResponse>('POST', `/groups/${code}/budget/lock`, {}, 'member');
  },

  // -- Itinerary (Layer 4 + 5) ----------------------------------------------

  generateItinerary(code: string, tripDuration: number, maxNegotiationRounds?: number) {
    return request<Itinerary>('POST', `/groups/${code}/generate-itinerary`,
      { tripDuration, maxNegotiationRounds }, 'member');
  },

  listItineraries(code: string) {
    return request<ItineraryListResponse>('GET', `/groups/${code}/itineraries`, undefined, 'member');
  },

  getItinerary(code: string) {
    return request<Itinerary>('GET', `/groups/${code}/itinerary`, undefined, 'member');
  },

  getItineraryVersion(code: string, version: number) {
    return request<Itinerary>('GET', `/groups/${code}/itineraries/${version}`, undefined, 'member');
  },

  adminApproveItinerary(code: string) {
    return request<{ approved: boolean; itineraryId: string; version: number }>(
      'POST', `/groups/${code}/admin-approve-itinerary`, {}, 'member',
    );
  },

  nudgeMembers(code: string) {
    return request<{ nudged: Array<{ id: string; name: string; status: string }>; message: string; shareCode: string; groupName: string }>(
      'POST', `/groups/${code}/nudge-members`, {}, 'member',
    );
  },

  setDeadline(code: string, deadline: string) {
    return request<{ deadline: string | null }>(
      'PATCH', `/groups/${code}/set-deadline`, { deadline }, 'member',
    );
  },

  submitFeedback(code: string, text: string, tripDuration: number, itineraryVersion?: number) {
    return request<SubmitFeedbackResponse>(
      'POST', `/groups/${code}/feedback`,
      { text, tripDuration, itineraryVersion },
      'member',
    );
  },

  // -- Finalization ----------------------------------------------------------

  finalizeTrip(code: string, itineraryId: string) {
    return request<FinalizeResponse>(
      'POST', `/groups/${code}/finalize`, { itineraryId }, 'member',
    );
  },

  unfinalizeTrip(code: string) {
    return request<{ unfinalized: boolean }>(
      'POST', `/groups/${code}/unfinalize`, {}, 'member',
    );
  },

  getFinalItinerary(code: string) {
    return request<FinalResponse>('GET', `/groups/${code}/final`, undefined, 'member');
  },
};
