/** Root Jest config — ts-jest transform + workspace path mapping for @kiro-governance/shared. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/scripts', '<rootDir>/migrations', '<rootDir>/infra'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/scripts/__tests__/**/*.test.js',
    // Migration guard tests (V004-V007): static CommonJS assertions over the SQL DDL,
    // no live database required. Kept as .js so they run without a ts-jest transform.
    '**/migrations/__tests__/**/*.test.js',
    // CR-13 Level-1 integration tests (fake-pg harness — no live endpoint required).
    // Suffix-scoped so the live e2e.test.ts (deployed-API) is NOT auto-included.
    '**/tests/integration/*.integration.test.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],
  moduleNameMapper: {
    '^@kiro-governance/shared/(.*)$': '<rootDir>/packages/shared/$1',
    '^@kiro-governance/shared$': '<rootDir>/packages/shared/index',
    '^@kiro-governance/gates$': '<rootDir>/packages/gates/index',
    '^@kiro-governance/gates/(.*)$': '<rootDir>/packages/gates/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          target: 'ES2020',
          module: 'commonjs',
          esModuleInterop: true,
          resolveJsonModule: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
};
