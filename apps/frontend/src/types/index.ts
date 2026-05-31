export type PreferenceStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE';
export type GroupStatus = 'COLLECTING' | 'BUDGET_NEGOTIATION' | 'PLANNING' | 'COMPLETE';

export interface User {
  id:        string;
  email:     string;
  name:      string;
  avatarUrl: string | null;
}

export interface Membership {
  memberId:         string;
  isAdmin:          boolean;
  preferenceStatus: PreferenceStatus;
  joinedAt:         string;
  group: {
    id:            string;
    name:          string;
    groupCode:     string;
    destination:   string | null;
    status:        GroupStatus;
    adminMemberId: string | null;
  };
}

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
  submissionDeadline: string | null;
  createdAt: string;
  members: Member[];
}

/** User-level session — persisted across groups. */
export interface UserSession {
  userToken: string;
  user: User;
}

/** Group-scoped session — set after entering a specific group. */
export interface Session {
  token: string;
  memberId: string;
  groupId: string;
  isAdmin: boolean;
  memberName: string;
  groupCode: string;
}

// ---------------------------------------------------------------------------
// Slider values — 1-10 from UI, converted to 0-100 before sending to backend
// ---------------------------------------------------------------------------

export interface SliderValues {
  activities: {
    hiking:    number; // 0-100
    nightlife: number;
    museums:   number;
    beaches:   number;
    adventure: number;
  };
  food: {
    streetFood:   number;
    fineDining:   number;
    localCuisine: number;
  };
  logistics: {
    pace:                number; // 0=relaxed, 100=packed
    flightComfort:       number;
    budgetConsciousness: number;
  };
}

export type AlcoholPreference = 'yes' | 'no' | 'sometimes';

export interface ConstraintFields {
  dietaryRestrictions: string[];
  dietaryOther?: string;
  alcoholPreference: AlcoholPreference;
  hardBudgetCap?: number;
  totalBudget?: number;
  mobilityLimitations?: string;
  scheduleRestrictions?: string;
  visaRestrictions?: string;
  mustAvoidActivities?: string;
}

// ---------------------------------------------------------------------------
// Step coverage — replaces CategoryCoverage as the progress indicator
// ---------------------------------------------------------------------------

export interface StepCoverage {
  slidersSet:        boolean;
  constraintsFilled: boolean;
  chatDone:          boolean;
}

// Legacy — kept for backward compat with detectCoverage on the backend
export interface CategoryCoverage {
  activities:  boolean;
  food:        boolean;
  logistics:   boolean;
  constraints: boolean;
}

// ---------------------------------------------------------------------------
// Preference profile
// ---------------------------------------------------------------------------

export interface PreferenceScores {
  activities: { hiking: number; nightlife: number; museums: number; beaches: number; adventure: number };
  food: { streetFood: number; fineDining: number; localCuisine: number; dietary: Record<string, number>; alcohol: number };
  logistics: { flightComfort: number; accommodationType: Record<string, number>; pace: number; budgetSplit: number; transport: Record<string, number>; budgetConsciousness: number };
  constraints: { hardBudgetCap: number; mobility: number; schedule: number; visa: number };
}

export interface PreferencePriorities {
  mustHave:   string[];
  niceToHave: string[];
  neutral:    string[];
  avoid:      string[];
}

export interface PreferenceProfileData {
  scores:           PreferenceScores;
  priorities:       PreferencePriorities;
  sliderValues?:    SliderValues | null;
  constraintFields?: ConstraintFields | null;
  chatNuance?:      string | null;
}

// ---------------------------------------------------------------------------
// Chat types
// ---------------------------------------------------------------------------

export interface ChatMessageData {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
}

export interface ChatResponse {
  reply:    string;
  complete: boolean;
  coverage: CategoryCoverage;
}

