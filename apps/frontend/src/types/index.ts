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
