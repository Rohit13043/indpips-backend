import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { signToken } from '../auth/jwt.js';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().optional(),
  ref: z.string().optional(),      // referrer's referral code
  channel: z.string().optional(),  // acquisition channel (utm)
});

function makeReferralCode(): string {
  return 'IND' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

authRouter.post('/register', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, fullName, ref, channel } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  // Resolve the referrer (if a valid code was supplied).
  let referredById: string | undefined;
  if (ref) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: ref } });
    if (referrer) referredById = referrer.id;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      referralCode: makeReferralCode(),
      referredById,
      signupChannel: referredById ? 'affiliate' : (channel || 'organic'),
    },
  });

  const token = signToken({ sub: user.id, role: user.role, email: user.email });
  res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

authRouter.post('/login', async (req, res) => {
  const parsed = credentials.pick({ email: true, password: true }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken({ sub: user.id, role: user.role, email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});
