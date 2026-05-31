/// <reference types="vite/client" />
import type {
  CreateGroupResponse, JoinGroupResponse, Group,
  ChatResponse, ChatHistoryResponse, PreferenceProfileData,
} from '../types';

// Token is kept in a module-level variable (survives React re-renders, dies on
// hard refresh). We also mirror it into a short-lived sessionStorage entry so a
// same-tab page refresh can restore it. sessionStorage is cleared when the tab
// is closed, making it safer than localStorage for sandboxed contexts.
let _token: string | null = sessionStorage.getItem('ts_token');

export function setToken(t: string | null) {
  _token = t;
  if (t) sessionStorage.setItem('ts_token', t);
  else sessionStorage.removeItem('ts_token');
}

export function getToken() {
  return _token;
}

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  authenticated = false,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authenticated && _token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'Unknown error', data);
  }
  return data as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Typed API methods
// ---------------------------------------------------------------------------

export const api = {
  createGroup(payload: {
    name: string;
    destination?: string;
    adminName: string;
    password: string;
  }) {
    return request<CreateGroupResponse>('POST', '/groups', payload);
  },

  joinGroup(code: string, payload: { name: string; password: string }) {
    return request<JoinGroupResponse>('POST', `/groups/${code}/join`, payload);
  },

  getGroup(code: string) {
    return request<Group>('GET', `/groups/${code}`, undefined, true);
  },

  lockPreferences(code: string) {
    return request<{ status: string }>('POST', `/groups/${code}/lock-preferences`, {}, true);
  },

  triggerPlanning(code: string) {
    return request<{ status: string }>('POST', `/groups/${code}/trigger-planning`, {}, true);
  },

  getChatHistory(memberId: string) {
    return request<ChatHistoryResponse>('GET', `/members/${memberId}/chat`, undefined, true);
  },

  sendChat(memberId: string, message: string) {
    return request<ChatResponse>('POST', `/members/${memberId}/chat`, { message }, true);
  },

  finalizePreferences(memberId: string) {
    return request<{ profile: PreferenceProfileData }>('POST', `/members/${memberId}/finalize-preferences`, {}, true);
  },
};