export interface ChatHistoryResponse {
  messages:         ChatMessageData[];
  coverage:         CategoryCoverage;
  preferenceStatus: PreferenceStatus;
  sliderValues?:    SliderValues | null;
  constraintFields?: ConstraintFields | null;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface GoogleVerifyResponse {
  token: string;
  user:  User;
}

export interface MeResponse {
  user:        User;
  memberships: Membership[];
}

export interface CreateGroupResponse {
  groupCode: string;
  password:  string;
  token:     string;
  member:    { id: string; name: string; isAdmin: boolean };
}

export interface JoinGroupResponse {
  token:  string;
  member: { id: string; name: string; isAdmin: boolean };
  group:  { id: string; name: string; destination: string | null; status: GroupStatus };
}

export interface SaveSlidersResponse {
  scores:     PreferenceScores;
  priorities: PreferencePriorities;
}

// ---------------------------------------------------------------------------
// Budget Negotiation (Layer 3)
// ---------------------------------------------------------------------------

export type VoteChoice = 'APPROVE' | 'REJECT';
export type BudgetStrategy = 'consensus' | 'tiered' | 'scope_reduction';

export interface BudgetVoteRecord {
  id:       string;
  memberId: string;
  name:     string;
  choice:   VoteChoice;
  /** Only present on REJECT votes that included a comment. */
  comment:  string | null;
  castAt:   string;
}

export interface BudgetTierSplit {
  highTier: { label: string; amount: number };
  lowTier:  { label: string; amount: number };
  rationale: string;
}

export interface BudgetRound {
  id:        string;
  roundNum:  number;
  /** Proposed group total in USD — authoritative, computed in code. */
  proposed:  number;
  /** Per-person share — authoritative, computed in code as proposed / groupSize. */
  perPerson: number;
  rationale: string;
  /** Short chat-bubble summary from the Budget Bot. */
  summary:   string;
  strategy:  BudgetStrategy;
  tierSplit: BudgetTierSplit | null;
  /** Aggregate stats only — no individual budget reveals. */
  stats: {
    median: number;
    range:  [number, number];
  };
  createdAt: string;
  votes:     BudgetVoteRecord[];
}

export interface BudgetStateResponse {
  groupStatus:          GroupStatus;
  lockedBudget:         number | null;
  totalMembers:         number;
  membersWithoutBudget: Array<{ id: string; name: string }>;
  rounds:               BudgetRound[];
  currentRound:         BudgetRound | null;
}

export interface VoteResponse {
  round:        BudgetRound;
  consensus:    boolean;
  approveCount: number;
  rejectCount:  number;
  totalMembers: number;
  allVoted:     boolean;
}

export interface LockBudgetResponse {
  lockedBudget: number;
  status:       GroupStatus;
  approveCount: number;
  totalMembers: number;
}

// ---------------------------------------------------------------------------
// Itinerary (Layer 4)
// ---------------------------------------------------------------------------

export type TimeBlock = 'morning' | 'afternoon' | 'evening';

export interface ScheduledBlock {
  timeBlock:                 TimeBlock;
  type:                      'activity' | 'meal' | 'travel' | 'free';
  title:                     string;
  venue:                     string;
  location:                  string;
  estimatedCostPerPersonUsd: number;
  travelTimeMinutes?:        number;
  durationHours?:            number;
  /** memberId → preference labels served */
  servesPreferences:         Record<string, string[]>;
  notes?:                    string;
}

export interface DayPlan {
  day:                      number;
  date?:                    string;
  theme:                    string;
  blocks:                   ScheduledBlock[];
  dayTotalCostPerPersonUsd: number;
}

export interface BudgetBreakdownLine {
  category:                  string;
  estimatedCostPerPersonUsd: number;
  totalGroupUsd:             number;
  pctOfBudget:               number;
}

export interface BudgetBreakdown {
  lines:             BudgetBreakdownLine[];
  totalPerPersonUsd: number;
  totalGroupUsd:     number;
  lockedBudgetUsd:   number;
  surplus:           number;
  notes:             string;
}

export interface PerMemberScore {
  memberId:            string;   // User.id
  memberRecordId:      string;   // Member.id
  memberName:          string;
  satisfactionPct:     number;
  mustHaveFulfilled:   string[];
  niceToHaveFulfilled: string[];
  unmetMustHave:       string[];
}

export interface SatisfactionScores {
  perMember:            PerMemberScore[];
  groupSatisfactionPct: number;
  fairnessScore:        number;
  fairnessFloorMet:     boolean;
}

export interface AgentTimelineEntry {
  agent:         string;
  wave:          1 | 2 | 3;
  startedAt:     number;
  completedAt:   number;
  durationMs:    number;
  status:        'ok' | 'repaired' | 'fallback';
  outputSummary: string;
}

export interface DecisionAuditEntry {
  decision:  string;
  chosen:    string;
  rejected:  string[];
  reason:    string;
  scores?:   Record<string, number>;
}

export interface Itinerary {
  id:                 string;
  version:            number;
  dayPlans:           DayPlan[];
  budgetBreakdown:    BudgetBreakdown;
  satisfactionScores: SatisfactionScores;
  tradeoffReport:     string;
  adminOverrideFlag:  boolean;
  negotiationRounds:  number;
  generatedAt:        string;
  createdAt:          string;
  feedback?:          FeedbackRecord[];
  agentTimeline?:     AgentTimelineEntry[];
  decisionAudit?:     DecisionAuditEntry[];
  weaveTraceUrl?:     string;
}

// ---------------------------------------------------------------------------
// Feedback & replanning (Layer 5)
// ---------------------------------------------------------------------------

export type FeedbackType =
  | 'ACTIVITY_REWEIGHT'
  | 'BUDGET_CUT'
  | 'TRANSPORT_VETO'
  | 'PREFERENCE_CHANGE';

export interface FeedbackRecord {
  id:          string;
  memberId:    string;
  member:      { id: string; name: string };
  rawText:     string;
  type:        FeedbackType;
  targetAgent: string;
  createdAt:   string;
}

export interface SubmitFeedbackResponse {
  itineraryId:       string;
  version:           number;
  feedbackType:      FeedbackType;
  targetAgent:       string;
  feedbackSummary:   string;
  adminOverrideFlag: boolean;
  consensusStatus:   string;
  dayPlans:          DayPlan[];
  budgetBreakdown:   BudgetBreakdown;
  satisfactionScores: SatisfactionScores;
  tradeoffReport:    string;
  durationMs:        number;
}

export interface ItineraryListResponse {
  itineraries: Itinerary[];
}
