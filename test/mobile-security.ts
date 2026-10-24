import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import { AuthModule } from '../src/auth/auth.module';
import { UsersModule } from '../src/users/users.module';
import { PrivacyModule } from '../src/privacy/privacy.module';
import { SecurityModule } from '../src/security/security.module';
import { SecurityService } from '../src/security/security.service';
import { User } from '../src/users/entities/user.entity';
import { Role } from '../src/common/enums/roles.enum';
import { hashPassword } from '../src/common/utils/crypto.util';
import { UsersService } from '../src/users/users.service';
import { StudiesModule } from '../src/studies/studies.module';
import { Study } from '../src/studies/entities/study.entity';
import { StudyDetail, StudyDetailType } from '../src/studies/entities/study-detail.entity';

// This test creates accounts and a schema. It must never target production.
if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DATABASE_HOST ?? '') ||
    !process.env.DATABASE_NAME?.endsWith('_test') || process.env.NODE_ENV !== 'test') {
  throw new Error('Seguridad: se exige PostgreSQL local, base terminada en _test y NODE_ENV=test. No se leyó .env.');
}
process.env.JWT_SECRET ||= randomBytes(32).toString('hex');
process.env.GOOGLE_CLIENT_ID ||= 'local-qa';
process.env.GOOGLE_CLIENT_SECRET ||= 'local-qa';
process.env.GOOGLE_CALLBACK_URL ||= 'http://127.0.0.1:3109/api/auth/google/callback';

@Module({ imports: [
  ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
  TypeOrmModule.forRoot({
    type: 'postgres', host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER, password: process.env.DATABASE_PASS,
    database: process.env.DATABASE_NAME, autoLoadEntities: true, synchronize: true, logging: false,
  }),
  AuthModule, UsersModule, PrivacyModule, SecurityModule, StudiesModule,
] })
class SecurityTestModule {}

