/**
 * Seed/upsert the admin user from ADMIN_EMAIL / ADMIN_PASSWORD env variables.
 * Idempotent: if the email already exists, only the password is updated when
 * --reset-password is passed; otherwise nothing is written.
 *
 * Usage:
 *   npx ts-node scripts/seed-admin.ts
 *   npx ts-node scripts/seed-admin.ts --reset-password
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

async function main(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const resetPassword = process.argv.includes('--reset-password');

  if (!email || !password) {
    throw new Error('[seed-admin] ADMIN_EMAIL and ADMIN_PASSWORD must be set.');
  }
  if (password.length < 8) {
    throw new Error('[seed-admin] ADMIN_PASSWORD must be at least 8 characters.');
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.adminUser.findUnique({ where: { email } });

    if (!existing) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const created = await prisma.adminUser.create({
        data: { email, passwordHash, role: 'admin' },
      });
      // eslint-disable-next-line no-console
      console.log(`[seed-admin] Created admin user ${created.email} (id=${created.id})`);
      return;
    }

    if (resetPassword) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await prisma.adminUser.update({ where: { email }, data: { passwordHash } });
      // eslint-disable-next-line no-console
      console.log(`[seed-admin] Password reset for ${email}`);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[seed-admin] Admin user ${email} already exists. Use --reset-password to update.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-admin] fatal:', err);
  process.exit(1);
});
