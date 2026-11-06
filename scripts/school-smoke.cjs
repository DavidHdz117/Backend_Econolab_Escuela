/* Local fixture only. Refuses remote databases and non-test names. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { Client } = require('pg');
const { Test } = require('@nestjs/testing');
const { PassportModule } = require('@nestjs/passport');
const { ConfigService } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const { getRepositoryToken } = require('@nestjs/typeorm');
const jwt = require('jsonwebtoken');
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { 'src/*': ['dist/*'] } });
const { SchoolController, SchoolPublicController } = require('../dist/school/school.controller');
const { SchoolService } = require('../dist/school/school.service');
const { JwtStrategy } = require('../dist/auth/strategies/jwt.strategy');
const { UserSession } = require('../dist/auth/entities/user-session.entity');
const { SCHOOL_NOTICE_VERSION } = require('../dist/school/domain');
const secret = 'local-school-fixture-secret-only-2026';
const databaseUrl = process.env.SCHOOL_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:55440/econolab_school_test';
async function main() {
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, '127.0.0.1', 'Only a local fixture is allowed');
  assert.match(url.pathname, /^\/[a-z0-9_]+_test$/);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(databaseUrl); adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  if (!(await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [dbName])).rowCount) await admin.query('CREATE DATABASE "' + dbName + '"');
  await admin.end();
  const db = new DataSource({ type: 'postgres', url: databaseUrl });
  await db.initialize();
  let app;
  try {
    await db.query('CREATE TABLE IF NOT EXISTS "user" (id INTEGER PRIMARY KEY)');
    await db.query('INSERT INTO "user" (id) VALUES (9011),(9022) ON CONFLICT DO NOTHING');
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [SchoolController, SchoolPublicController],
      providers: [JwtStrategy, SchoolService, { provide: DataSource, useValue: db },
        { provide: ConfigService, useValue: { getOrThrow: name => { assert.equal(name, 'JWT_SECRET'); return secret; } } },
        { provide: getRepositoryToken(UserSession), useValue: {
          findOne: async ({ where }) => {
            const id = where.id === 'fixture-admin' ? '9011' : where.id === 'fixture-member' ? '9022' : null;
            return id ? { id: where.id, revoked: false, expiresAt: new Date(Date.now() + 60000),
              user: { id, confirmed: true, email: 'fixture@example.test', rol: id === '9011' ? 'admin' : 'recepcionista' } } : null;
          },
        } },
      ],
    }).overrideProvider(DataSource).useValue(db).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const adminToken = jwt.sign({ jti: 'fixture-admin', id: '9022' }, secret, { expiresIn: '1m', algorithm: 'HS256' });
    const memberToken = jwt.sign({ jti: 'fixture-member', id: '9011' }, secret, { expiresIn: '1m', algorithm: 'HS256' });
    const service = app.get(SchoolService);
    await service.reset('9011'); await service.reset('9022');
    let checks = 0;
    async function request(route, token, method = 'GET', body, expected = 200) {
      const response = await fetch(base + '/api' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await response.text();
      assert.equal(response.status, expected, route + ' returned ' + response.status + ': ' + text.slice(0, 200));
      checks++;
      return text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text;
    }
    await request('/school/workspace', null, 'GET', undefined, 401);
    await request('/school/workspace', 'invalid', 'GET', undefined, 401);
    const notice = await request('/school/privacy/notice');
    assert.equal(notice.version, SCHOOL_NOTICE_VERSION);
    const policy = await request('/school/privacy');
    assert.ok(policy.includes('20230009@uthh.edu.mx'));
    assert.ok(!/clínic|paciente|expediente/.test(policy));
    await request('/school/privacy/account-deletion');
    await request('/school/privacy/preferences', adminToken, 'PATCH', { consent: true, noticeVersion: 'old' }, 400);
    await request('/school/privacy/preferences', adminToken, 'PATCH', { consent: true, noticeVersion: SCHOOL_NOTICE_VERSION });
    const start = await request('/school/workspace', adminToken);
    assert.equal(start.catalog.length, 3); assert.equal(start.activities.length, 0);
    await request('/school/catalog', adminToken, 'POST', { name: 'Test', description: '', priceCents: 50, referenceValue: 'unexpected' }, 400);
    const saved = await request('/school/catalog', adminToken, 'POST', { name: 'Ejercicio HTTP', description: 'Datos ficticios', priceCents: 1234 }, 201);
    assert.equal(saved.catalog.length, 4);
    const member = await request('/school/workspace', memberToken);
    assert.equal(member.catalog.length, 3, 'A token payload must not override the session owner');
    await request('/school/activities', adminToken, 'POST', { itemId: 4, quantity: 0, date: '2026-11-06' }, 400);
    await request('/school/activities', adminToken, 'POST', { itemId: 4, quantity: 1, date: '2026-02-30' }, 400);
    const result = await request('/school/activities', adminToken, 'POST', { itemId: 4, quantity: 3, date: '2026-11-06' }, 201);
    assert.equal(result.activities[0].totalCents, 3702);
    await request('/school/activities/1', memberToken, 'DELETE', undefined, 404);
    await request('/school/cuts?from=2026-11-06&to=2026-11-06', memberToken, 'GET', undefined, 403);
    const cut = await request('/school/cuts?from=2026-11-06&to=2026-11-06', adminToken);
    assert.equal(cut.totalCents, 3702);
    await request('/school/activities/1', adminToken, 'DELETE');
    const cancelled = await request('/school/cuts?from=2026-11-06&to=2026-11-06', adminToken);
    assert.equal(cancelled.totalCents, 0); assert.equal(cancelled.cancelledCount, 1);
    await service.reset('9011');
    await Promise.all(Array.from({ length: 10 }, (_, index) => service.addItem('9011', { name: 'Concurrente ' + index, description: '', priceCents: index })));
    const concurrent = await service.workspace('9011');
    assert.equal(concurrent.catalog.length, 13);
    assert.equal(new Set(concurrent.catalog.map(row => row.id)).size, 13);
    const prefs = await service.preferences('9011');
    assert.ok(prefs.acceptedAt, 'Reset keeps consent');
    await db.query('DELETE FROM "user" WHERE id = $1', [9022]);
    const remaining = await db.query('SELECT user_id FROM school_workspace WHERE user_id = $1', [9022]);
    assert.equal(remaining.length, 0, 'Account deletion cascades to its school workspace');
    process.stdout.write(JSON.stringify({ checks, postgres: true, http: true, jwt: true, isolation: true, concurrentWrites: 10, cascadeVerified: true }) + '\n');
  } finally {
    if (app) await app.close();
    if (db.isInitialized) await db.destroy();
  }
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });

