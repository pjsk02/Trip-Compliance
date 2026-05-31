import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { groupsRouter } from './routes/groups';
import { membersRouter } from './routes/members';
import { budgetRouter } from './routes/budget';
import { itineraryRouter } from './routes/itinerary';
import { initWeave } from './lib/weave';

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tripsync-backend' });
});

app.use('/auth', authRouter);
app.use('/groups', groupsRouter);
app.use('/members', membersRouter);
app.use('/groups', budgetRouter);
app.use('/groups', itineraryRouter);

// Only start listening when run directly, not when imported by tests.
if (require.main === module) {
  initWeave().then(() => {
    app.listen(port, () => {
      console.log(`Backend running at http://localhost:${port}`);
    });
  });
}

export { app };
