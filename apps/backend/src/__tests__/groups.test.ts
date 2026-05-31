import 'dotenv/config';
import request from 'supertest';
import { app } from '../index';
import { prisma } from '../lib/prisma';

// Use a fixed test JWT secret so tests don't require a .env file.
process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';

// Clean up any groups created by these tests between runs.
afterAll(async () => {
  await prisma.group.deleteMany({ where: { name: { startsWith: '__test__' } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// POST /groups — create
// ---------------------------------------------------------------------------

describe('POST /groups', () => {
  it('creates a group and returns groupCode, password, and a JWT', async () => {
    const res = await request(app).post('/groups').send({
      name: '__test__ Beach Trip',
      destination: 'Miami',
      adminName: 'Alice',
      password: 'secret99',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      groupCode: expect.stringMatching(/^[A-Z]+-\d{4}$/),
      password: 'secret99',
      token: expect.any(String),
      member: { name: 'Alice', isAdmin: true },
    });
  });

  it('rejects a request missing adminName', async () => {
    const res = await request(app).post('/groups').send({
      name: '__test__ Bad Group',
      password: 'pw1234',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('rejects a password shorter than 4 characters', async () => {
    const res = await request(app).post('/groups').send({
      name: '__test__ Short PW',
      adminName: 'Bob',
      password: 'abc',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /groups/:code/join
// ---------------------------------------------------------------------------

describe('POST /groups/:code/join', () => {
  let groupCode: string;
  const PASSWORD = 'joinpass1';

  beforeAll(async () => {
    const res = await request(app).post('/groups').send({
      name: '__test__ Join Group',
      adminName: 'Admin',
      password: PASSWORD,
    });
    groupCode = res.body.groupCode;
  });

  it('joins with correct code + password and returns a token', async () => {
    const res = await request(app)
      .post(`/groups/${groupCode}/join`)
      .send({ name: 'Priya', password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      token: expect.any(String),
      member: { name: 'Priya', isAdmin: false },
      group: { name: '__test__ Join Group' },
    });
  });

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post(`/groups/${groupCode}/join`)
      .send({ name: 'Hacker', password: 'wrongpass' });

    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown group code', async () => {
    const res = await request(app)
      .post('/groups/FAKE-9999/join')
      .send({ name: 'Ghost', password: 'anything' });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /groups/:code — roster
// ---------------------------------------------------------------------------

describe('GET /groups/:code', () => {
  let groupCode: string;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    const create = await request(app).post('/groups').send({
      name: '__test__ Roster Group',
      adminName: 'Admin',
      password: 'roster99',
    });
    groupCode = create.body.groupCode;
    adminToken = create.body.token;

    const join = await request(app)
      .post(`/groups/${groupCode}/join`)
      .send({ name: 'Member', password: 'roster99' });
    memberToken = join.body.token;
  });

  it('returns group state and members for an authenticated member', async () => {
    const res = await request(app)
      .get(`/groups/${groupCode}`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(2);
    // privateBudget must NOT be visible to a regular member
    expect(res.body.members[0].privateBudget).toBeUndefined();
  });

  it('exposes privateBudget to the admin', async () => {
    const res = await request(app)
      .get(`/groups/${groupCode}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Field exists (even if null) for admins
    expect('privateBudget' in res.body.members[0]).toBe(true);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get(`/groups/${groupCode}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Admin-only state transitions
// ---------------------------------------------------------------------------

describe('Admin-only endpoints', () => {
  let groupCode: string;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    const create = await request(app).post('/groups').send({
      name: '__test__ State Group',
      adminName: 'Admin',
      password: 'state123',
    });
    groupCode = create.body.groupCode;
    adminToken = create.body.token;

    const join = await request(app)
      .post(`/groups/${groupCode}/join`)
      .send({ name: 'Regular', password: 'state123' });
    memberToken = join.body.token;
  });

  it('non-admin cannot lock preferences', async () => {
    const res = await request(app)
      .post(`/groups/${groupCode}/lock-preferences`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  it('admin can lock preferences (COLLECTING → BUDGET_NEGOTIATION)', async () => {
    const res = await request(app)
      .post(`/groups/${groupCode}/lock-preferences`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('BUDGET_NEGOTIATION');
  });

  it('admin can trigger planning (BUDGET_NEGOTIATION → PLANNING)', async () => {
    const res = await request(app)
      .post(`/groups/${groupCode}/trigger-planning`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PLANNING');
  });

  it('cannot lock-preferences again once past COLLECTING', async () => {
    const res = await request(app)
      .post(`/groups/${groupCode}/lock-preferences`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });
});
