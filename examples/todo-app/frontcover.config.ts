import { defineConfig } from 'frontcover';

const port = process.env.FRONTCOVER_EXAMPLE_PORT ?? '5173';
const mode = process.env.FRONTCOVER_EXAMPLE_MODE === 'preview' ? 'preview' : 'dev';

export default defineConfig({
  app: {
    command: `npm run ${mode} -- --port ${port}`,
    url: `http://localhost:${port}`,
  },
  include: ['src/**/*.{ts,tsx}'],
  testDir: 'e2e',
});
