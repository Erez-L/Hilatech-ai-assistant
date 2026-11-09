import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'hta:skipTransform';

/** Returns the handler result as-is instead of wrapping it in `{ data }` (used for health probes). */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
