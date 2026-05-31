import { customAlphabet } from 'nanoid';
import { prisma } from './prisma';

// Destination word list — short, memorable, travel-themed.
const DESTINATIONS = [
  'BALI', 'OSLO', 'LIMA', 'ROME', 'KYOTO', 'CAIRO', 'DUBAI',
  'PARIS', 'SEOUL', 'RIGA', 'CAPE', 'PISA', 'NICE', 'KONA',
];

const digits = customAlphabet('0123456789', 4);

export async function generateUniqueGroupCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const word = DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)];
    const code = `${word}-${digits()}`;
    const exists = await prisma.group.findUnique({ where: { groupCode: code } });
    if (!exists) return code;
  }
  // Fallback: pure random 8-char alphanumeric
  const fallback = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);
  return fallback();
}
