import 'reflect-metadata';
import dataSource from './data-source';

async function migrate(): Promise<void> {
  try {
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'all' });
  } catch {
    process.stderr.write('Database migration failed.\n');
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}
void migrate();
