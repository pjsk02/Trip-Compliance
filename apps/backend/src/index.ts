import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { groupsRouter } from './routes/groups';
import { membersRouter } from './routes/members';

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.VITE_API_URL ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tripsync-backend' });
});

app.use('/groups', groupsRouter);
app.use('/members', membersRouter);

// Only start listening when run directly, not when imported by tests.
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Backend running at http://localhost:${port}`);
  });
}

export { app };
