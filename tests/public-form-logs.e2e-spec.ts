import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.module';

describe('Public Form Logger (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `admin-${Date.now()}@test.local`;
  const adminPassword = 'TestPassword!2026';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-secret-please-change-and-make-it-long-32+chars';
    process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:3000';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    const expressApp = app as unknown as NestExpressApplication;
    expressApp.set('trust proxy', 1);
    app.use(express.json({ limit: '102400b' }));
    app.use(cookieParser());
    expressApp.useStaticAssets(join(__dirname, '..', 'public'));
    expressApp.setBaseViewsDir(join(__dirname, '..', 'views'));
    expressApp.setViewEngine('ejs');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.enableVersioning({ type: VersioningType.URI });

    await app.init();

    prisma = app.get(PrismaService);

    // Clean DB before tests
    await prisma.publicFormLog.deleteMany();
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: 'admin',
      },
    });
  });

  afterAll(async () => {
    await prisma.publicFormLog.deleteMany();
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  const validBody = () => ({
    public_token: 'AbCdEfGhIjKlMnOp',
    submission_id: uuidv4(),
    form_payload: { email: 'user@test.com', name: 'Alice' },
    landing_page_url: 'https://choyou.fr/landing',
    utm_source: 'newsletter',
  });

  describe('POST /v1/public-form-logs', () => {
    it('happy path → 201 created', async () => {
      const body = validBody();
      const res = await request(app.getHttpServer())
        .post('/v1/public-form-logs')
        .send(body)
        .expect(201);
      expect(res.body.status).toBe('created');
      expect(typeof res.body.id).toBe('string');
    });

    it('empty form_payload → 400', async () => {
      const body = { ...validBody(), form_payload: {} };
      await request(app.getHttpServer()).post('/v1/public-form-logs').send(body).expect(400);
    });

    it('missing public_token → 400', async () => {
      const { public_token: _pt, ...body } = validBody();
      void _pt;
      await request(app.getHttpServer()).post('/v1/public-form-logs').send(body).expect(400);
    });

    it('duplicate submission_id → 200 duplicate', async () => {
      const body = validBody();
      const first = await request(app.getHttpServer())
        .post('/v1/public-form-logs')
        .send(body)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/v1/public-form-logs')
        .send(body)
        .expect(200);

      expect(second.body.status).toBe('duplicate');
      expect(second.body.id).toBe(first.body.id);
    });
  });

  describe('POST /admin/auth/login', () => {
    it('valid credentials → 200 + cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ email: adminEmail, password: adminPassword })
        .expect(200);
      expect(res.body.status).toBe('ok');
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(String(cookies)).toMatch(/pfl_admin_session=/);
    });

    it('invalid credentials → 401', async () => {
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ email: adminEmail, password: 'wrong' })
        .expect(401);
    });
  });

  describe('GET /health', () => {
    it('returns 200 ok', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
