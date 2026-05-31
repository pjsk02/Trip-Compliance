export type PreferenceStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE';
export type GroupStatus = 'COLLECTING' | 'BUDGET_NEGOTIATION' | 'PLANNING' | 'COMPLETE';

export interface Member {
  id: string;
  name: string;
  isAdmin: boolean;
  preferenceStatus: PreferenceStatus;
  joinedAt: string;
  privateBudget?: number | null;
}

export interface Group {
  id: string;
  name: string;
  groupCode: string;
  destination: string | null;
  adminMemberId: string | null;
  status: GroupStatus;
  lockedBudget: string | null;
  createdAt: string;
  members: Member[];
}

export interface Session {
  token: string;
  memberId: string;
  groupId: string;
  isAdmin: boolean;
  memberName: string;
  groupCode: string;
}

// Preference types
export interface PreferenceScores {
  activities: { hiking: number; nightlife: number; museums: number; beaches: number; adventure: number };
  food: { streetFood: number; fineDining: number; localCuisine: number; dietary: Record<string, number>; alcohol: number };
  logistics: { flightComfort: number; accommodationType: Record<string, number>; pace: number; budgetSplit: number; transport: Record<string, number> };
  constraints: { hardBudgetCap: number; mobility: number; schedule: number; visa: number };
}

export interface PreferencePriorities {
  mustHave: string[];
  niceToHave: string[];
  neutral: string[];
  avoid: string[];
}

export interface PreferenceProfileData {
  scores: PreferenceScores;
  priorities: PreferencePriorities;
}

export interface CategoryCoverage {
  activities: boolean;
  food: boolean;
  logistics: boolean;
  constraints: boolean;
}

export interface ChatMessageData {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
}

export interface ChatResponse {
  reply: string;
  complete: boolean;
  coverage: CategoryCoverage;
}

export interface ChatHistoryResponse {
  messages: ChatMessageData[];
  coverage: CategoryCoverage;
  preferenceStatus: PreferenceStatus; // includes COMPLETE — page redirects when this arrives
}

// API response shapes
export interface CreateGroupResponse {
  groupCode: string;
  password: string;
  token: string;
  member: { id: string; name: string; isAdmin: boolean };
}

export interface JoinGroupResponse {
  token: string;
  member: { id: string; name: string; isAdmin: boolean };
  group: { id: string; name: string; destination: string | null; status: GroupStatus };
}
