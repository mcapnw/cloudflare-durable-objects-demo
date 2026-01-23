import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                // Browser/DOM globals
                console: 'readonly',
                document: 'readonly',
                window: 'readonly',
                WebSocket: 'readonly',
                HTMLElement: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                // Cloudflare Workers globals  
                Request: 'readonly',
                Response: 'readonly',
                fetch: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            // Security rules - CRITICAL
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',

            // Disable noisy rules for demo project
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-unused-vars': 'off',
            'no-undef': 'off',
            'no-console': 'off',
            'prefer-const': 'off',
        },
    },
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            '.wrangler/**',
            'vite.config.ts.timestamp-*',
        ],
    },
];
