import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.VITE_API_URL ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tripsync-backend' });
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
