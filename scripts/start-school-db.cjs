const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
async function main() {
  if (!process.env.GITHUB_ENV) throw new Error('This helper is for an isolated GitHub Actions fixture.');
  const password = randomBytes(32).toString('hex');
  process.stdout.write('::add-mask::' + password + '\n');
  fs.appendFileSync(process.env.GITHUB_ENV, 'SCHOOL_TEST_DATABASE_URL=postgresql://postgres:' + password + '@127.0.0.1:5432/econolab_school_test\n');
  const started = spawnSync('docker', ['run', '--detach', '--name', 'school-postgres', '--publish', '127.0.0.1:5432:5432',
    '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_PASSWORD=' + password, '--env', 'POSTGRES_DB=econolab_school_test', 'postgres:17'], { encoding: 'utf8' });
  if (started.status !== 0) throw new Error('Could not start the isolated database container.');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (spawnSync('docker', ['exec', 'school-postgres', 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Fixture database did not become ready.');
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