async function run() {
  mkdirSync('reports/mobile-security', { recursive: true });
  const app = await NestFactory.create(SecurityTestModule, { logger: false });
  const security = app.get(SecurityService);
  const helmet = require('helmet') as typeof import('helmet');
  app.use(helmet.default(security.buildHelmetConfig()));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.setGlobalPrefix('api');
  await app.listen(Number(process.env.PORT ?? 3109), '127.0.0.1');
  const db = app.get(DataSource);
  const base = `${await app.getUrl()}/api`;
  const password = process.env.SECURITY_QA_UI_PASSWORD ?? randomBytes(24).toString('base64url');
  const suffix = randomBytes(5).toString('hex');
  const repo = db.getRepository(User);
  const created: User[] = [];
  const cases: { name: string; passed: boolean; detail?: string }[] = [];
  async function account(rol: Role, email = `qa-${rol}-${suffix}@example.test`) {
    const user = await repo.save(repo.create({ nombre: 'QA Seguridad', email, password: await hashPassword(password), rol, confirmed: true }));
    created.push(user); return user;
  }
  async function request(path: string, method = 'GET', token?: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const content = await response.text();
    let data: any; try { data = JSON.parse(content); } catch { data = content; }
    return { status: response.status, data, headers: response.headers };
  }
  async function login(user: User, mobile = true) {
    const result = await request('/auth/login', 'POST', undefined, { email: user.email, password, ...(mobile ? { mobile: true } : {}) });
    assert.equal(result.status, 201); return result.data;
  }
  async function test(name: string, check: () => Promise<void>) {
    try { await check(); cases.push({ name, passed: true }); console.log(`OK ${name}`); }
    catch (error) {
      // Keep assertions and credentials out of public reports; the named case is reproducible.
      const detail = error instanceof Error ? `${error.name}: ${error.message.slice(0, 240).replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')}` : 'Error';
      cases.push({ name, passed: false, detail });
      console.error(`FALLO ${name}`); process.exitCode = 1;
    }
  }
  try {
    const admin = await account(Role.Admin);
    const staff = await account(Role.Recepcionista);
    let session: any;
    await test('Acceso anónimo y JWT alterado rechazados', async () => {
      assert.equal((await request('/profile')).status, 401);
      assert.equal((await request('/privacy/preferences', 'GET', 'invalid.jwt.token')).status, 401);
      assert.ok([401, 403].includes((await request('/account', 'DELETE')).status));
    });
    await test('Validación de cuerpos y refresh malformado', async () => {
      assert.equal((await request('/auth/login', 'POST', undefined, { email: 'bad', password: 'x' })).status, 400);
      assert.equal((await request('/auth/refresh', 'POST', undefined, { refreshToken: 'invalid' })).status, 400);
    });
    await test('Login móvil usa JWT corto y refresh opaco; web conserva contrato', async () => {
      session = await login(staff);
      const claims = jwt.verify(session.token, process.env.JWT_SECRET!) as jwt.JwtPayload;
      assert.equal(claims.exp! - claims.iat!, 900);
      assert.match(session.refreshToken, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
      const legacy = await login(staff, false);
      assert.equal(legacy.refreshToken, undefined);
      const webClaims = jwt.verify(legacy.token, process.env.JWT_SECRET!) as jwt.JwtPayload;
      assert.equal(webClaims.exp! - webClaims.iat!, 30 * 24 * 3600);
    });
    await test('Perfil propio sin hash; aliases GET y PUT con sobreasignación rechazada', async () => {
      for (const path of ['/profile', '/users/me']) {
        const result = await request(path, 'GET', session.token);
        assert.equal(result.status, 200); assert.equal(String(result.data.id), String(staff.id));
        assert.equal(result.data.password, undefined);
        assert.match(result.headers.get('cache-control') ?? '', /no-store/i);
      }
      assert.equal((await request('/profile', 'PUT', session.token, { rol: 'admin' })).status, 400);
      assert.equal((await request('/profile', 'PUT', session.token, { nombre: 'QA Actualizada' })).status, 200);
    });
    await test('Refresh rota y solo almacena hashes; token anterior revoca la familia', async () => {
      const renewed = await request('/auth/refresh', 'POST', undefined, { refreshToken: session.refreshToken });
      assert.equal(renewed.status, 201); assert.notEqual(renewed.data.refreshToken, session.refreshToken);
      const [{ token_hash }] = await db.query('SELECT token_hash FROM mobile_refresh_tokens ORDER BY created_at DESC LIMIT 1');
      assert.match(token_hash, /^[a-f0-9]{64}$/); assert.notEqual(token_hash, renewed.data.refreshToken);
      assert.equal((await request('/auth/refresh', 'POST', undefined, { refreshToken: session.refreshToken })).status, 401);
      assert.equal((await request('/profile', 'GET', renewed.data.token)).status, 401);
      session = await login(staff);
    });
    await test('JWT expirado rechazado y sesión renovable con credencial independiente', async () => {
      const claims = jwt.decode(session.token) as jwt.JwtPayload;
      const expired = jwt.sign({ sub: claims.sub, jti: claims.jti, exp: Math.floor(Date.now() / 1000) - 1 }, process.env.JWT_SECRET!);
      assert.equal((await request('/profile', 'GET', expired)).status, 401);
      const renewed = await request('/auth/refresh', 'POST', undefined, { refreshToken: session.refreshToken });
      assert.equal(renewed.status, 201); session = renewed.data;
    });
    await test('Logout revoca también refresh sin depender de un access token vigente', async () => {
      assert.equal((await request('/auth/mobile/logout', 'POST', undefined, { refreshToken: session.refreshToken })).status, 201);
      assert.equal((await request('/auth/refresh', 'POST', undefined, { refreshToken: session.refreshToken })).status, 401);
      session = await login(staff);
    });
    await test('Refresh concurrente no reutiliza una credencial de un solo uso', async () => {
      const concurrent = await Promise.all([0, 1].map(() => request('/auth/refresh', 'POST', undefined, { refreshToken: session.refreshToken })));
      assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 401]);
      const issued = concurrent.find(r => r.status === 201)!;
      assert.equal((await request('/profile', 'GET', issued.data.token)).status, 401);
      session = await login(staff);
    });
    await test('Aviso público accesible sin autenticación y con contacto real', async () => {
      const result = await request('/privacy/notice'); assert.equal(result.status, 200);
      assert.equal(result.data.ready, true); assert.equal(result.data.supportEmail, '20230009@uthh.edu.mx');
      const html = await request('/privacy'); assert.equal(html.status, 200); assert.match(html.data, /<!doctype html>/i);
      assert.equal((await request('/privacy/account-deletion')).status, 200);
    });
    await test('Consentimiento ausente y opciones desactivadas por defecto', async () => {
      const preferences = await request('/privacy/preferences', 'GET', session.token);
      assert.equal(preferences.data.acceptedAt, null); assert.equal(preferences.data.optionalAnalytics, false);
      assert.equal(preferences.data.optionalCommunications, false);
      assert.equal((await request('/privacy/preferences', 'PATCH', session.token, { optionalAnalytics: true })).status, 400);
      assert.equal((await request('/privacy/preferences', 'PATCH', session.token, { userId: admin.id })).status, 400);
    });
    await test('Opt-in con versión y oposición persistida; versión incorrecta rechazada', async () => {
      const notice = (await request('/privacy/notice')).data;
      assert.equal((await request('/privacy/preferences', 'PATCH', session.token, { consent: 'false', noticeVersion: notice.version })).status, 400);
      assert.equal((await request('/privacy/preferences', 'PATCH', session.token, { consent: true, noticeVersion: 'old' })).status, 400);
      const accepted = await request('/privacy/preferences', 'PATCH', session.token, { consent: true, noticeVersion: notice.version, optionalCommunications: true });
      assert.equal(accepted.status, 200); assert.ok(accepted.data.acceptedAt);
      assert.equal((await request('/privacy/preferences', 'PATCH', session.token, { optionalCommunications: false })).status, 200);
      assert.equal((await request('/privacy/preferences', 'GET', session.token)).data.optionalCommunications, false);
    });
    await test('Cancelación exige confirmación y protege al último administrador', async () => {
      const activeAdmin = await login(admin);
      assert.equal((await request('/account', 'DELETE', activeAdmin.token, { currentPassword: password, confirmation: 'NO' })).status, 400);
      assert.equal((await request('/account', 'DELETE', activeAdmin.token, { currentPassword: password, confirmation: 'ELIMINAR MI CUENTA' })).status, 409);
    });
    await test('Cancelación propia elimina cuenta, sesiones, preferencias y logs asociados', async () => {
      const result = await request('/account', 'DELETE', session.token, { currentPassword: password, confirmation: 'ELIMINAR MI CUENTA' });
      assert.equal(result.status, 200); assert.equal(result.data.deleted, true);
      assert.equal(await repo.findOneBy({ id: staff.id }), null);
      assert.equal((await request('/auth/refresh', 'POST', undefined, { refreshToken: session.refreshToken })).status, 401);
      assert.equal((await request('/profile', 'GET', session.token)).status, 401);
      const rows = await db.query('SELECT COUNT(*)::int AS n FROM account_privacy WHERE user_id = $1', [staff.id]); assert.equal(rows[0].n, 0);
    });
    await test('Cuenta sin rol nunca obtiene sesión privilegiada', async () => {
      const unassigned = await account(Role.Unassigned);
      assert.equal((await request('/auth/login', 'POST', undefined, { email: unassigned.email, password, mobile: true })).status, 403);
    });
    await test('Registro con contraseña no concede administración automáticamente', async () => {
      const user = await app.get(UsersService).create({ nombre: 'QA Registro', email: `signup-${suffix}@example.test`, password });
      created.push(user); assert.equal(user.rol, Role.Unassigned); assert.equal(user.confirmed, false);
    });
    await test('Registro con Google no promueve cuentas nuevas a administrador', async () => {
      const user = await app.get(UsersService).registerFromGoogle({ nombre: 'QA OAuth', email: `oauth-${suffix}@example.test`, googleId: 'qa-subject' });
      created.push(user); assert.equal(user.rol, Role.Unassigned);
    });
    // Optional process stays alive only for a scanner against this disposable environment.
    if (process.env.SECURITY_SCAN_HOLD === '1' && !process.exitCode) {
      await account(Role.Recepcionista, process.env.SECURITY_QA_UI_EMAIL ?? 'native-qa@example.test');
      const studyRepo = db.getRepository(Study);
      const study = await studyRepo.save(studyRepo.create({ name: 'Estudio QA seguro', code: `QA-${suffix}`, normalPrice: 120 }));
      await db.getRepository(StudyDetail).save({ studyId: study.id, name: 'Parametro QA', dataType: StudyDetailType.PARAMETER, unit: 'QA', referenceValue: 'Solo pruebas' });
      writeFileSync('reports/mobile-security/dast.json', JSON.stringify({ tool: 'Econolab HTTP security assertions', target: 'isolated NestJS + PostgreSQL', executedAt: new Date().toISOString(), cases }, null, 2));
      let tlsServer: ReturnType<typeof createServer> | undefined;
      if (process.env.SECURITY_QA_TLS_CERT && process.env.SECURITY_QA_TLS_KEY) {
        tlsServer = createServer({ cert: readFileSync(process.env.SECURITY_QA_TLS_CERT), key: readFileSync(process.env.SECURITY_QA_TLS_KEY) }, app.getHttpAdapter().getInstance());
        await new Promise<void>(resolve => tlsServer!.listen(3110, '0.0.0.0', resolve));
      }
      writeFileSync('reports/mobile-security/ready', base);
      await new Promise<void>(resolve => process.once('SIGTERM', resolve));
      if (tlsServer) await new Promise<void>(resolve => tlsServer!.close(() => resolve()));
    }
  } finally {
    for (const user of created) {
      await db.query('DELETE FROM user_login_logs WHERE user_id = $1 OR "emailIntent" = $2', [user.id, user.email]);
      await repo.delete(user.id);
    }
    mkdirSync('reports/mobile-security', { recursive: true });
    writeFileSync('reports/mobile-security/dast.json', JSON.stringify({ tool: 'Econolab HTTP security assertions', target: 'isolated NestJS auth/profile/privacy modules + PostgreSQL', executedAt: new Date().toISOString(), cases }, null, 2));
    await app.close();
    if (cases.some(result => !result.passed)) process.exitCode = 1;
  }
}

run().catch(error => { console.error(`Error de preparación de seguridad: ${error instanceof Error ? error.name : 'Error'}`); process.exitCode = 1; });
