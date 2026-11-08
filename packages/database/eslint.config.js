import base from '@hilatech/config/eslint/base.js';
export default [...base, { ignores: ['src/generated/**'] }, { rules: { 'no-console': 'off' } }];
