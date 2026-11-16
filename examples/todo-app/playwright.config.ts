import { defineConfig } from '@playwright/test';
import { withFrontcover } from 'frontcover/playwright';
import frontcover from './frontcover.config';

export default defineConfig(withFrontcover(frontcover));
